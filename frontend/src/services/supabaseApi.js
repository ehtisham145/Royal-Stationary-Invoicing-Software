import { supabase } from './supabase'
import { productPayload } from '../shared/lib/productFields'

function unwrap({ data, error }) {
  if (error) {
    if (error.code === '23505') {
      if (/products_code/i.test(error.message)) throw new Error('This code is already used by another product.')
      if (/products_name/i.test(error.message)) throw new Error('A product with this name already exists.')
      if (/customers_name_city/i.test(error.message)) throw new Error('A customer with this name already exists in this city.')
      if (/locations_name/i.test(error.message)) throw new Error('A store with this name already exists.')
      if (/containers_no/i.test(error.message)) throw new Error('A container with this number already exists.')
      if (/suppliers_name/i.test(error.message)) throw new Error('A supplier with this name already exists.')
      if (/delivery_staff_name/i.test(error.message)) throw new Error('A staff member with this name already exists.')
      throw new Error('This record already exists.')
    }
    if (error.code === '23503' && /return_of/i.test(error.message)) throw new Error('This invoice has returns against it. Delete those returns first.')
    if (error.code === '23503') throw new Error('This record is used in invoices or stock entries, so it cannot be deleted.')
    if (error.code === '42501') throw new Error('You do not have permission to do this.')
    throw new Error(error.message)
  }
  return data
}

// Supabase returns at most 1,000 rows per request; this pages through all of them.
// `build` must return a fresh query with a stable order.
async function selectAll(build, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(await build().range(from, from + pageSize - 1))
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

// ---------- Business profile & stores ----------

// Default company first; falls back to the oldest one.
export async function getDefaultCompany() {
  return unwrap(
    await supabase
      .from('companies')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  )
}

export async function saveCompany({ id, name, address, phone, email, ntn, strn, allow_negative_stock, default_margin }) {
  const row = { name, address, phone, email, ntn, strn, allow_negative_stock: Boolean(allow_negative_stock), default_margin: Number(default_margin) || 0 }
  if (id) return unwrap(await supabase.from('companies').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('companies').insert({ ...row, is_default: true }).select().single())
}

export async function listLocations() {
  return unwrap(await supabase.from('locations').select('*').order('sort_order').order('name'))
}

export async function saveLocation({ id, name, sort_order, active }) {
  const row = { name: String(name ?? '').trim(), sort_order: Number(sort_order) || 0, active: active ?? true }
  if (id) return unwrap(await supabase.from('locations').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('locations').insert(row).select().single())
}

// ---------- Products ----------

// product_costs is readable only with the 'costs' permission; for everyone else it comes back null
const PRODUCT_SELECT = '*, product_companies(name), brands(name), categories(name), product_costs(cost_price)'

const flattenProduct = ({ product_companies, brands, categories, product_costs, ...p }) => ({
  ...p,
  company: product_companies?.name ?? '',
  brand: brands?.name ?? '',
  category: categories?.name ?? '',
  cost_price: product_costs?.cost_price ?? null,
})

export async function listProducts() {
  const rows = await selectAll(() => supabase.from('products').select(PRODUCT_SELECT).order('name').order('id'))
  return rows.map(flattenProduct)
}

export async function getProduct(id) {
  return flattenProduct(unwrap(await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).single()))
}

// Names of existing companies, brands and categories (for suggestions)
export async function listLookups() {
  const [companies, brands, categories] = await Promise.all(
    ['product_companies', 'brands', 'categories'].map((t) => selectAll(() => supabase.from(t).select('name').order('name'))),
  )
  const names = (rows) => rows.map((r) => r.name)
  return { companies: names(companies), brands: names(brands), categories: names(categories) }
}

export async function saveProduct(form) {
  const id = unwrap(await supabase.rpc('save_product', { p: productPayload(form) }))
  return getProduct(id)
}

// Sent in chunks so a big file doesn't hit request limits. Each chunk is all-or-nothing.
export async function importProducts(forms, locationId, onProgress) {
  const CHUNK = 500
  let done = 0
  for (let i = 0; i < forms.length; i += CHUNK) {
    const rows = forms.slice(i, i + CHUNK).map(productPayload)
    try {
      done += unwrap(await supabase.rpc('import_products', { p_rows: rows, p_location_id: locationId || null }))
    } catch (e) {
      throw new Error(done ? `${done} products were imported, then it stopped: ${e.message}` : e.message)
    }
    onProgress?.(done)
  }
  return done
}

export async function deleteProduct(id) {
  return unwrap(await supabase.from('products').delete().eq('id', id))
}

