-- =============================================================
-- Royal Stationers - database setup
-- Run this whole file ONCE on a NEW Supabase project:
--   Supabase Dashboard > SQL Editor > New query > paste > Run
--
-- Rules:
--   * Stock is never stored on the product. Every change is a row in
--     stock_moves (+ in, - out), per store location. Stock = sum(qty).
--   * Quantities are in the product's unit (Pc, Box, ...). Cartons are
--     only a way of entering/showing them: qty = cartons * carton_qty + loose.
--   * Customer balance = opening balance + sales - returns - receipts.
-- =============================================================

-- Helpers that must not be callable through the API live here
create schema if not exists private;
revoke all on schema private from public;

-- ---------- Business profile (shown on prints) ----------
create table public.companies (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  address               text,
  phone                 text,
  email                 text,
  ntn                   text,
  strn                  text,
  allow_negative_stock  boolean not null default false,
  is_default            boolean not null default false,
  created_at            timestamptz not null default now()
);
create unique index companies_one_default on public.companies (is_default) where is_default;

-- ---------- Users ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null,
  role        text not null default 'cashier' check (role in ('admin', 'manager', 'cashier', 'storekeeper')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin') $$;

-- Roles and what they may do. Keep in sync with frontend/src/shared/lib/permissions.js.
--   admin        everything
--   manager      everything except users, settings and deleting
--   cashier      sales, receipts, adding customers
--   storekeeper  stock entries, containers (no prices); no sales, money or customers
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
             when 'costs'            then role in ('admin', 'manager')
             when 'containers.view'    then role in ('admin', 'manager', 'storekeeper')
             when 'containers.manage'  then role in ('admin', 'manager')
             when 'containers.receive' then role in ('admin', 'manager', 'storekeeper')
             when 'delete'           then role = 'admin'
             when 'users'            then role = 'admin'
             when 'settings'         then role = 'admin'
             else false
           end)
$$;

-- ---------- Product lookups ("Company" = maker, e.g. China, Dollar, Piano) ----------
create table public.product_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  created_at  timestamptz not null default now()
);
create unique index product_companies_name_unique on public.product_companies (lower(name));

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  created_at  timestamptz not null default now()
);
create unique index brands_name_unique on public.brands (lower(name));

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  created_at  timestamptz not null default now()
);
create unique index categories_name_unique on public.categories (lower(name));

-- ---------- Products ----------
create sequence public.product_code_seq;

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  name                text not null check (trim(name) <> ''),
  product_company_id  uuid references public.product_companies(id) on delete set null,
  brand_id            uuid references public.brands(id) on delete set null,
  category_id         uuid references public.categories(id) on delete set null,
  unit                text not null default 'Pc',
  carton_qty          integer not null default 1 check (carton_qty >= 1),   -- units in one carton
  inner_qty           integer not null default 0 check (inner_qty >= 0),    -- units in one inner pack
  cbm                 numeric(10,4) not null default 0 check (cbm >= 0),    -- per carton
  reorder_level       numeric(12,2) not null default 0 check (reorder_level >= 0),
  price               numeric(12,2) not null default 0 check (price >= 0),
  min_price           numeric(12,2) not null default 0 check (min_price >= 0),
  max_price           numeric(12,2) not null default 0 check (max_price >= 0), -- 0 = no maximum
  description         text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  check (max_price = 0 or max_price >= min_price)
);
create unique index products_code_unique on public.products (lower(trim(code)));
create unique index products_name_unique on public.products (lower(regexp_replace(trim(name), '\s+', ' ', 'g')));

-- Blank code -> next free 6-digit number (000001, 000002, ...)
create or replace function private.product_default_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or trim(new.code) = '' then
    loop
      new.code := lpad(nextval('public.product_code_seq')::text, 6, '0');
      exit when not exists (select 1 from public.products where lower(trim(code)) = lower(new.code));
    end loop;
  end if;
  new.code := trim(new.code);
  new.name := regexp_replace(trim(new.name), '\s+', ' ', 'g');
  return new;
end;
$$;

create trigger products_default_code
  before insert or update on public.products
  for each row execute function private.product_default_code();

-- ---------- Store locations ----------
create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index locations_name_unique on public.locations (lower(trim(name)));

-- ---------- Customers ----------
create sequence public.customer_code_seq;

create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  code             integer not null unique default nextval('public.customer_code_seq'),
  name             text not null check (trim(name) <> ''),
  city             text,
  phone            text,
  phone2           text,
  contact_person   text,
  address          text,
  ntn              text,
  opening_balance  numeric(14,2) not null default 0,  -- + = customer owes us
  credit_limit     numeric(14,2) not null default 0 check (credit_limit >= 0), -- 0 = no limit
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
-- Same name is allowed in different cities ("Imran" in DG Khan and in Multan)
create unique index customers_name_city_unique on public.customers (lower(trim(name)), lower(trim(coalesce(city, ''))));

-- ---------- Sale invoices (sale or return) ----------
create sequence public.invoice_no_seq;

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_no     bigint not null unique default nextval('public.invoice_no_seq'),
  company_id     uuid not null references public.companies(id),
  customer_id    uuid not null references public.customers(id),
  invoice_date   date not null default current_date,
  txn_type       text not null default 'sale' check (txn_type in ('sale', 'return')),
  payment_mode   text not null default 'credit' check (payment_mode in ('cash', 'credit', 'cheque')),
  delivery_mode  text not null default 'counter' check (delivery_mode in ('counter', 'bilty', 'delivery')),
  bilty_no       text,
  cheque_image   text,  -- path in the 'cheques' storage bucket (cheque payments)
  return_of      uuid references public.invoices(id),  -- returns: the sale invoice they are against
  subtotal       numeric(14,2) not null,
  discount       numeric(14,2) not null default 0,
  freight        numeric(14,2) not null default 0,
  total          numeric(14,2) not null,
  prev_balance   numeric(14,2) not null default 0,  -- customer balance just before this bill (for print)
  received       numeric(14,2) not null default 0,  -- money taken / refunded with this bill
  notes          text,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index invoices_customer_idx on public.invoices (customer_id, invoice_date);
create index invoices_date_idx on public.invoices (invoice_date);
create index invoices_return_of_idx on public.invoices (return_of) where return_of is not null;

