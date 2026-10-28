-- =============================================================
-- Royal Stationers - upgrade 006: container lots (what is left of each container, and its profit)
-- Needs upgrade_004_containers.sql to have been run first.
-- New projects do not need this: setup.sql already includes it.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again. It only adds views and a function.
-- =============================================================

begin;

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

commit;
