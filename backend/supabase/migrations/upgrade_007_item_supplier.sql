-- =============================================================
-- Royal Stationers - upgrade 007: a supplier per packing list line (mixed containers)
-- Needs upgrade_004_containers.sql to have been run first.
-- New projects do not need this: setup.sql already includes it.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again. Existing containers keep working:
-- their lines have no supplier of their own, so they use the container's supplier.
-- =============================================================

begin;

-- Mixed containers (an agent fills one container from several shops): a line can name its own
-- supplier. Null = the container's supplier.
alter table public.container_items add column if not exists supplier_id uuid references public.suppliers(id);
create index if not exists container_items_supplier_idx on public.container_items (supplier_id) where supplier_id is not null;

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

commit;