create table public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  product_name  text not null,          -- snapshot, so old invoices don't change
  unit          text not null,
  location_id   uuid not null references public.locations(id),
  carton_qty    integer not null,       -- snapshot
  cartons       numeric(12,2) not null default 0,
  loose         numeric(12,2) not null default 0,
  qty           numeric(12,2) not null check (qty > 0),  -- cartons * carton_qty + loose
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  line_total    numeric(14,2) not null,
  sort_order    integer not null default 0,
  return_of_item uuid references public.invoice_items(id)  -- return lines: the sold line they give back
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_return_of_idx on public.invoice_items (return_of_item) where return_of_item is not null;
create index invoice_items_product_idx on public.invoice_items (product_id);

-- ---------- Receipts (money from customers; negative = refund) ----------
create sequence public.receipt_no_seq;

create table public.receipts (
  id            uuid primary key default gen_random_uuid(),
  receipt_no    bigint not null unique default nextval('public.receipt_no_seq'),
  customer_id   uuid not null references public.customers(id),
  receipt_date  date not null default current_date,
  amount        numeric(14,2) not null check (amount <> 0),
  method        text not null default 'cash' check (method in ('cash', 'bank', 'cheque')),
  reference     text,   -- cheque no. / bank ref
  note          text,
  invoice_id    uuid references public.invoices(id) on delete cascade,  -- set when taken with a bill
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index receipts_customer_idx on public.receipts (customer_id, receipt_date);

-- ---------- Stock entries (Stock In / Out / Transfer / Opening) ----------
create sequence public.stock_entry_no_seq;

create table public.stock_entries (
  id              uuid primary key default gen_random_uuid(),
  entry_no        bigint not null unique default nextval('public.stock_entry_no_seq'),
  kind            text not null check (kind in ('opening', 'in', 'out', 'transfer')),
  entry_date      date not null default current_date,
  location_id     uuid not null references public.locations(id),
  to_location_id  uuid references public.locations(id),
  note            text,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check ((kind = 'transfer') = (to_location_id is not null)),
  check (to_location_id is distinct from location_id)
);

-- The stock ledger. Every stock change in the system is one row here.
create table public.stock_moves (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id),
  location_id     uuid not null references public.locations(id),
  qty             numeric(12,2) not null check (qty <> 0),   -- + in, - out
  move_date       date not null default current_date,
  kind            text not null check (kind in ('opening', 'in', 'out', 'transfer_in', 'transfer_out', 'sale', 'sale_return')),
  stock_entry_id  uuid references public.stock_entries(id) on delete cascade,
  invoice_id      uuid references public.invoices(id) on delete cascade,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(stock_entry_id, invoice_id) = 1)
);
create index stock_moves_product_location_idx on public.stock_moves (product_id, location_id);
create index stock_moves_entry_idx on public.stock_moves (stock_entry_id);
create index stock_moves_invoice_idx on public.stock_moves (invoice_id);

