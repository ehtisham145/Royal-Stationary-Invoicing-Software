-- =============================================================
-- Royal Stationers - upgrade: four roles (admin, manager, cashier, storekeeper)
-- For a database that was created with the OLD setup.sql (admin + cashier).
-- New projects do not need this: setup.sql already includes it.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again.
-- Existing admins and cashiers keep their role.
-- =============================================================

begin;

-- ---------- Allowed roles ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'manager', 'cashier', 'storekeeper'));

-- ---------- Permission check + functions that use it ----------
-- New auth users get a profile. The very first user becomes admin; otherwise the role
-- comes from app_metadata (set by the admin-users Edge Function), defaulting to cashier.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    case when not exists (select 1 from public.profiles where role = 'admin') then 'admin'
         when new.raw_app_meta_data->>'role' in ('admin', 'manager', 'cashier', 'storekeeper')
           then new.raw_app_meta_data->>'role'
         else 'cashier' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Roles and what they may do. Keep in sync with frontend/src/shared/lib/permissions.js.
--   admin        everything
--   manager      everything except users, settings and deleting
--   cashier      sales, receipts, adding customers
--   storekeeper  stock entries; no sales, money or customers
create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
     where id = auth.uid() and active
       and case p_permission
             when 'sales'            then role in ('admin', 'manager', 'cashier')
             when 'price.override'   then role in ('admin', 'manager')
             when 'customers.manage' then role in ('admin', 'manager')
             when 'products.manage'  then role in ('admin', 'manager')
             when 'stock.manage'     then role in ('admin', 'manager', 'storekeeper')
             when 'reports'          then role in ('admin', 'manager')
             when 'delete'           then role = 'admin'
             when 'users'            then role = 'admin'
             when 'settings'         then role = 'admin'
             else false
           end)
$$;

