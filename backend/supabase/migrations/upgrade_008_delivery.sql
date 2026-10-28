-- =============================================================
-- Royal Stationers - upgrade 008: delivery trips (who took which bills, when, and cash collected)
-- Needs upgrade_002_four_roles.sql to have been run first.
-- New projects do not need this: setup.sql already includes it.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again. Bills made before this upgrade
-- are not tracked; only new bills with delivery "Delivery" show up as pending.
-- =============================================================

begin;

alter table public.invoices add column if not exists delivery_status text
  check (delivery_status in ('pending', 'out', 'delivered', 'picked_up'));
create index if not exists invoices_delivery_pending_idx on public.invoices (created_at) where delivery_status = 'pending';

-- Roles and what they may do. Keep in sync with frontend/src/shared/lib/permissions.js.
--   admin        everything
--   manager      everything except users, settings and deleting
--   cashier      sales, receipts, adding customers
--   storekeeper  stock entries, containers (no prices), sending deliveries; no sales, money or customers
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
             when 'delivery'           then role in ('admin', 'manager', 'storekeeper')
             when 'delivery.manage'    then role in ('admin', 'manager')
             when 'delete'           then role = 'admin'
             when 'users'            then role = 'admin'
             when 'settings'         then role = 'admin'
             else false
           end)
$$;

-- =============================================================
-- Delivery: our own staff take bills to customers in trips
-- A sale bill with delivery "Delivery" starts as pending. The store keeper puts
-- pending bills on a trip with one staff member (time out is stamped by the
-- database). When the staff member is back, a manager closes the trip: each bill
-- is delivered or came back (back to pending), and any cash the staff member
-- collected becomes a receipt in the customer's account.
-- =============================================================

-- Delivery staff do not log in; they are just names
create table if not exists public.delivery_staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (trim(name) <> ''),
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists delivery_staff_name_unique on public.delivery_staff (lower(trim(name)));

create sequence if not exists public.delivery_trip_no_seq;

create table if not exists public.delivery_trips (
  id          uuid primary key default gen_random_uuid(),
  trip_no     bigint not null unique default nextval('public.delivery_trip_no_seq'),
  staff_id    uuid not null references public.delivery_staff(id),
  vehicle     text,
  notes       text,
  status      text not null default 'out' check (status in ('out', 'closed')),
  out_at      timestamptz not null default now(),
  back_at     timestamptz,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  closed_by   uuid references public.profiles(id) on delete set null
);
create index if not exists delivery_trips_out_idx on public.delivery_trips (out_at);
create index if not exists delivery_trips_staff_idx on public.delivery_trips (staff_id, out_at);

create table if not exists public.delivery_trip_invoices (
  trip_id     uuid not null references public.delivery_trips(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  status      text not null default 'out' check (status in ('out', 'delivered', 'returned')),
  cash        numeric(14,2) not null default 0 check (cash >= 0),  -- collected from the customer on this trip
  receipt_id  uuid references public.receipts(id) on delete set null,
  primary key (trip_id, invoice_id)
);
-- A bill can be on one trip at a time, and never again once delivered
create unique index if not exists delivery_trip_invoices_one_active on public.delivery_trip_invoices (invoice_id) where status <> 'returned';

-- New sale bills with delivery "Delivery" wait for a trip. Bills made before this
-- feature have no status and are not tracked.
create or replace function public.set_invoice_delivery_status()
returns trigger language plpgsql as $$
begin
  new.delivery_status := case when new.txn_type = 'sale' and new.delivery_mode = 'delivery' then 'pending' end;
  return new;
end;
$$;
drop trigger if exists invoices_delivery_status on public.invoices;
create trigger invoices_delivery_status
  before insert on public.invoices
  for each row execute function public.set_invoice_delivery_status();

-- The bills on a trip, for screens and the delivery slip. Amounts only for roles with 'sales'.
create or replace function private.trip_json(p_trip_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'trip_no', t.trip_no, 'status', t.status, 'vehicle', t.vehicle, 'notes', t.notes,
    'out_at', t.out_at, 'back_at', t.back_at,
    'staff_id', t.staff_id, 'staff_name', s.name, 'staff_phone', s.phone,
    'created_by_name', cb.name, 'closed_by_name', cl.name,
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
        'invoice_id', i.id, 'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date,
        'customer_id', c.id, 'customer_name', c.name, 'customer_city', c.city,
        'customer_phone', c.phone, 'customer_address', c.address,
        'cartons', x.cartons, 'items', x.items,
        'total', case when public.has_permission('sales') then i.total end,
        'status', ti.status, 'cash', ti.cash
      ) order by i.invoice_no), '[]'::jsonb)
      from delivery_trip_invoices ti
      join invoices i on i.id = ti.invoice_id
      join customers c on c.id = i.customer_id
      cross join lateral (select coalesce(sum(it.cartons), 0) as cartons, count(*) as items
                            from invoice_items it where it.invoice_id = i.id) x
     where ti.trip_id = t.id)
  )
  from delivery_trips t
  join delivery_staff s on s.id = t.staff_id
  left join profiles cb on cb.id = t.created_by
  left join profiles cl on cl.id = t.closed_by
  where t.id = p_trip_id