// ---------- Stock ----------

// One row per product per store: { product_id, location_id, qty }
export async function listStockLevels() {
  return selectAll(() => supabase.from('stock_levels').select('product_id, location_id, qty').order('product_id').order('location_id'))
}

export async function getProductStock(productId) {
  return unwrap(await supabase.from('stock_levels').select('location_id, qty').eq('product_id', productId))
}

export async function postStockEntry({ kind, locationId, toLocationId, date, note, items }) {
  return unwrap(
    await supabase.rpc('post_stock_entry', {
      p_kind: kind,
      p_location_id: locationId,
      p_to_location_id: kind === 'transfer' ? toLocationId : null,
      p_entry_date: date,
      p_note: note || null,
      p_items: items.map((i) => ({ product_id: i.product_id, cartons: Number(i.cartons) || 0, loose: Number(i.loose) || 0 })),
    }),
  )
}

export async function listStockEntries({ from, to }) {
  return unwrap(
    await supabase
      .from('stock_entries')
      .select(
        `*, location:locations!stock_entries_location_id_fkey(name), to_location:locations!stock_entries_to_location_id_fkey(name),
         creator:profiles(name), stock_moves(qty, location_id, products(name, unit, carton_qty))`,
      )
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_no', { ascending: false }),
  )
}

export async function deleteStockEntry(id) {
  return unwrap(await supabase.from('stock_entries').delete().eq('id', id))
}

// Every movement of one product, oldest first
export async function getProductLedger(productId) {
  return selectAll(() =>
    supabase
      .from('stock_moves')
      .select(
        `id, qty, move_date, kind, created_at, location_id,
         invoices(id, invoice_no, customers(name, city)),
         stock_entries(id, entry_no, note, location_id, to_location_id),
         containers(id, container_no)`,
      )
      .eq('product_id', productId)
      .order('move_date')
      .order('created_at')
      .order('id'),
  )
}

// ---------- Customers ----------

export async function listCustomers() {
  return selectAll(() => supabase.from('customers').select('*').order('name').order('id'))
}

// { [customer_id]: balance }
export async function listBalances() {
  const rows = await selectAll(() => supabase.from('customer_balances').select('customer_id, balance').order('customer_id'))
  return Object.fromEntries(rows.map((r) => [r.customer_id, Number(r.balance)]))
}

export async function getCustomer(id) {
  return unwrap(await supabase.from('customers').select('*').eq('id', id).single())
}

export async function getCustomerBalance(id) {
  const row = unwrap(await supabase.from('customer_balances').select('balance').eq('customer_id', id).maybeSingle())
  return Number(row?.balance ?? 0)
}

export async function saveCustomer(row, id) {
  if (id) return unwrap(await supabase.from('customers').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('customers').insert(row).select().single())
}

export async function deleteCustomer(id) {
  return unwrap(await supabase.from('customers').delete().eq('id', id))
}

export async function getCustomerLedger(id) {
  return selectAll(() =>
    supabase
      .from('customer_ledger')
      .select('*')
      .eq('customer_id', id)
      .order('entry_date', { ascending: true, nullsFirst: true })
      .order('created_at')
      .order('seq'),
  )
}

// ---------- Receipts ----------

export async function listReceipts({ from, to }) {
  return selectAll(() =>
    supabase
      .from('receipts')
      .select('*, customers(id, name, city), invoices(invoice_no), creator:profiles(name)')
      .gte('receipt_date', from)
      .lte('receipt_date', to)
      .order('receipt_no', { ascending: false }),
  )
}

export async function createReceipt({ customerId, date, amount, method, reference, note }) {
  return unwrap(
    await supabase
      .from('receipts')
      .insert({
        customer_id: customerId,
        receipt_date: date,
        amount: Number(amount),
        method,
        reference: reference?.trim() || null,
        note: note?.trim() || null,
      })
      .select()
      .single(),
  )
}

export async function deleteReceipt(id) {
  return unwrap(await supabase.from('receipts').delete().eq('id', id))
}

// ---------- Invoices ----------

// Blank from / to = no limit on that side. `customerId` narrows to one customer.
export async function listInvoices({ from, to, customerId }) {
  const rows = await selectAll(() => {
    let query = supabase
      .from('invoices')
      .select('id, invoice_no, invoice_date, txn_type, payment_mode, delivery_mode, bilty_no, total, received, created_by, customers(id, name, city), creator:profiles(name)')
    if (from) query = query.gte('invoice_date', from)
    if (to) query = query.lte('invoice_date', to)
    if (customerId) query = query.eq('customer_id', customerId)
    return query.order('invoice_no', { ascending: false })
  })
  return rows.map((r) => ({ ...r, created_by_name: r.creator?.name ?? null }))
}