-- ---------- Views (security_invoker: the caller's RLS applies) ----------
create view public.stock_levels with (security_invoker = true) as
  select product_id, location_id, sum(qty) as qty
    from public.stock_moves
   group by product_id, location_id;

create view public.product_stock with (security_invoker = true) as
  select p.id as product_id, coalesce(sum(m.qty), 0) as qty
    from public.products p
    left join public.stock_moves m on m.product_id = p.id
   group by p.id;

-- debit = customer owes more, credit = customer owes less.
-- Sort: entry_date (nulls first), created_at, seq (a bill comes before the payment taken with it)
create view public.customer_ledger with (security_invoker = true) as
  select c.id as customer_id, null::date as entry_date, 'opening'::text as kind,
         null::uuid as ref_id, null::bigint as ref_no, 'Opening balance'::text as description,
         greatest(c.opening_balance, 0) as debit, greatest(-c.opening_balance, 0) as credit,
         c.created_at as created_at, 0 as seq
    from public.customers c
   where c.opening_balance <> 0
  union all
  select i.customer_id, i.invoice_date, i.txn_type, i.id, i.invoice_no,
         case when i.txn_type = 'sale' then 'Sale invoice' else 'Sale return' end
           || case when i.bilty_no is not null then ' · Bilty ' || i.bilty_no else '' end,
         case when i.txn_type = 'sale' then i.total else 0 end,
         case when i.txn_type = 'return' then i.total else 0 end,
         i.created_at, 1
    from public.invoices i
  union all
  select r.customer_id, r.receipt_date, 'receipt', r.id, r.receipt_no,
         case when r.amount > 0 then 'Receipt' else 'Refund' end || ' (' || r.method || ')'
           || case when r.reference is not null then ' · ' || r.reference else '' end
           || case when r.note is not null then ' · ' || r.note else '' end,
         greatest(-r.amount, 0), greatest(r.amount, 0),
         r.created_at, 2
    from public.receipts r;

create view public.customer_balances with (security_invoker = true) as
  select customer_id, sum(debit - credit) as balance
    from public.customer_ledger
   group by customer_id;

-- ---------- Private helpers ----------

-- p_items -> rows. Keys: product_id, location_id, cartons, loose, unit_price
create or replace function private.parse_lines(p_items jsonb)
returns table (ord int, product_id uuid, location_id uuid, cartons numeric, loose numeric, unit_price numeric)
language sql immutable as $$
  select t.ord::int,
         nullif(t.i->>'product_id', '')::uuid,
         nullif(t.i->>'location_id', '')::uuid,
         coalesce(nullif(t.i->>'cartons', '')::numeric, 0),
         coalesce(nullif(t.i->>'loose', '')::numeric, 0),
         nullif(t.i->>'unit_price', '')::numeric
    from jsonb_array_elements(p_items) with ordinality as t(i, ord)
$$;

-- Finds a lookup row by name (any case), creating it when missing. Blank name -> null.
create or replace function private.lookup_id(p_table regclass, p_name text)
returns uuid language plpgsql as $$
declare
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_id   uuid;
begin
  if v_name is null then return null; end if;
  execute format('select id from %s where lower(name) = lower($1)', p_table) into v_id using v_name;
  if v_id is null then
    execute format('insert into %s (name) values ($1) returning id', p_table) into v_id using v_name;
  end if;
  return v_id;
end;
$$;

create or replace function private.num(p jsonb, k text, dflt numeric default 0)
returns numeric language sql immutable as $$
  select coalesce(nullif(trim(p->>k), '')::numeric, dflt)
$$;

-- Lines that would take a store below zero, e.g. "Tape 1262 at 2nd Floor (available 30, needed 36)"
create or replace function private.stock_shortages(p_need jsonb)
returns text language sql stable as $$
  with need as (
    select (n->>'product_id')::uuid as product_id, (n->>'location_id')::uuid as location_id, sum((n->>'qty')::numeric) as qty
      from jsonb_array_elements(p_need) n
     group by 1, 2
  )
  select string_agg(format('%s at %s (available %s, needed %s)', p.name, l.name,
                           trim_scale(coalesce(s.qty, 0)), trim_scale(need.qty)), '; ' order by p.name)
    from need
    join public.products p on p.id = need.product_id
    join public.locations l on l.id = need.location_id
    left join lateral (
      select sum(m.qty) as qty from public.stock_moves m
       where m.product_id = need.product_id and m.location_id = need.location_id
    ) s on true
   where coalesce(s.qty, 0) < need.qty
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

  -- Cost price (normally set by receiving a container); only roles that may see costs
  if nullif(trim(p->>'cost_price'), '') is not null and public.has_permission('costs') then
    insert into product_costs (product_id, cost_price, updated_at)
    values (v_id, private.num(p, 'cost_price'), now())
    on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();
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
-- A return against a sale invoice (p_return_of) sends "return_item_id" (the sold line) instead of
-- product and rate; both are taken from the original bill.
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
  p_notes          text    default null,
  p_cheque_image   text    default null,
  p_return_of      uuid    default null
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
  if p_payment_mode not in ('cash', 'credit', 'cheque') then
    raise exception 'Unknown payment type';
  end if;
  if p_payment_mode = 'cheque' and nullif(trim(p_cheque_image), '') is null then
    raise exception 'Upload a photo of the cheque';
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

  -- Return against a sale invoice: same customer, only items from that bill at the billed rate,
  -- and never more than was sold minus what earlier returns already gave back
  if p_return_of is not null then
    if p_txn_type <> 'return' then
      raise exception 'Only a return can be made against an invoice';
    end if;
    perform 1 from invoices where id = p_return_of and txn_type = 'sale' and customer_id = p_customer_id for update;
    if not found then
      raise exception 'The original sale invoice was not found for this customer';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) t(i)
                left join invoice_items it on it.id = nullif(t.i->>'return_item_id', '')::uuid and it.invoice_id = p_return_of
               where it.id is null) then
      raise exception 'Every returned item must come from the original invoice';
    end if;
    select jsonb_agg(t.i || jsonb_build_object('product_id', it.product_id, 'unit_price', it.unit_price) order by t.ord)
      into p_items
      from jsonb_array_elements(p_items) with ordinality t(i, ord)
      join invoice_items it on it.id = (t.i->>'return_item_id')::uuid;

    select string_agg(format('%s (only %s %s left to return)', o.product_name, trim_scale(o.qty - o.done), o.unit), ', ') into v_bad
      from (select it.product_name, it.unit, it.qty,
                   coalesce((select sum(r.qty) from invoice_items r where r.return_of_item = it.id), 0) as done,
                   sum(x.cartons * p.carton_qty + x.loose) as now_qty
              from private.parse_lines(p_items) x
              join invoice_items it on it.id = (p_items->(x.ord - 1)->>'return_item_id')::uuid
              join products p on p.id = x.product_id
             group by it.id, it.product_name, it.unit, it.qty) o
     where o.done + o.now_qty > o.qty;
    if v_bad is not null then
      raise exception 'More than was sold: %', v_bad;
    end if;
  elsif p_txn_type = 'return' and not public.has_permission('price.override') then
    raise exception 'Choose the invoice this return is for. Only a manager can make a return without an invoice.';
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

  insert into invoices (company_id, customer_id, invoice_date, txn_type, payment_mode, delivery_mode, bilty_no, cheque_image, return_of,
                        subtotal, discount, freight, total, prev_balance, received, notes, created_by)
  values (v_company.id, p_customer_id, v_date, p_txn_type, p_payment_mode, p_delivery_mode, nullif(trim(p_bilty_no), ''),
          case when p_payment_mode = 'cheque' then trim(p_cheque_image) end, p_return_of,
          v_subtotal, p_discount, p_freight, v_total, v_prev, p_received, nullif(trim(p_notes), ''), auth.uid())
  returning id, invoice_no into v_id, v_no;

  insert into invoice_items (invoice_id, product_id, product_name, unit, location_id, carton_qty,
                             cartons, loose, qty, unit_price, line_total, sort_order, return_of_item)
  select v_id, p.id, p.name, p.unit, x.location_id, p.carton_qty,
         x.cartons, x.loose, x.cartons * p.carton_qty + x.loose, x.unit_price,
         round((x.cartons * p.carton_qty + x.loose) * x.unit_price, 2), x.ord,
         case when p_return_of is not null then (p_items->(x.ord - 1)->>'return_item_id')::uuid end
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
            case when p_payment_mode = 'cheque' then 'cheque' else 'cash' end,
            case when p_txn_type = 'sale' then 'With invoice #' else 'Refund for return #' end || v_no,
            v_id, auth.uid());
  end if;

  return v_id;
end;
$$;

-- ---------- price_history(): last sales of a product to a customer ----------
create or replace function public.price_history(p_customer_id uuid, p_product_id uuid, p_limit integer default 5)
returns table (invoice_id uuid, invoice_no bigint, invoice_date date, txn_type text,
               cartons numeric, loose numeric, qty numeric, unit_price numeric)
language sql stable security invoker set search_path = public as $$
  select i.id, i.invoice_no, i.invoice_date, i.txn_type, it.cartons, it.loose, it.qty, it.unit_price
    from invoice_items it
    join invoices i on i.id = it.invoice_id
   where i.customer_id = p_customer_id and it.product_id = p_product_id
   order by i.invoice_date desc, i.created_at desc
   limit coalesce(p_limit, 5)
$$;

-- =============================================================
-- Purchase: suppliers and import containers (Level 1)
-- A container holds a packing list (products, cartons, CBM, weight, price).
-- Status: ordered > shipped > at_port > clearing > received.
-- Shipped / at port / clearing = "On the way" (not sellable yet).
-- Receiving puts the goods into stores as stock moves (kind 'container_in')
-- and updates each product's average cost from the container's landed cost.
-- Prices and costs live in separate tables that only the 'costs' permission can read.
-- Written so it can run on a new or an existing database (safe to run again).
-- =============================================================

