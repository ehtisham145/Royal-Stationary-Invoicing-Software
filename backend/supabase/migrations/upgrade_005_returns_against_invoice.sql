-- =============================================================
-- Royal Stationers - upgrade: sale returns against an invoice
-- A return is linked to the sale invoice it gives back; it can only contain items
-- from that bill, at the billed rate, and never more than was sold minus earlier returns.
-- Returns without an invoice: managers and administrators only.
-- New projects do not need this: setup.sql already includes it.
-- Needs upgrade_003_cheque_payment.sql to have been run first.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again.
-- =============================================================

begin;

alter table public.invoices add column if not exists return_of uuid references public.invoices(id);
create index if not exists invoices_return_of_idx on public.invoices (return_of) where return_of is not null;
alter table public.invoice_items add column if not exists return_of_item uuid references public.invoice_items(id);
create index if not exists invoice_items_return_of_idx on public.invoice_items (return_of_item) where return_of_item is not null;

-- ---------- create_invoice(): new p_return_of parameter ----------
drop function if exists public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text);

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

revoke execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text, uuid) to authenticated;

commit;