export async function getInvoice(id) {
  const doc = unwrap(
    await supabase
      .from('invoices')
      .select('*, companies(*), customers(*), invoice_items(*, locations(name)), creator:profiles(name)')
      .eq('id', id)
      .order('sort_order', { referencedTable: 'invoice_items' })
      .single(),
  )
  // Return: the sale it is against. Sale: the returns made against it.
  const [original, returns] = await Promise.all([
    doc.return_of ? supabase.from('invoices').select('id, invoice_no, invoice_date').eq('id', doc.return_of).single().then(unwrap) : null,
    doc.txn_type === 'sale'
      ? supabase.from('invoices').select('id, invoice_no, invoice_date, total').eq('return_of', id).order('invoice_no').then(unwrap)
      : [],
  ])
  return { ...doc, items: doc.invoice_items, created_by_name: doc.creator?.name ?? null, original, returns }
}

// A customer's sale invoices, newest first (to pick the one a return is against)
export async function listCustomerSales(customerId) {
  return unwrap(
    await supabase
      .from('invoices')
      .select('id, invoice_no, invoice_date, total')
      .eq('customer_id', customerId)
      .eq('txn_type', 'sale')
      .order('invoice_no', { ascending: false })
      .limit(200),
  )
}

// Lines of a sale invoice with how much is still left to return
export async function getReturnableItems(invoiceId) {
  const items = unwrap(
    await supabase
      .from('invoice_items')
      .select('id, product_id, product_name, unit, carton_qty, location_id, qty, unit_price')
      .eq('invoice_id', invoiceId)
      .order('sort_order'),
  )
  const returned = items.length
    ? unwrap(await supabase.from('invoice_items').select('return_of_item, qty').in('return_of_item', items.map((i) => i.id)))
    : []
  const done = {}
  for (const r of returned) done[r.return_of_item] = (done[r.return_of_item] ?? 0) + Number(r.qty)
  return items.map((i) => ({ ...i, returned: done[i.id] ?? 0, left: Number(i.qty) - (done[i.id] ?? 0) }))
}

// Every line this customer bought or returned, oldest first
export async function listCustomerItems(customerId) {
  const rows = await selectAll(() =>
    supabase
      .from('invoice_items')
      .select('id, product_id, product_name, unit, carton_qty, qty, unit_price, line_total, invoices!inner(id, invoice_no, invoice_date, txn_type, customer_id)')
      .eq('invoices.customer_id', customerId)
      .order('id'),
  )
  return rows.sort((a, b) => a.invoices.invoice_date.localeCompare(b.invoices.invoice_date) || a.invoices.invoice_no - b.invoices.invoice_no)
}

// Invoice numbers are unique, so this finds at most one
export async function findInvoiceId(invoiceNo) {
  const row = unwrap(await supabase.from('invoices').select('id').eq('invoice_no', invoiceNo).maybeSingle())
  return row?.id ?? null
}

// Cheque photos live in the private 'cheques' bucket; the invoice keeps the path.
export async function uploadChequeImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
  unwrap(await supabase.storage.from('cheques').upload(path, file, { contentType: file.type }))
  return path
}

export async function getChequeImageUrl(path) {
  return unwrap(await supabase.storage.from('cheques').createSignedUrl(path, 60 * 60)).signedUrl
}

// Returns the new invoice id. A cheque photo is uploaded first, then saved with the invoice.
// returnOf: the sale invoice a return is against; its lines then carry return_item_id.
export async function createInvoice({ customerId, items, date, txnType, paymentMode, deliveryMode, biltyNo, discount, freight, received, notes, chequeFile, returnOf }) {
  const chequeImage = paymentMode === 'cheque' && chequeFile ? await uploadChequeImage(chequeFile) : null
  return unwrap(
    await supabase.rpc('create_invoice', {
      p_customer_id: customerId,
      p_items: items.map((i) => ({
        product_id: i.product_id,
        location_id: i.location_id,
        cartons: Number(i.cartons) || 0,
        loose: Number(i.loose) || 0,
        unit_price: Number(i.unit_price),
        ...(returnOf && { return_item_id: i.return_item_id }),
      })),
      p_invoice_date: date,
      p_txn_type: txnType,
      p_payment_mode: paymentMode,
      p_delivery_mode: deliveryMode,
      p_bilty_no: biltyNo || null,
      p_discount: Number(discount) || 0,
      p_freight: Number(freight) || 0,
      p_received: Number(received) || 0,
      p_notes: notes || null,
      p_cheque_image: chequeImage,
      p_return_of: returnOf || null,
    }),
  )
}

