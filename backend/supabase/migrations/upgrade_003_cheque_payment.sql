-- =============================================================
-- Royal Stationers - upgrade: cheque payment on invoices (with cheque photo)
-- For a database created before cheque payments were added.
-- New projects do not need this: setup.sql already includes it.
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run.
-- It runs in one transaction and is safe to run again.
-- =============================================================

begin;

-- ---------- Invoices: cheque payment + photo ----------
alter table public.invoices drop constraint if exists invoices_payment_mode_check;
alter table public.invoices add constraint invoices_payment_mode_check
  check (payment_mode in ('cash', 'credit', 'cheque'));
alter table public.invoices add column if not exists cheque_image text;

-- ---------- create_invoice(): new p_cheque_image parameter ----------
drop function if exists public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text);

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
  p_cheque_image   text    default null
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

  insert into invoices (company_id, customer_id, invoice_date, txn_type, payment_mode, delivery_mode, bilty_no, cheque_image,
                        subtotal, discount, freight, total, prev_balance, received, notes, created_by)
  values (v_company.id, p_customer_id, v_date, p_txn_type, p_payment_mode, p_delivery_mode, nullif(trim(p_bilty_no), ''),
          case when p_payment_mode = 'cheque' then trim(p_cheque_image) end,
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
            case when p_payment_mode = 'cheque' then 'cheque' else 'cash' end,
            case when p_txn_type = 'sale' then 'With invoice #' else 'Refund for return #' end || v_no,
            v_id, auth.uid());
  end if;

  return v_id;
end;
$$;

revoke execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.create_invoice(uuid, jsonb, date, text, text, text, text, numeric, numeric, numeric, text, text) to authenticated;

-- ---------- Cheque photos (private storage bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheques', 'cheques', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "sales upload cheques" on storage.objects;
create policy "sales upload cheques" on storage.objects
  for insert to authenticated with check (bucket_id = 'cheques' and public.has_permission('sales'));
drop policy if exists "sales read cheques" on storage.objects;
create policy "sales read cheques" on storage.objects
  for select to authenticated using (bucket_id = 'cheques' and public.has_permission('sales'));

commit;