-- ---------- save_product(): create / edit, company-brand-category by name ----------
-- p: { id?, code, name, company, brand, category, unit, carton_qty, inner_qty, cbm,
--      reorder_level, price, min_price, max_price, description, active }
create or replace function public.save_product(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.has_permission('products.manage') then
    raise exception 'Only a manager or administrator can change products';
  end if;

  if v_id is null then
    insert into products (code, name, product_company_id, brand_id, category_id, unit, carton_qty, inner_qty,
                          cbm, reorder_level, price, min_price, max_price, description, active)
    values (nullif(trim(p->>'code'), ''), p->>'name',
            private.lookup_id('public.product_companies', p->>'company'),
            private.lookup_id('public.brands', p->>'brand'),
            private.lookup_id('public.categories', p->>'category'),
            coalesce(nullif(trim(p->>'unit'), ''), 'Pc'),
            private.num(p, 'carton_qty', 1), private.num(p, 'inner_qty'), private.num(p, 'cbm'),
            private.num(p, 'reorder_level'), private.num(p, 'price'), private.num(p, 'min_price'), private.num(p, 'max_price'),
            nullif(trim(p->>'description'), ''), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update products set
      code               = coalesce(nullif(trim(p->>'code'), ''), code),
      name               = p->>'name',
      product_company_id = private.lookup_id('public.product_companies', p->>'company'),
      brand_id           = private.lookup_id('public.brands', p->>'brand'),
      category_id        = private.lookup_id('public.categories', p->>'category'),
      unit               = coalesce(nullif(trim(p->>'unit'), ''), unit),
      carton_qty         = private.num(p, 'carton_qty', 1),
      inner_qty          = private.num(p, 'inner_qty'),
      cbm                = private.num(p, 'cbm'),
      reorder_level      = private.num(p, 'reorder_level'),
      price              = private.num(p, 'price'),
      min_price          = private.num(p, 'min_price'),
      max_price          = private.num(p, 'max_price'),
      description        = nullif(trim(p->>'description'), ''),
      active             = coalesce((p->>'active')::boolean, active)
    where id = v_id;
    if not found then
      raise exception 'Product not found';
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------- import_products(): many products at once, optional opening stock ----------
-- Each row is a save_product() payload plus optional "stock" (opening qty in the product's unit).
-- Rows with stock need p_location_id. All rows succeed or none do.
create or replace function public.import_products(p_rows jsonb, p_location_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_id    uuid;
  v_stock numeric;
  v_entry uuid;
  v_count integer := 0;
begin
  if not public.has_permission('products.manage') then
    raise exception 'Only a manager or administrator can import products';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to import';
  end if;
  if p_location_id is not null and not exists (select 1 from locations where id = p_location_id) then
    raise exception 'Store location not found';
  end if;

  for r in select value as row, ordinality as n from jsonb_array_elements(p_rows) with ordinality loop
    begin
      v_id := public.save_product(r.row - 'id');
    exception when unique_violation then
      raise exception 'Row %: "%" - a product with this name or code already exists', r.n, r.row->>'name';
    end;

    v_stock := private.num(r.row, 'stock');
    if v_stock <> 0 then
      if p_location_id is null then
        raise exception 'Choose a store for the opening stock';
      end if;
      if v_entry is null then
        insert into stock_entries (kind, location_id, note, created_by)
        values ('opening', p_location_id, 'Opening stock (product import)', auth.uid())
        returning id into v_entry;
      end if;
      insert into stock_moves (product_id, location_id, qty, kind, stock_entry_id, created_by)
      values (v_id, p_location_id, v_stock, 'opening', v_entry, auth.uid());
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- post_stock_entry(): Opening / Stock In / Stock Out / Transfer ----------
-- p_items: [{ "product_id": "...", "cartons": 2, "loose": 5 }, ...]
create or replace function public.post_stock_entry(
  p_kind            text,
  p_location_id     uuid,
  p_items           jsonb,
  p_to_location_id  uuid default null,
  p_entry_date      date default current_date,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_date  date := coalesce(p_entry_date, current_date);
  v_bad   text;
  v_need  jsonb;
begin
  if not public.has_permission('stock.manage') then
    raise exception 'You do not have permission to post stock entries';
  end if;
  if p_kind not in ('opening', 'in', 'out', 'transfer') then
    raise exception 'Unknown entry type';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;
  if not exists (select 1 from locations where id = p_location_id) then
    raise exception 'Choose a store';
  end if;
  if p_kind = 'transfer' and (p_to_location_id is null or p_to_location_id = p_location_id
                              or not exists (select 1 from locations where id = p_to_location_id)) then
    raise exception 'Choose a different store to transfer to';
  end if;

  if exists (select 1 from private.parse_lines(p_items) x left join products p on p.id = x.product_id where p.id is null) then
    raise exception 'One or more products were not found';
  end if;
  if exists (select 1 from private.parse_lines(p_items) x where x.cartons < 0 or x.loose < 0) then
    raise exception 'Cartons and loose cannot be negative';
  end if;
  select string_agg(p.name, ', ') into v_bad
    from private.parse_lines(p_items) x join products p on p.id = x.product_id
   where x.cartons * p.carton_qty + x.loose <= 0;
  if v_bad is not null then
    raise exception 'Enter a quantity for: %', v_bad;
  end if;

  -- Lock the products so two entries can't both pass the stock check
  perform 1 from products where id in (select product_id from private.parse_lines(p_items)) order by id for update;

  if p_kind in ('out', 'transfer') and not coalesce((select allow_negative_stock from companies order by is_default desc, created_at limit 1), false) then
    select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'location_id', p_location_id, 'qty', x.cartons * p.carton_qty + x.loose))
      into v_need
      from private.parse_lines(p_items) x join products p on p.id = x.product_id;
    v_bad := private.stock_shortages(v_need);
    if v_bad is not null then
      raise exception 'Not enough stock: %', v_bad;
    end if;
  end if;

  insert into stock_entries (kind, entry_date, location_id, to_location_id, note, created_by)
  values (p_kind, v_date, p_location_id, case when p_kind = 'transfer' then p_to_location_id end,
          nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into stock_moves (product_id, location_id, qty, move_date, kind, stock_entry_id, created_by)
  select x.product_id, p_location_id,
         case when p_kind in ('out', 'transfer') then -1 else 1 end * (x.cartons * p.carton_qty + x.loose),
         v_date,
         case p_kind when 'transfer' then 'transfer_out' else p_kind end,
         v_id, auth.uid()
    from private.parse_lines(p_items) x join products p on p.id = x.product_id;

  if p_kind = 'transfer' then
    insert into stock_moves (product_id, location_id, qty, move_date, kind, stock_entry_id, created_by)
    select x.product_id, p_to_location_id, x.cartons * p.carton_qty + x.loose, v_date, 'transfer_in', v_id, auth.uid()
      from private.parse_lines(p_items) x join products p on p.id = x.product_id;
  end if;

  return v_id;
end;
$$;

-- ---------- create_invoice(): sale or return, stock + account in one transaction ----------
-- p_items: [{ "product_id": "...", "location_id": "...", "cartons": 2, "loose": 0, "unit_price": 450 }, ...]
create or replace function public.create_invoice(
  p_customer_id    uuid,
  p_items          jsonb,
  p_invoice_date   date    default current_date,
  p_txn_type       text    default 'sale',
  p_payment_mode   text    default 'credit',
  p_delivery_mode  text    default 'counter',
  p_bilty_no       text    default null,
  p_discount       numeric default 0,
  p_freight        numeric default 0,
  p_received       numeric default 0,
  p_notes          text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company   companies%rowtype;
  v_date      date := coalesce(p_invoice_date, current_date);
  v_id        uuid;
  v_no        bigint;
  v_subtotal  numeric(14,2);
  v_total     numeric(14,2);
  v_prev      numeric(14,2);
  v_bad       text;
  v_need      jsonb;
begin
  if not public.has_permission('sales') then
    raise exception 'You do not have permission to make invoices';
  end if;
  if p_txn_type not in ('sale', 'return') then
    raise exception 'Unknown transaction type';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;

  select * into v_company from companies order by is_default desc, created_at limit 1;
  if not found then
    raise exception 'Add your business details in Settings first';
  end if;

  -- Lock the customer (balance snapshot) and the products (stock check)
  perform 1 from customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;
  perform 1 from products where id in (select product_id from private.parse_lines(p_items)) order by id for update;

  if exists (select 1 from private.parse_lines(p_items) x left join products p on p.id = x.product_id where p.id is null) then
    raise exception 'One or more products were not found';
  end if;
  if exists (select 1 from private.parse_lines(p_items) x left join locations l on l.id = x.location_id where l.id is null) then
    raise exception 'Choose a store for every item';
  end if;
  if exists (select 1 from private.parse_lines(p_items) x
              where x.cartons < 0 or x.loose < 0 or x.unit_price is null or x.unit_price < 0) then
    raise exception 'Cartons and loose cannot be negative, and every item needs a rate';
  end if;
  select string_agg(p.name, ', ') into v_bad
    from private.parse_lines(p_items) x join products p on p.id = x.product_id
   where x.cartons * p.carton_qty + x.loose <= 0;
  if v_bad is not null then
    raise exception 'Enter a quantity for: %', v_bad;
  end if;

  -- Rate below the minimum price: only a manager or administrator may do that
  if p_txn_type = 'sale' and not public.has_permission('price.override') then
    select string_agg(format('%s (min %s)', p.name, trim_scale(p.min_price)), ', ') into v_bad
      from private.parse_lines(p_items) x join products p on p.id = x.product_id
     where p.min_price > 0 and x.unit_price < p.min_price;
    if v_bad is not null then
      raise exception 'Rate is below the minimum price for: %. Ask a manager.', v_bad;
    end if;
  end if;

  if p_txn_type = 'sale' and not v_company.allow_negative_stock then
    select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'location_id', x.location_id, 'qty', x.cartons * p.carton_qty + x.loose))
      into v_need
      from private.parse_lines(p_items) x join products p on p.id = x.product_id;
    v_bad := private.stock_shortages(v_need);
    if v_bad is not null then
      raise exception 'Not enough stock: %', v_bad;
    end if;
  end if;

  select coalesce(sum(round((x.cartons * p.carton_qty + x.loose) * x.unit_price, 2)), 0) into v_subtotal
    from private.parse_lines(p_items) x join products p on p.id = x.product_id;

  p_discount := coalesce(p_discount, 0);
  p_freight  := coalesce(p_freight, 0);
  p_received := coalesce(p_received, 0);
  if p_discount < 0 or p_discount > v_subtotal then
    raise exception 'Discount must be between 0 and the bill amount';
  end if;
  if p_freight < 0 then
    raise exception 'Freight cannot be negative';
  end if;
  if p_received < 0 then
    raise exception 'Amount received cannot be negative';
  end if;
  v_total := v_subtotal - p_discount + p_freight;

  select coalesce(sum(debit - credit), 0) into v_prev from customer_ledger where customer_id = p_customer_id;

  insert into invoices (company_id, customer_id, invoice_date, txn_type, payment_mode, delivery_mode, bilty_no,
                        subtotal, discount, freight, total, prev_balance, received, notes, created_by)
  values (v_company.id, p_customer_id, v_date, p_txn_type, p_payment_mode, p_delivery_mode, nullif(trim(p_bilty_no), ''),
          v_subtotal, p_discount, p_freight, v_total, v_prev, p_received, nullif(trim(p_notes), ''), auth.uid())
  returning id, invoice_no into v_id, v_no;

  insert into invoice_items (invoice_id, product_id, product_name, unit, location_id, carton_qty,
                             cartons, loose, qty, unit_price, line_total, sort_order)
  select v_id, p.id, p.name, p.unit, x.location_id, p.carton_qty,
         x.cartons, x.loose, x.cartons * p.carton_qty + x.loose, x.unit_price,
         round((x.cartons * p.carton_qty + x.loose) * x.unit_price, 2), x.ord
    from private.parse_lines(p_items) x join products p on p.id = x.product_id;

  insert into stock_moves (product_id, location_id, qty, move_date, kind, invoice_id, created_by)
  select product_id, location_id,
         case when p_txn_type = 'sale' then -qty else qty end,
         v_date,
         case when p_txn_type = 'sale' then 'sale' else 'sale_return' end,
         v_id, auth.uid()
    from invoice_items where invoice_id = v_id;

  if p_received > 0 then
    insert into receipts (customer_id, receipt_date, amount, method, note, invoice_id, created_by)
    values (p_customer_id, v_date,
            case when p_txn_type = 'sale' then p_received else -p_received end,
            'cash',
            case when p_txn_type = 'sale' then 'With invoice #' else 'Refund for return #' end || v_no,
            v_id, auth.uid());
  end if;

  return v_id;
end;
$$;

-- ---------- get_dashboard(): every dashboard number in one call ----------
-- Without the 'reports' permission, sales figures cover only the caller's own invoices
-- and receivables are hidden. RLS still applies (security invoker).
create or replace function public.get_dashboard()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with
  me as (select public.has_permission('reports') as see_all),
  month0 as (select date_trunc('month', current_date)::date as d),
  inv as (
    select i.*, case when i.txn_type = 'return' then -i.total else i.total end as net
      from invoices i
     where i.invoice_date >= ((select d from month0) - interval '11 months')::date
       and ((select see_all from me) or i.created_by = auth.uid())
  ),
  recent30 as (select * from inv where invoice_date > current_date - 30),
  stock as (select product_id, location_id, qty from stock_levels),
  bal as (select b.customer_id, b.balance from customer_balances b where (select see_all from me))
  select jsonb_build_object(
    'today_sales',  (select coalesce(sum(net), 0) from inv where invoice_date = current_date),
    'today_count',  (select count(*) from inv where invoice_date = current_date and txn_type = 'sale'),
    'month_sales',  (select coalesce(sum(net), 0) from inv where invoice_date >= (select d from month0)),
    'month_count',  (select count(*) from inv where invoice_date >= (select d from month0) and txn_type = 'sale'),
    -- last month, same days (1st .. today's day number) for a fair comparison
    'last_month_to_date', (select coalesce(sum(net), 0) from inv
                            where invoice_date >= ((select d from month0) - interval '1 month')::date
                              and invoice_date <= (current_date - interval '1 month')::date),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('key', to_char(m, 'YYYY-MM'), 'total', coalesce(s.total, 0), 'count', coalesce(s.cnt, 0)) order by m), '[]'::jsonb)
                 from generate_series((select d from month0) - interval '11 months', (select d from month0), interval '1 month') m
                 left join (select date_trunc('month', invoice_date)::date as mm, sum(net) as total,
                                   count(*) filter (where txn_type = 'sale') as cnt
                              from inv group by 1) s on s.mm = m::date),
    'received_today', (select coalesce(sum(amount), 0) from receipts where receipt_date = current_date),
    'receivable',       (select coalesce(sum(balance), 0) from bal where balance > 0),
    'receivable_count', (select count(*) from bal where balance > 0),
    'top_receivables', (select coalesce(jsonb_agg(x order by x.balance desc), '[]'::jsonb) from (
                          select c.id, c.code, c.name, c.city, b.balance
                            from bal b join customers c on c.id = b.customer_id
                           where b.balance > 0 order by b.balance desc limit 6) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                       select it.product_name as name, sum(case when r.txn_type = 'return' then -it.line_total else it.line_total end) as total
                         from invoice_items it join recent30 r on r.id = it.invoice_id
                        group by it.product_name order by 2 desc limit 5) x),
    'top_customers', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
                        select c.name || coalesce(' (' || c.city || ')', '') as name, sum(r.net) as total
                          from recent30 r join customers c on c.id = r.customer_id
                         group by c.id, c.name, c.city order by 2 desc limit 5) x),
    'low_stock_count', (select count(*) from products p join product_stock s on s.product_id = p.id
                         where p.active and p.reorder_level > 0 and s.qty <= p.reorder_level),
    'low_stock', (select coalesce(jsonb_agg(x order by x.short desc), '[]'::jsonb) from (
                    select p.id, p.code, p.name, p.unit, p.carton_qty, p.reorder_level, s.qty, p.reorder_level - s.qty as short
                      from products p join product_stock s on s.product_id = p.id
                     where p.active and p.reorder_level > 0 and s.qty <= p.reorder_level
                     order by p.reorder_level - s.qty desc limit 8) x),
    'negative_count', (select count(*) from stock where qty < 0),
    'locations', (select coalesce(jsonb_agg(x order by x.sort_order, x.name), '[]'::jsonb) from (
                    select l.id, l.name, l.sort_order,
                           count(s.product_id) filter (where s.qty > 0) as items,
                           count(s.product_id) filter (where s.qty < 0) as negative
                      from locations l left join stock s on s.location_id = l.id
                     where l.active group by l.id) x),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select i.id, i.invoice_no, i.invoice_date, i.txn_type, i.payment_mode, i.total, i.created_at,
                        c.name as customer_name, c.city as customer_city, pr.name as created_by_name
                   from invoices i join customers c on c.id = i.customer_id
                   left join profiles pr on pr.id = i.created_by
                  where (select see_all from me)
                  order by i.created_at desc limit 8) x),
    'mine', jsonb_build_object(
      'today',       (select coalesce(sum(net), 0) from inv where created_by = auth.uid() and invoice_date = current_date),
      'today_count', (select count(*) from inv where created_by = auth.uid() and invoice_date = current_date and txn_type = 'sale'),
      'month',       (select coalesce(sum(net), 0) from inv where created_by = auth.uid() and invoice_date >= (select d from month0)),
      'month_count', (select count(*) from inv where created_by = auth.uid() and invoice_date >= (select d from month0) and txn_type = 'sale'),
      'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                   select i.id, i.invoice_no, i.invoice_date, i.txn_type, i.payment_mode, i.total, i.created_at,
                          c.name as customer_name, c.city as customer_city
                     from invoices i join customers c on c.id = i.customer_id
                    where i.created_by = auth.uid()
                    order by i.created_at desc limit 8) x)
    ),
    'counts', jsonb_build_object(
      'customers', (select count(*) from customers where active),
      'products',  (select count(*) from products where active)
    )
  )