// Deleting reverses its stock movements and any payment taken with it
export async function deleteInvoice(id) {
  return unwrap(await supabase.from('invoices').delete().eq('id', id))
}

export async function getPriceHistory(customerId, productId) {
  return unwrap(await supabase.rpc('price_history', { p_customer_id: customerId, p_product_id: productId, p_limit: 5 }))
}

// ---------- Suppliers ----------

export async function listSuppliers() {
  return selectAll(() => supabase.from('suppliers').select('*').order('name').order('id'))
}

export async function saveSupplier(row, id) {
  if (id) return unwrap(await supabase.from('suppliers').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('suppliers').insert(row).select().single())
}

export async function deleteSupplier(id) {
  return unwrap(await supabase.from('suppliers').delete().eq('id', id))
}

// ---------- Containers ----------
// Prices and expenses are in separate tables that only the 'costs' permission can read;
// `withCosts` asks for them (without the permission they come back empty).

export async function listContainers() {
  return selectAll(() =>
    supabase
      .from('containers')
      .select('*, supplier:suppliers(name), container_items(cartons, qty, cbm, weight, supplier_id)')
      .order('order_date', { ascending: false })
      .order('id'),
  )
}

export async function getContainer(id, { withCosts = false } = {}) {
  const items = withCosts ? 'container_items(*, supplier:suppliers(name), container_item_prices(*))' : 'container_items(*, supplier:suppliers(name))'
  const doc = unwrap(
    await supabase
      .from('containers')
      .select(`*, supplier:suppliers(id, name), ${items}${withCosts ? ', container_expenses(*)' : ''}`)
      .eq('id', id)
      .order('sort_order', { referencedTable: 'container_items' })
      .single(),
  )
  const { container_items, container_expenses, ...rest } = doc
  return {
    ...rest,
    items: container_items.map(({ container_item_prices: price, ...it }) => ({ ...it, price: price ?? null })),
    expenses: [...(container_expenses ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }
}

// Returns the container id
export async function saveContainer(form) {
  return unwrap(await supabase.rpc('save_container', { p: form }))
}

// lines: [{ item_id, location_id, cartons, loose }]
export async function receiveContainer(id, lines, date) {
  return unwrap(await supabase.rpc('receive_container', { p_container_id: id, p_lines: lines, p_date: date }))
}

export async function reopenContainer(id) {
  return unwrap(await supabase.rpc('reopen_container', { p_container_id: id }))
}

export async function deleteContainer(id) {
  return unwrap(await supabase.from('containers').delete().eq('id', id))
}

// Container lots need upgrade_006_container_lots.sql. They are extra information on pages that
// work without them, so callers use `optional()` to show the page even when that upgrade is missing.
export const optional = (promise, fallback = {}) =>
  promise.catch((e) => {
    console.warn('Optional data not available:', e.message)
    return fallback
  })

// What is left of a container, first in first out: { [product_id]: { received, remaining } }
export async function getContainerStock(containerId) {
  const rows = unwrap(await supabase.from('container_stock').select('product_id, received, remaining').eq('container_id', containerId))
  return Object.fromEntries(rows.map((r) => [r.product_id, { received: Number(r.received), remaining: Number(r.remaining) }]))
}

// Every received container: { [container_id]: { received, remaining } } across its products
export async function listContainerStock() {
  const rows = await selectAll(() => supabase.from('container_stock').select('container_id, product_id, received, remaining').order('container_id').order('product_id'))
  const out = {}
  for (const r of rows) {
    const t = (out[r.container_id] ??= { received: 0, remaining: 0 })
    t.received += Number(r.received)
    t.remaining += Number(r.remaining)
  }
  return out
}

// Sales matched to a container's goods (needs the 'costs' permission): { [product_id]: { sold, written_off, revenue, cost, profit } }
export async function getContainerProfit(containerId) {
  const rows = unwrap(await supabase.rpc('container_profit', { p_container_id: containerId }))
  return Object.fromEntries(rows.map((r) => [r.product_id, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'product_id' ? v : Number(v)]))]))
}

// { [container_id]: remaining } of one product
export async function getProductLots(productId) {
  const rows = unwrap(await supabase.from('container_stock').select('container_id, remaining').eq('product_id', productId))
  return Object.fromEntries(rows.map((r) => [r.container_id, Number(r.remaining)]))
}