$$;

-- ---------- delivery_board(): bills waiting for a trip, and trips that are out ----------
create or replace function public.delivery_board()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('delivery') then
    raise exception 'You do not have permission to see deliveries';
  end if;
  return jsonb_build_object(
    'pending', (select coalesce(jsonb_agg(jsonb_build_object(
        'invoice_id', i.id, 'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date, 'created_at', i.created_at,
        'customer_name', c.name, 'customer_city', c.city, 'customer_phone', c.phone,
        'cartons', x.cartons, 'items', x.items,
        'total', case when public.has_permission('sales') then i.total end,
        'came_back', (select count(*) from delivery_trip_invoices r where r.invoice_id = i.id and r.status = 'returned')
      ) order by i.created_at), '[]'::jsonb)
      from invoices i
      join customers c on c.id = i.customer_id
      cross join lateral (select coalesce(sum(it.cartons), 0) as cartons, count(*) as items
                            from invoice_items it where it.invoice_id = i.id) x
     where i.delivery_status = 'pending'),
    'trips', (select coalesce(jsonb_agg(private.trip_json(t.id) order by t.out_at), '[]'::jsonb)
                from delivery_trips t where t.status = 'out')
  );
end;
$$;

-- ---------- delivery_trips(): trips that went out between two moments, or one trip ----------
create or replace function public.delivery_trips(p_from timestamptz default null, p_to timestamptz default null, p_trip_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('delivery') then
    raise exception 'You do not have permission to see deliveries';
  end if;
  return (select coalesce(jsonb_agg(private.trip_json(t.id) order by t.out_at desc), '[]'::jsonb)
            from delivery_trips t
           where (p_trip_id is null or t.id = p_trip_id)
             and (p_from is null or t.out_at >= p_from)
             and (p_to is null or t.out_at < p_to));
end;
$$;

-- ---------- start_trip(): staff member leaves with these bills ----------
create or replace function public.start_trip(p_staff_id uuid, p_invoice_ids uuid[], p_vehicle text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_ids   uuid[] := array(select distinct x from unnest(coalesce(p_invoice_ids, '{}')) x where x is not null);
begin
  if not public.has_permission('delivery') then
    raise exception 'You do not have permission to send deliveries';
  end if;
  if not exists (select 1 from delivery_staff where id = p_staff_id and active) then
    raise exception 'Choose who is taking the goods';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'Select at least one bill';
  end if;
  perform 1 from invoices where id = any(v_ids) order by id for update;
  if (select count(*) from invoices where id = any(v_ids) and delivery_status = 'pending') <> cardinality(v_ids) then
    raise exception 'Some of these bills are already out or delivered. Refresh the page.';
  end if;

  insert into delivery_trips (staff_id, vehicle, notes)
  values (p_staff_id, nullif(trim(p_vehicle), ''), nullif(trim(p_notes), ''))
  returning id into v_id;
  insert into delivery_trip_invoices (trip_id, invoice_id) select v_id, x from unnest(v_ids) x;
  update invoices set delivery_status = 'out' where id = any(v_ids);
  return v_id;
end;
$$;

-- ---------- close_trip(): staff member is back ----------
-- p_lines: [{ invoice_id, status: 'delivered' | 'returned', cash }]. Every bill on the trip needs a line.
create or replace function public.close_trip(p_trip_id uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_trip   delivery_trips;
  v_staff  text;
  l        record;
  v_rec    uuid;
begin
  if not public.has_permission('delivery.manage') then
    raise exception 'Only a manager or administrator can close a trip';
  end if;
  select * into v_trip from delivery_trips where id = p_trip_id for update;
  if not found then
    raise exception 'Trip not found';
  end if;
  if v_trip.status <> 'out' then
    raise exception 'This trip is already closed';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' then
    raise exception 'Invalid trip lines';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct x->>'invoice_id') from jsonb_array_elements(p_lines) x) then
    raise exception 'A bill is listed twice';
  end if;
  if exists (select 1 from delivery_trip_invoices ti
              where ti.trip_id = p_trip_id
                and not exists (select 1 from jsonb_array_elements(p_lines) x
                                 where x->>'invoice_id' = ti.invoice_id::text and x->>'status' in ('delivered', 'returned'))) then
    raise exception 'Mark every bill as delivered or came back';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x where private.num(x, 'cash') < 0 or private.num(x, 'cash') > 100000000) then
    raise exception 'Cash must be between 0 and 100,000,000';
  end if;

  select name into v_staff from delivery_staff where id = v_trip.staff_id;
  for l in
    select ti.invoice_id, i.invoice_no, i.customer_id, x->>'status' as status, round(private.num(x, 'cash'), 2) as cash
      from delivery_trip_invoices ti
      join invoices i on i.id = ti.invoice_id
      join jsonb_array_elements(p_lines) x on x->>'invoice_id' = ti.invoice_id::text
     where ti.trip_id = p_trip_id
  loop
    v_rec := null;
    if l.cash > 0 then
      insert into receipts (customer_id, amount, method, note)
      values (l.customer_id, l.cash, 'cash', format('Collected by %s on delivery trip %s (bill %s)', v_staff, v_trip.trip_no, l.invoice_no))
      returning id into v_rec;
    end if;
    update delivery_trip_invoices set status = l.status, cash = l.cash, receipt_id = v_rec
     where trip_id = p_trip_id and invoice_id = l.invoice_id;
    update invoices set delivery_status = case when l.status = 'delivered' then 'delivered' else 'pending' end
     where id = l.invoice_id;
  end loop;

  update delivery_trips set status = 'closed', back_at = now(), closed_by = auth.uid() where id = p_trip_id;
  return p_trip_id;
