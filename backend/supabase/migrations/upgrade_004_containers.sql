-- =============================================================
-- Royal Stationers - upgrade 004: suppliers and import containers (Level 1)
-- For a database set up before containers existed (after upgrades 002 and 003).
-- New projects do not need this: setup.sql already includes it.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again.
-- =============================================================

begin;

-- ---------- Permissions: costs and containers ----------
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
--      items: [{ product_id, cartons, carton_qty, loose, cbm, weight, unit_price }],
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
    insert into container_items (container_id, product_id, cartons, carton_qty, loose, cbm, weight, sort_order)
    select v_id, (i->>'product_id')::uuid, private.num(i, 'cartons'), private.num(i, 'carton_qty', 1)::int,
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

-- ---------- Updated functions ----------
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

commit;