// { [product_id]: qty } of goods in containers that are shipped, at port or clearing
export async function listOnTheWay() {
  const rows = await selectAll(() => supabase.from('product_on_the_way').select('product_id, qty').order('product_id'))
  return Object.fromEntries(rows.map((r) => [r.product_id, Number(r.qty)]))
}

// Containers that carry this product, newest first
export async function getProductContainers(productId) {
  const rows = unwrap(
    await supabase
      .from('container_items')
      .select('qty, received_qty, supplier:suppliers(name), containers(id, container_no, status, eta, order_date, received_date, supplier:suppliers(name))')
      .eq('product_id', productId),
  )
  return rows.filter((r) => r.containers).sort((a, b) => (b.containers.order_date ?? '').localeCompare(a.containers.order_date ?? ''))
}

// ---------- Delivery (needs upgrade_008_delivery.sql) ----------
// Store keepers cannot read invoices, so bills on trips come from security definer functions
// (delivery_board, delivery_trips) that return only what a delivery needs.

export async function listDeliveryStaff() {
  return unwrap(await supabase.from('delivery_staff').select('*').order('name'))
}

export async function saveDeliveryStaff({ name, phone, active }, id) {
  const row = { name: String(name ?? '').trim(), phone: String(phone ?? '').trim() || null, active: active ?? true }
  if (id) return unwrap(await supabase.from('delivery_staff').update(row).eq('id', id).select().single())
  return unwrap(await supabase.from('delivery_staff').insert(row).select().single())
}

export async function deleteDeliveryStaff(id) {
  return unwrap(await supabase.from('delivery_staff').delete().eq('id', id))
}

// { pending: [bills waiting for a trip], trips: [trips that are out] }
export async function getDeliveryBoard() {
  return unwrap(await supabase.rpc('delivery_board'))
}

// Trips that went out between two moments (ISO timestamps), newest first
export async function listTrips({ from, to }) {
  return unwrap(await supabase.rpc('delivery_trips', { p_from: from || null, p_to: to || null }))
}

export async function getTrip(id) {
  const rows = unwrap(await supabase.rpc('delivery_trips', { p_trip_id: id }))
  if (!rows.length) throw new Error('Trip not found.')
  return rows[0]
}

export async function startTrip({ staffId, invoiceIds, vehicle, notes }) {
  return unwrap(await supabase.rpc('start_trip', { p_staff_id: staffId, p_invoice_ids: invoiceIds, p_vehicle: vehicle || null, p_notes: notes || null }))
}

// lines: [{ invoice_id, status: 'delivered' | 'returned', cash }]
export async function closeTrip(id, lines) {
  return unwrap(await supabase.rpc('close_trip', { p_trip_id: id, p_lines: lines }))
}

export async function cancelTrip(id) {
  return unwrap(await supabase.rpc('cancel_trip', { p_trip_id: id }))
}

export async function markPickedUp(invoiceId) {
  return unwrap(await supabase.rpc('mark_picked_up', { p_invoice_id: invoiceId }))
}

// The trips one bill went on, oldest first (shown on the invoice)
export async function getInvoiceTrips(invoiceId) {
  const rows = unwrap(
    await supabase
      .from('delivery_trip_invoices')
      .select('status, cash, delivery_trips(id, trip_no, status, out_at, back_at, delivery_staff(name))')
      .eq('invoice_id', invoiceId),
  )
  return rows.filter((r) => r.delivery_trips).sort((a, b) => a.delivery_trips.out_at.localeCompare(b.delivery_trips.out_at))
}

// ---------- Dashboard ----------
// All totals are calculated in the database (get_dashboard in setup.sql).

export async function getDashboard() {
  return unwrap(await supabase.rpc('get_dashboard'))
}

// ---------- Users (admin only) ----------
// Reading uses the profiles table; changes go through the `admin-users` Edge Function,
// because creating users and setting passwords needs the service role key (server only).

export async function getProfile(userId) {
  return unwrap(await supabase.from('profiles').select('name, email, role, active, created_at').eq('id', userId).maybeSingle())
}

export async function listUsers() {
  return unwrap(await supabase.from('profiles').select('*').order('created_at'))
}

async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || error.message)
  }
  return data
}

export const createUser = (user) => adminUsers({ action: 'create', ...user })
export const updateUser = (id, changes) => adminUsers({ action: 'update', id, ...changes })
export const setUserPassword = (id, password) => adminUsers({ action: 'password', id, password })
export const deleteUser = (id) => adminUsers({ action: 'delete', id })