-- Margin used for the suggested sale price (landed cost + margin %)
alter table public.companies add column if not exists default_margin numeric(6,2) not null default 0;
alter table public.companies drop constraint if exists companies_default_margin_check;
alter table public.companies add constraint companies_default_margin_check check (default_margin >= 0);

-- ---------- Suppliers ----------
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (trim(name) <> ''),
  country         text,
  city            text,
  contact_person  text,
  phone           text,
  email           text,
  currency        text not null default 'USD' check (currency in ('USD', 'RMB', 'PKR')),
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists suppliers_name_unique on public.suppliers (lower(trim(name)));

-- ---------- Containers ----------
create table if not exists public.containers (
  id             uuid primary key default gen_random_uuid(),
  container_no   text not null check (trim(container_no) <> ''),   -- e.g. MSKU0221809
  supplier_id    uuid references public.suppliers(id),
  invoice_ref    text,                                              -- supplier's invoice / PI no.
  order_date     date not null default current_date,
  status         text not null default 'ordered'
                   check (status in ('ordered', 'shipped', 'at_port', 'clearing', 'received')),
  shipped_date   date,
  port_date      date,
  clearing_date  date,
  received_date  date,
  eta            date,                                              -- expected arrival
  shipping_line  text,
  bl_no          text,
  currency       text not null default 'USD' check (currency in ('USD', 'RMB', 'PKR')),
  exchange_rate  numeric(12,4) not null default 1 check (exchange_rate > 0),  -- Rs for 1 unit of currency
  cost_basis     text not null default 'cbm' check (cost_basis in ('cbm', 'value', 'cartons')),  -- how expenses are shared
  notes          text,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index if not exists containers_no_unique on public.containers (lower(trim(container_no)));
create index if not exists containers_status_idx on public.containers (status);

-- Packing list. Quantities only; prices are in container_item_prices.
create table if not exists public.container_items (
  id            uuid primary key default gen_random_uuid(),
  container_id  uuid not null references public.containers(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  cartons       numeric(12,2) not null default 0 check (cartons >= 0),
  carton_qty    integer not null default 1 check (carton_qty >= 1),   -- units per carton on this packing list
  loose         numeric(12,2) not null default 0 check (loose >= 0),
  qty           numeric(12,2) generated always as (cartons * carton_qty + loose) stored,
  cbm           numeric(10,4) not null default 0 check (cbm >= 0),     -- per carton
  weight        numeric(10,2) not null default 0 check (weight >= 0),  -- kg per carton
  received_qty  numeric(12,2),                                          -- set when the container is received
  sort_order    integer not null default 0,
  check (cartons * carton_qty + loose > 0)
);
create unique index if not exists container_items_product_unique on public.container_items (container_id, product_id);
create index if not exists container_items_product_idx on public.container_items (product_id);
-- Mixed containers (an agent fills one container from several shops): a line can name its own
-- supplier. Null = the container's supplier.
alter table public.container_items add column if not exists supplier_id uuid references public.suppliers(id);
create index if not exists container_items_supplier_idx on public.container_items (supplier_id) where supplier_id is not null;

-- Price per unit in the container's currency, and the cost snapshot taken on receiving
create table if not exists public.container_item_prices (
  item_id      uuid primary key references public.container_items(id) on delete cascade,
  unit_price   numeric(14,4) not null default 0 check (unit_price >= 0),
  landed_cost  numeric(14,4),   -- Rs per unit, when received
  prev_cost    numeric(14,4),   -- product cost before receiving (null = had none)
  new_cost     numeric(14,4)    -- product cost after receiving
);

-- Freight, duty, clearing, transport ... in Rs
create table if not exists public.container_expenses (
  id            uuid primary key default gen_random_uuid(),
  container_id  uuid not null references public.containers(id) on delete cascade,
  name          text not null check (trim(name) <> ''),
  amount        numeric(14,2) not null check (amount >= 0),
  sort_order    integer not null default 0
);
create index if not exists container_expenses_container_idx on public.container_expenses (container_id);

-- Average cost per unit (Rs). Separate from products so cashiers cannot read it.
create table if not exists public.product_costs (
  product_id  uuid primary key references public.products(id) on delete cascade,
  cost_price  numeric(14,4) not null default 0 check (cost_price >= 0),
  updated_at  timestamptz not null default now()
);

-- Stock moves can now come from a container
alter table public.stock_moves add column if not exists container_id uuid references public.containers(id);
alter table public.stock_moves drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check
  check (kind in ('opening', 'in', 'out', 'transfer_in', 'transfer_out', 'sale', 'sale_return', 'container_in'));
alter table public.stock_moves drop constraint if exists stock_moves_check;
alter table public.stock_moves add constraint stock_moves_check
  check (num_nonnulls(stock_entry_id, invoice_id, container_id) = 1);
create index if not exists stock_moves_container_idx on public.stock_moves (container_id);

-- Goods in containers that are on the way (shipped, at port, clearing)
create or replace view public.product_on_the_way with (security_invoker = true) as
  select ci.product_id, sum(ci.qty) as qty, count(*) as containers
    from public.container_items ci
    join public.containers c on c.id = ci.container_id
   where c.status in ('shipped', 'at_port', 'clearing')
   group by ci.product_id;

-- ---------- Landed cost ----------
-- Per item: goods value in Rs + its share of the expenses, divided by the packing list quantity.
-- Shared by CBM, value or cartons (containers.cost_basis); equally by quantity if that total is 0.
create or replace function private.container_costing(p_container_id uuid)
returns table (item_id uuid, product_id uuid, qty numeric, unit_price numeric,
               goods_rs numeric, expense_rs numeric, landed_cost numeric)
language sql stable as $$
  with c as (select * from public.containers where id = p_container_id),
  it as (
    select ci.id, ci.product_id, ci.qty, ci.cartons, ci.cbm, coalesce(pr.unit_price, 0) as unit_price
      from public.container_items ci
      left join public.container_item_prices pr on pr.item_id = ci.id
     where ci.container_id = p_container_id
  ),
  w as (
    select it.*,
           it.qty * it.unit_price * (select exchange_rate from c) as goods,
           case (select cost_basis from c)
             when 'cbm'   then it.cartons * it.cbm
             when 'value' then it.qty * it.unit_price
             else it.cartons
           end as weight
      from it
  ),
  tot as (select sum(weight) as weight, sum(qty) as qty from w),
  exp as (select coalesce(sum(amount), 0) as amount from public.container_expenses where container_id = p_container_id)
  select w.id, w.product_id, w.qty, w.unit_price, round(w.goods, 2),
         round(s.share, 2),
         round((w.goods + s.share) / w.qty, 4)
    from w
    cross join lateral (
      select (select amount from exp) *
             case when (select weight from tot) > 0 then w.weight / (select weight from tot)
                  else w.qty / nullif((select qty from tot), 0) end as share
    ) s
$$;

create or replace function public.container_costing(p_container_id uuid)
returns table (item_id uuid, product_id uuid, qty numeric, unit_price numeric,
               goods_rs numeric, expense_rs numeric, landed_cost numeric)
language sql stable security definer set search_path = public as $$
  select * from private.container_costing(p_container_id) where public.has_permission('costs')
$$;

-- ---------- save_container(): create / edit header, packing list and expenses ----------
-- p: { id?, container_no, supplier_id, invoice_ref, order_date, status, shipped_date, port_date,
--      clearing_date, eta, shipping_line, bl_no, currency, exchange_rate, cost_basis, notes,
--      items: [{ product_id, supplier_id?, cartons, carton_qty, loose, cbm, weight, unit_price }],
--      expenses: [{ name, amount }] }
create or replace function public.save_container(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := nullif(p->>'id', '')::uuid;
  v_status  text := coalesce(nullif(p->>'status', ''), 'ordered');
  v_bad     text;
begin
  if not public.has_permission('containers.manage') then
    raise exception 'Only a manager or administrator can change containers';
  end if;
  if v_status not in ('ordered', 'shipped', 'at_port', 'clearing') then
    raise exception 'Use "Receive container" to mark it received';
  end if;
  if jsonb_typeof(coalesce(p->'items', '[]')) <> 'array' or jsonb_typeof(coalesce(p->'expenses', '[]')) <> 'array' then
    raise exception 'Invalid packing list';
  end if;
  if private.num(p, 'exchange_rate', 1) <= 0 then
    raise exception 'Exchange rate must be more than 0';
  end if;

  if v_id is not null then
    perform 1 from containers where id = v_id for update;
    if not found then
      raise exception 'Container not found';
    end if;
    if exists (select 1 from containers where id = v_id and status = 'received') then
      raise exception 'This container is already received. An administrator must reopen it first.';
    end if;
  end if;

  -- Packing list checks
  if exists (select 1 from jsonb_array_elements(coalesce(p->'items', '[]')) i
              left join products pr on pr.id = nullif(i->>'product_id', '')::uuid where pr.id is null) then
    raise exception 'One or more products were not found';
  end if;
  select string_agg(pr.name, ', ') into v_bad
    from (select nullif(i->>'product_id', '')::uuid as product_id from jsonb_array_elements(coalesce(p->'items', '[]')) i) x
    join products pr on pr.id = x.product_id
   group by x.product_id having count(*) > 1;
  if v_bad is not null then
    raise exception 'A product is listed twice: %', v_bad;
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'items', '[]')) i
              where private.num(i, 'cartons') < 0 or private.num(i, 'loose') < 0 or private.num(i, 'carton_qty', 1) < 1
                 or private.num(i, 'cbm') < 0 or private.num(i, 'weight') < 0 or private.num(i, 'unit_price') < 0) then
    raise exception 'Quantities, CBM, weight and prices cannot be negative';
  end if;
  select string_agg(pr.name, ', ') into v_bad
    from jsonb_array_elements(coalesce(p->'items', '[]')) i
    join products pr on pr.id = (i->>'product_id')::uuid
   where private.num(i, 'cartons') * private.num(i, 'carton_qty', 1) + private.num(i, 'loose') <= 0;
  if v_bad is not null then
    raise exception 'Enter a quantity for: %', v_bad;
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'items', '[]')) i
              left join suppliers su on su.id = nullif(i->>'supplier_id', '')::uuid
              where nullif(i->>'supplier_id', '') is not null and su.id is null) then
    raise exception 'A supplier on the packing list was not found';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'expenses', '[]')) e
              where nullif(trim(e->>'name'), '') is null or private.num(e, 'amount') < 0) then
    raise exception 'Every expense needs a name and an amount of 0 or more';
  end if;

  if v_id is null then
    insert into containers (container_no, order_date) values (trim(p->>'container_no'), current_date)
    returning id into v_id;
  end if;

  update containers set
    container_no  = trim(p->>'container_no'),
    supplier_id   = nullif(p->>'supplier_id', '')::uuid,
    invoice_ref   = nullif(trim(p->>'invoice_ref'), ''),
    order_date    = coalesce(nullif(p->>'order_date', '')::date, order_date),
    status        = v_status,
    shipped_date  = nullif(p->>'shipped_date', '')::date,
    port_date     = nullif(p->>'port_date', '')::date,
    clearing_date = nullif(p->>'clearing_date', '')::date,
    eta           = nullif(p->>'eta', '')::date,
    shipping_line = nullif(trim(p->>'shipping_line'), ''),
    bl_no         = nullif(trim(p->>'bl_no'), ''),
    currency      = coalesce(nullif(p->>'currency', ''), 'USD'),
    exchange_rate = private.num(p, 'exchange_rate', 1),
    cost_basis    = coalesce(nullif(p->>'cost_basis', ''), 'cbm'),
    notes         = nullif(trim(p->>'notes'), '')
  where id = v_id;

  -- Not received yet, so nothing points at the old lines: replace them
  delete from container_items where container_id = v_id;
  with ins as (
    insert into container_items (container_id, product_id, supplier_id, cartons, carton_qty, loose, cbm, weight, sort_order)
    select v_id, (i->>'product_id')::uuid, nullif(i->>'supplier_id', '')::uuid,
           private.num(i, 'cartons'), private.num(i, 'carton_qty', 1)::int,
           private.num(i, 'loose'), private.num(i, 'cbm'), private.num(i, 'weight'), n::int
      from jsonb_array_elements(coalesce(p->'items', '[]')) with ordinality as t(i, n)
    returning id, product_id
  )
  insert into container_item_prices (item_id, unit_price)
  select ins.id, private.num(i, 'unit_price')
    from ins
    join jsonb_array_elements(coalesce(p->'items', '[]')) i on (i->>'product_id')::uuid = ins.product_id;

  delete from container_expenses where container_id = v_id;
  insert into container_expenses (container_id, name, amount, sort_order)
  select v_id, trim(e->>'name'), private.num(e, 'amount'), n::int
    from jsonb_array_elements(coalesce(p->'expenses', '[]')) with ordinality as t(e, n);

  return v_id;