$$;

revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ---------- Row Level Security ----------
-- Customers, invoices and receipts: only roles with 'sales' (storekeepers cannot read them)
do $$
declare t text;
begin
  foreach t in array array['customers','invoices','invoice_items','receipts']
  loop
    execute format('drop policy if exists "active users read" on public.%I', t);
    execute format('drop policy if exists "sales read" on public.%I', t);
    execute format('create policy "sales read" on public.%I for select to authenticated using (public.has_permission(''sales''))', t);
  end loop;
end $$;

drop policy if exists "active users add customers" on public.customers;
drop policy if exists "sales add customers" on public.customers;
create policy "sales add customers" on public.customers
  for insert to authenticated with check (public.has_permission('sales') and opening_balance = 0);

drop policy if exists "managers add customers" on public.customers;
create policy "managers add customers" on public.customers
  for insert to authenticated with check (public.has_permission('customers.manage'));
drop policy if exists "managers edit customers" on public.customers;
create policy "managers edit customers" on public.customers
  for update to authenticated using (public.has_permission('customers.manage'))
  with check (public.has_permission('customers.manage'));

drop policy if exists "active users add receipts" on public.receipts;
drop policy if exists "sales add receipts" on public.receipts;
create policy "sales add receipts" on public.receipts
  for insert to authenticated with check (public.has_permission('sales') and invoice_id is null and created_by = auth.uid());

drop policy if exists "read own or admin" on public.profiles;
drop policy if exists "read own or reports" on public.profiles;
create policy "read own or reports" on public.profiles
  for select to authenticated using (id = auth.uid() or public.has_permission('reports'));

commit;