end;
$$;

-- ---------- cancel_trip(): made by mistake, nothing left the shop ----------
create or replace function public.cancel_trip(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('delivery.manage') then
    raise exception 'Only a manager or administrator can cancel a trip';
  end if;
  perform 1 from delivery_trips where id = p_trip_id and status = 'out' for update;
  if not found then
    raise exception 'Only a trip that is still out can be cancelled';
  end if;
  update invoices set delivery_status = 'pending'
   where id in (select invoice_id from delivery_trip_invoices where trip_id = p_trip_id);
  delete from delivery_trips where id = p_trip_id;
end;
$$;

-- ---------- mark_picked_up(): the customer took a pending bill from the shop himself ----------
create or replace function public.mark_picked_up(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('delivery.manage') then
    raise exception 'Only a manager or administrator can do this';
  end if;
  update invoices set delivery_status = 'picked_up' where id = p_invoice_id and delivery_status = 'pending';
  if not found then
    raise exception 'This bill is not waiting for delivery';
  end if;
end;
$$;

revoke execute on function public.delivery_board() from public, anon;
revoke execute on function public.delivery_trips(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.start_trip(uuid, uuid[], text, text) from public, anon;
revoke execute on function public.close_trip(uuid, jsonb) from public, anon;
revoke execute on function public.cancel_trip(uuid) from public, anon;
revoke execute on function public.mark_picked_up(uuid) from public, anon;
grant execute on function public.delivery_board() to authenticated;
grant execute on function public.delivery_trips(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.start_trip(uuid, uuid[], text, text) to authenticated;
grant execute on function public.close_trip(uuid, jsonb) to authenticated;
grant execute on function public.cancel_trip(uuid) to authenticated;
grant execute on function public.mark_picked_up(uuid) to authenticated;

-- ---------- Row Level Security (delivery) ----------
-- Staff and trips: store keepers (delivery) and sales roles (to see it on the bill).
-- Trips are written only by the functions above; staff by managers.
alter table public.delivery_staff          enable row level security;
alter table public.delivery_trips          enable row level security;
alter table public.delivery_trip_invoices  enable row level security;

drop policy if exists "delivery read" on public.delivery_staff;
drop policy if exists "managers add staff" on public.delivery_staff;
drop policy if exists "managers edit staff" on public.delivery_staff;
drop policy if exists "admins delete staff" on public.delivery_staff;
drop policy if exists "delivery read" on public.delivery_trips;
drop policy if exists "delivery read" on public.delivery_trip_invoices;

create policy "delivery read" on public.delivery_staff
  for select to authenticated using (public.has_permission('delivery') or public.has_permission('sales'));
create policy "managers add staff" on public.delivery_staff
  for insert to authenticated with check (public.has_permission('delivery.manage'));
create policy "managers edit staff" on public.delivery_staff
  for update to authenticated using (public.has_permission('delivery.manage'))
  with check (public.has_permission('delivery.manage'));
create policy "admins delete staff" on public.delivery_staff
  for delete to authenticated using (public.has_permission('delete'));
create policy "delivery read" on public.delivery_trips
  for select to authenticated using (public.has_permission('delivery') or public.has_permission('sales'));
create policy "delivery read" on public.delivery_trip_invoices
  for select to authenticated using (public.has_permission('delivery') or public.has_permission('sales'));

commit;