end;
$$;

-- p_lines -> rows, each matched to its packing list line (item_id is null when it doesn't belong)
create or replace function private.receive_lines(p_container_id uuid, p_lines jsonb)
returns table (item_id uuid, product_id uuid, location_id uuid, cartons numeric, loose numeric, qty numeric)
language sql stable as $$
  select ci.id, ci.product_id, nullif(l->>'location_id', '')::uuid,
         private.num(l, 'cartons'), private.num(l, 'loose'),
         private.num(l, 'cartons') * ci.carton_qty + private.num(l, 'loose')
    from jsonb_array_elements(p_lines) l
    left join public.container_items ci on ci.id = nullif(l->>'item_id', '')::uuid and ci.container_id = p_container_id
$$;

-- ---------- receive_container(): goods into stores, cost updated ----------
-- p_lines: [{ item_id, location_id, cartons, loose }] - one item may be split over several stores.
-- Less than the packing list is allowed (the shortage stays visible); more is not.
create or replace function public.receive_container(p_container_id uuid, p_lines jsonb, p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date  date := coalesce(p_date, current_date);
  v_bad   text;
begin
  if not public.has_permission('containers.receive') then
    raise exception 'You do not have permission to receive containers';
  end if;
  perform 1 from containers where id = p_container_id for update;
  if not found then
    raise exception 'Container not found';
  end if;
  if exists (select 1 from containers where id = p_container_id and status = 'received') then
    raise exception 'This container is already received';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Nothing to receive';
  end if;

  if exists (select 1 from private.receive_lines(p_container_id, p_lines) where item_id is null) then
    raise exception 'A line does not belong to this container';
  end if;
  if exists (select 1 from private.receive_lines(p_container_id, p_lines) where cartons < 0 or loose < 0) then
    raise exception 'Cartons and loose cannot be negative';
  end if;
  if exists (select 1 from private.receive_lines(p_container_id, p_lines) r
              left join locations lo on lo.id = r.location_id where r.qty > 0 and lo.id is null) then
    raise exception 'Choose a store for every line';
  end if;
  if not exists (select 1 from private.receive_lines(p_container_id, p_lines) where qty > 0) then
    raise exception 'Enter the quantity received';
  end if;
  select string_agg(pr.name, ', ') into v_bad
    from (select r.item_id, sum(r.qty) as qty from private.receive_lines(p_container_id, p_lines) r group by r.item_id) r
    join container_items ci on ci.id = r.item_id
    join products pr on pr.id = ci.product_id
   where r.qty > ci.qty;
  if v_bad is not null then
    raise exception 'More than the packing list for: %', v_bad;
  end if;

  -- Average cost: (stock on hand x old cost + received x landed cost) / total.
  -- Stock on hand counts only when the product already had a cost.
  update container_item_prices pr set
    landed_cost = cx.landed_cost,
    prev_cost   = cx.prev_cost,
    new_cost    = round(case when cx.prev_cost is null or cx.on_hand + cx.received = 0 then cx.landed_cost
                             else (cx.on_hand * cx.prev_cost + cx.received * cx.landed_cost) / (cx.on_hand + cx.received) end, 4)
    from (
      select c.item_id, c.landed_cost, r.qty as received,
             pc.cost_price as prev_cost, greatest(coalesce(ps.qty, 0), 0) as on_hand
        from private.container_costing(p_container_id) c
        join (select r.item_id, sum(r.qty) as qty from private.receive_lines(p_container_id, p_lines) r group by r.item_id) r
          on r.item_id = c.item_id
        left join product_costs pc on pc.product_id = c.product_id
        left join product_stock ps on ps.product_id = c.product_id
       where r.qty > 0
    ) cx
   where pr.item_id = cx.item_id;

  insert into product_costs (product_id, cost_price, updated_at)
  select ci.product_id, pr.new_cost, now()
    from container_items ci join container_item_prices pr on pr.item_id = ci.id
   where ci.container_id = p_container_id and pr.new_cost is not null
  on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();

  insert into stock_moves (product_id, location_id, qty, move_date, kind, container_id, created_by)
  select r.product_id, r.location_id, sum(r.qty), v_date, 'container_in', p_container_id, auth.uid()
    from private.receive_lines(p_container_id, p_lines) r
   where r.qty > 0
   group by r.product_id, r.location_id;

  update container_items ci
     set received_qty = coalesce((select sum(r.qty) from private.receive_lines(p_container_id, p_lines) r where r.item_id = ci.id), 0)
   where ci.container_id = p_container_id;
  update containers set status = 'received', received_date = v_date where id = p_container_id;

  return p_container_id;
end;
$$;

-- ---------- reopen_container(): undo receiving (administrator) ----------
-- Removes the stock it added and restores product costs that have not changed since.
create or replace function public.reopen_container(p_container_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_need  jsonb;
  v_bad   text;
begin
  if not public.has_permission('delete') then
    raise exception 'Only an administrator can reopen a received container';
  end if;
  perform 1 from containers where id = p_container_id and status = 'received' for update;
  if not found then
    raise exception 'Only a received container can be reopened';
  end if;

  perform 1 from products where id in (select product_id from stock_moves where container_id = p_container_id) order by id for update;
  if not coalesce((select allow_negative_stock from companies order by is_default desc, created_at limit 1), false) then
    select jsonb_agg(jsonb_build_object('product_id', product_id, 'location_id', location_id, 'qty', qty)) into v_need
      from stock_moves where container_id = p_container_id;
    v_bad := private.stock_shortages(v_need);
    if v_bad is not null then
      raise exception 'Some of this stock is already sold or moved: %', v_bad;
    end if;
  end if;

  delete from product_costs pc
   using container_items ci join container_item_prices pr on pr.item_id = ci.id
   where ci.container_id = p_container_id and pc.product_id = ci.product_id
     and pr.prev_cost is null and pc.cost_price = pr.new_cost;
  update product_costs pc set cost_price = pr.prev_cost, updated_at = now()
    from container_items ci join container_item_prices pr on pr.item_id = ci.id
   where ci.container_id = p_container_id and pc.product_id = ci.product_id
     and pr.prev_cost is not null and pc.cost_price = pr.new_cost;

  delete from stock_moves where container_id = p_container_id;
  update container_item_prices pr set landed_cost = null, prev_cost = null, new_cost = null
    from container_items ci where ci.id = pr.item_id and ci.container_id = p_container_id;
  update container_items set received_qty = null where container_id = p_container_id;
  update containers set status = 'clearing', received_date = null where id = p_container_id;
  return p_container_id;
end;
$$;

revoke execute on function public.container_costing(uuid) from public, anon;
revoke execute on function public.save_container(jsonb) from public, anon;
revoke execute on function public.receive_container(uuid, jsonb, date) from public, anon;
revoke execute on function public.reopen_container(uuid) from public, anon;
grant execute on function public.container_costing(uuid) to authenticated;
grant execute on function public.save_container(jsonb) to authenticated;
grant execute on function public.receive_container(uuid, jsonb, date) to authenticated;
grant execute on function public.reopen_container(uuid) to authenticated;

-- ---------- Row Level Security (purchase) ----------
-- Containers and packing lists: admin, manager, store keeper. Prices and costs: admin, manager.
-- Containers are written only by the functions above; suppliers directly.
alter table public.suppliers              enable row level security;
alter table public.containers             enable row level security;
alter table public.container_items        enable row level security;
alter table public.container_item_prices  enable row level security;
alter table public.container_expenses     enable row level security;
alter table public.product_costs          enable row level security;

drop policy if exists "containers read" on public.suppliers;
drop policy if exists "managers add suppliers" on public.suppliers;
drop policy if exists "managers edit suppliers" on public.suppliers;
drop policy if exists "admins delete suppliers" on public.suppliers;
create policy "containers read" on public.suppliers
  for select to authenticated using (public.has_permission('containers.view'));
create policy "managers add suppliers" on public.suppliers
  for insert to authenticated with check (public.has_permission('containers.manage'));
create policy "managers edit suppliers" on public.suppliers
  for update to authenticated using (public.has_permission('containers.manage'))
  with check (public.has_permission('containers.manage'));
create policy "admins delete suppliers" on public.suppliers
  for delete to authenticated using (public.has_permission('delete'));

drop policy if exists "containers read" on public.containers;
drop policy if exists "admins delete open containers" on public.containers;
create policy "containers read" on public.containers
  for select to authenticated using (public.has_permission('containers.view'));
create policy "admins delete open containers" on public.containers
  for delete to authenticated using (public.has_permission('delete') and status <> 'received');

drop policy if exists "containers read" on public.container_items;
create policy "containers read" on public.container_items
  for select to authenticated using (public.has_permission('containers.view'));

drop policy if exists "costs read" on public.container_item_prices;
create policy "costs read" on public.container_item_prices
  for select to authenticated using (public.has_permission('costs'));
drop policy if exists "costs read" on public.container_expenses;
create policy "costs read" on public.container_expenses
  for select to authenticated using (public.has_permission('costs'));
drop policy if exists "costs read" on public.product_costs;
create policy "costs read" on public.product_costs
  for select to authenticated using (public.has_permission('costs'));

-- =============================================================
-- Container lots (Level 2): what is left of each container, and its profit
-- First in, first out, per product across all stores. Every stock arrival
-- (opening, stock in, container) is a layer; sales and stock-outs use up the
-- oldest layers first, returns give back the most recently used units.
-- Worked out from stock_moves on the fly, so deleting a bill, a return or
-- reopening a container is always reflected; nothing extra is stored.
-- Transfers move stock between stores and do not touch layers.
-- =============================================================

-- One row per arrival. cum_lo..cum_hi is the layer's slice of everything that
-- arrived for the product; `remaining` is what is not used up yet.
create or replace view public.stock_layers with (security_invoker = true) as
  with ins as (
    select m.id as move_id, m.product_id, m.location_id, m.qty, m.kind, m.container_id, m.move_date, m.created_at,
           sum(m.qty) over (partition by m.product_id order by m.move_date, m.created_at, m.id) as cum_hi
      from public.stock_moves m
     where m.kind in ('opening', 'in', 'container_in')
  ),
  used as (
    -- sales and stock-outs are negative, returns positive
    select product_id, -sum(qty) as qty
      from public.stock_moves
     where kind in ('sale', 'out', 'sale_return')
     group by product_id
  )
  select ins.move_id, ins.product_id, ins.location_id, ins.kind, ins.container_id, ins.move_date, ins.created_at,
         ins.qty, ins.cum_hi - ins.qty as cum_lo, ins.cum_hi,
         greatest(0, least(ins.qty, ins.cum_hi - coalesce(u.qty, 0))) as remaining
    from ins
    left join used u on u.product_id = ins.product_id;

-- Per container and product: received and still in stock (quantities only, no money)
create or replace view public.container_stock with (security_invoker = true) as
  select container_id, product_id, sum(qty) as received, sum(remaining) as remaining
    from public.stock_layers
   where container_id is not null
   group by container_id, product_id;

-- ---------- container_profit(): sales matched to this container's goods ----------
-- Each sale, return and stock-out takes a slice of the product's running outflow;
-- the overlap of that slice with this container's layers is what came from it.
-- Revenue is at the invoice line rate (before any bill discount); cost is the landed cost.
create or replace function public.container_profit(p_container_id uuid)
returns table (product_id uuid, sold numeric, written_off numeric, revenue numeric, cost numeric, profit numeric)
language sql stable security definer set search_path = public as $$
  with layers as (
    select l.* from stock_layers l where l.container_id = p_container_id
  ),
  ev as (
    select m.product_id, m.kind, -m.qty as q, m.invoice_id, m.location_id,
           sum(-m.qty) over (partition by m.product_id order by m.move_date, m.created_at, m.id) as cum_after
      from stock_moves m
     where m.kind in ('sale', 'out', 'sale_return')
       and m.product_id in (select l.product_id from layers l)
  ),
  priced as (
    -- a bill can list the same product twice at one store: use their average rate
    select ev.*, ev.cum_after - ev.q as cum_before,
           coalesce((select sum(it.line_total) / nullif(sum(it.qty), 0) from invoice_items it
                      where it.invoice_id = ev.invoice_id and it.product_id = ev.product_id and it.location_id = ev.location_id), 0) as rate
      from ev
  ),
  matched as (
    select p.product_id, p.kind, p.rate, sign(p.q) *
           greatest(0, least(greatest(p.cum_before, p.cum_after), l.cum_hi) - greatest(least(p.cum_before, p.cum_after), l.cum_lo)) as qty
      from priced p
      join layers l on l.product_id = p.product_id
  ),
  totals as (
    select m.product_id,
           sum(m.qty) filter (where m.kind in ('sale', 'sale_return')) as sold,
           sum(m.qty) filter (where m.kind = 'out') as written_off,
           sum(m.qty * m.rate) filter (where m.kind in ('sale', 'sale_return')) as revenue
      from matched m
     group by m.product_id
  )
  -- Cost counts goods sold and written off (stock out): both are gone from this container
  select ci.product_id,
         coalesce(t.sold, 0), coalesce(t.written_off, 0), round(coalesce(t.revenue, 0), 2),
         round((coalesce(t.sold, 0) + coalesce(t.written_off, 0)) * coalesce(pr.landed_cost, 0), 2),
         round(coalesce(t.revenue, 0) - (coalesce(t.sold, 0) + coalesce(t.written_off, 0)) * coalesce(pr.landed_cost, 0), 2)
    from container_items ci
    join container_item_prices pr on pr.item_id = ci.id
    left join totals t on t.product_id = ci.product_id
   where ci.container_id = p_container_id
     and public.has_permission('costs')
$$;

revoke execute on function public.container_profit(uuid) from public, anon;
grant execute on function public.container_profit(uuid) to authenticated;

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
    ),
    -- RLS: zero for roles that cannot see containers
    'containers', jsonb_build_object(
      'on_the_way', (select count(*) from containers where status in ('shipped', 'at_port', 'clearing')),
      'ordered',    (select count(*) from containers where status = 'ordered'),
      'next_eta',   (select min(eta) from containers where status in ('shipped', 'at_port', 'clearing') and eta >= current_date)
    )
  )
$$;

-- ---------- Function permissions: signed-in users only ----------
revoke execute on function public.save_product(jsonb) from public, anon;
revoke execute on function public.import_products(jsonb, uuid) from public, anon;
revoke execute on function public.post_stock_entry(text, uuid, jsonb, uuid, date, text) from public, anon;
revoke execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text, uuid) from public, anon;
revoke execute on function public.price_history(uuid, uuid, integer) from public, anon;
revoke execute on function public.get_dashboard() from public, anon;
grant execute on function public.save_product(jsonb) to authenticated;
grant execute on function public.import_products(jsonb, uuid) to authenticated;
grant execute on function public.post_stock_entry(text, uuid, jsonb, uuid, date, text) to authenticated;
grant execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text, uuid) to authenticated;
grant execute on function public.price_history(uuid, uuid, integer) to authenticated;
grant execute on function public.get_dashboard() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- ---------- Row Level Security ----------
-- Everyone active can read products, stores and stock. Customers, invoices and receipts
-- are readable only by roles with 'sales' (not storekeepers). Only admins change settings
-- and delete. Invoices, stock and receipts are written by the functions above;
-- deleting them reverses stock and account automatically.
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.product_companies  enable row level security;
alter table public.brands             enable row level security;
alter table public.categories         enable row level security;
alter table public.products           enable row level security;
alter table public.locations          enable row level security;
alter table public.customers          enable row level security;
alter table public.invoices           enable row level security;
alter table public.invoice_items      enable row level security;
alter table public.receipts           enable row level security;
alter table public.stock_entries      enable row level security;
alter table public.stock_moves        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','product_companies','brands','categories','products','locations',
                           'stock_entries','stock_moves']
  loop
    execute format('create policy "active users read" on public.%I for select to authenticated using (public.is_active_user())', t);
  end loop;

  foreach t in array array['customers','invoices','invoice_items','receipts']
  loop
    execute format('create policy "sales read" on public.%I for select to authenticated using (public.has_permission(''sales''))', t);
  end loop;

  foreach t in array array['companies','product_companies','brands','categories','products','locations','customers']
  loop
    execute format('create policy "admins write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;

  foreach t in array array['invoices','receipts','stock_entries']
  loop
    execute format('create policy "admins delete" on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Cashiers may add customers (without an opening balance) and take payments
create policy "sales add customers" on public.customers
  for insert to authenticated with check (public.has_permission('sales') and opening_balance = 0);

-- Managers add and edit customers, including opening balance and credit limit
create policy "managers add customers" on public.customers
  for insert to authenticated with check (public.has_permission('customers.manage'));
create policy "managers edit customers" on public.customers
  for update to authenticated using (public.has_permission('customers.manage'))
  with check (public.has_permission('customers.manage'));

create policy "sales add receipts" on public.receipts
  for insert to authenticated with check (public.has_permission('sales') and invoice_id is null and created_by = auth.uid());

-- Admins and managers see everyone's name (the "By" columns); others only themselves
create policy "read own or reports" on public.profiles
  for select to authenticated using (id = auth.uid() or public.has_permission('reports'));
-- No write policies on profiles: changes go through the admin-users Edge Function (service role).

-- ---------- Cheque photos (private storage bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheques', 'cheques', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "sales upload cheques" on storage.objects
  for insert to authenticated with check (bucket_id = 'cheques' and public.has_permission('sales'));
create policy "sales read cheques" on storage.objects
  for select to authenticated using (bucket_id = 'cheques' and public.has_permission('sales'));

-- ---------- Starting data ----------
insert into public.companies (name, is_default) values ('Royal Stationers', true);

insert into public.locations (name, sort_order) values
  ('2nd Floor', 1), ('3rd Floor', 2), ('4th Floor', 3), ('First Floor', 4),
  ('Bahl Store', 5), ('Basement', 6), ('Racks', 7);

-- Walk-in customer for counter sales
insert into public.customers (name, city) values ('Counter Customer', 'Walk-in');

-- To continue numbering after the old software, e.g. next invoice = 14138:
--   select setval('public.invoice_no_seq', 14137);
