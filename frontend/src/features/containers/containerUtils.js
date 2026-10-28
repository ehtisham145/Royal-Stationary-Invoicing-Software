// Container math (preview while editing) and packing list CSV import.
// The database does the real calculation when the container is received
// (private.container_costing in backend/supabase/setup.sql); keep the two in step.
import { normKey, parseCSV } from '../../shared/lib/productFields'

const n = (v) => {
  const x = Number(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(x) ? x : 0
}

export const lineQty = (l) => n(l.cartons) * (n(l.carton_qty) || 1) + n(l.loose)

export function packingTotals(lines) {
  return lines.reduce(
    (t, l) => ({
      cartons: t.cartons + n(l.cartons),
      qty: t.qty + lineQty(l),
      cbm: t.cbm + n(l.cartons) * n(l.cbm),
      weight: t.weight + n(l.cartons) * n(l.weight),
      value: t.value + lineQty(l) * n(l.unit_price),
    }),
    { cartons: 0, qty: 0, cbm: 0, weight: 0, value: 0 },
  )
}

// Per line: goods in Rs, share of expenses, landed cost per unit.
// Expenses are shared by CBM, value or cartons; equally by quantity when that total is 0.
export function landedCosts(lines, { exchangeRate, costBasis, expenses }) {
  const rate = n(exchangeRate)
  const totalExpenses = expenses.reduce((s, e) => s + n(e.amount), 0)
  const weightOf = (l) => (costBasis === 'cbm' ? n(l.cartons) * n(l.cbm) : costBasis === 'value' ? lineQty(l) * n(l.unit_price) : n(l.cartons))
  const totalWeight = lines.reduce((s, l) => s + weightOf(l), 0)
  const totalQty = lines.reduce((s, l) => s + lineQty(l), 0)
  return lines.map((l) => {
    const qty = lineQty(l)
    const goods = qty * n(l.unit_price) * rate
    const share = totalWeight > 0 ? (totalExpenses * weightOf(l)) / totalWeight : totalQty > 0 ? (totalExpenses * qty) / totalQty : 0
    return { goods, share, landed: qty > 0 ? (goods + share) / qty : 0 }
  })
}

export const suggestedPrice = (landed, marginPercent) => landed * (1 + n(marginPercent) / 100)

// ---------- Packing list CSV ----------

const HEADERS = {
  code: ['code', 'product code', 'item code', 'sku', 'item no', 'art no'],
  name: ['name', 'product', 'product name', 'item', 'item name', 'description'],
  cartons: ['cartons', 'ctns', 'ctn', 'carton', 'no of cartons', 'total cartons'],
  carton_qty: ['carton qty', 'qty/ctn', 'qty per carton', 'pcs/ctn', 'pcs per carton', 'packing'],
  loose: ['loose', 'extra'],
  cbm: ['cbm', 'cbm/ctn', 'cbm per carton', 'c.b.m'],
  weight: ['weight', 'kg', 'kg/ctn', 'gw', 'g.w', 'gross weight'],
  unit_price: ['price', 'unit price', 'rate', 'usd', 'rmb', 'price/pc'],
  supplier: ['supplier', 'shop', 'vendor', 'factory'],
}

export const PACKING_TEMPLATE_CSV = [
  ['code', 'name', 'cartons', 'carton qty', 'cbm', 'price', 'supplier'],
  ['003628', 'STAPLER PIN NEXT # 10', '40', '50', '0.045', '0.12', ''],
  ['', 'TAPE CHANYI CY1262 200YD', '120', '36', '0.041', '0.35', 'Chanyi Tape Factory'],
].map((r) => r.join(',')).join('\r\n')

// Rows matched to products by code, then by name. Unmatched rows keep their name for creating the product.
// The optional supplier column is matched by name; blank = the container's supplier.
export function readPackingList(text, products, suppliers = []) {
  const [header, ...body] = parseCSV(text)
  if (!header) return { error: 'The file is empty.' }
  const cols = {}
  header.forEach((h, i) => {
    const k = normKey(h)
    for (const [field, aliases] of Object.entries(HEADERS)) if (aliases.includes(k) && cols[field] === undefined) cols[field] = i
  })
  if (cols.code === undefined && cols.name === undefined) return { error: 'The file needs a "code" or "name" column.' }
  if (cols.cartons === undefined) return { error: 'The file needs a "cartons" column.' }

  const byCode = new Map(products.map((p) => [normKey(p.code), p]))
  const byName = new Map(products.map((p) => [normKey(p.name), p]))
  const supplierByName = new Map(suppliers.map((s) => [normKey(s.name), s]))
  const seen = new Set()
  const rows = body.map((cells, i) => {
    const get = (f) => (cols[f] === undefined ? '' : String(cells[cols[f]] ?? '').trim())
    const product = byCode.get(normKey(get('code'))) ?? byName.get(normKey(get('name'))) ?? null
    const supplierName = get('supplier')
    const supplier = supplierName ? (supplierByName.get(normKey(supplierName)) ?? null) : null
    const row = {
      line: i + 2,
      code: get('code'),
      name: get('name'),
      product,
      cartons: get('cartons'),
      carton_qty: get('carton_qty') || String(product?.carton_qty ?? 1),
      loose: get('loose'),
      cbm: get('cbm') || String(product?.cbm ?? ''),
      weight: get('weight'),
      unit_price: get('unit_price'),
      supplier_id: supplier?.id ?? '',
      supplier_name: supplier?.name ?? supplierName,
      errors: [],
    }
    if (!product) row.errors.push('No product with this code or name')
    if (supplierName && !supplier) row.errors.push(`No supplier named "${supplierName}" (add it under Suppliers first)`)
    if (product && seen.has(product.id)) row.errors.push('Same product appears earlier in the file')
    if (lineQty(row) <= 0) row.errors.push('Quantity is 0')
    for (const f of ['cartons', 'carton_qty', 'loose', 'cbm', 'weight', 'unit_price']) {
      if (row[f] !== '' && (!Number.isFinite(Number(String(row[f]).replace(/,/g, ''))) || n(row[f]) < 0)) row.errors.push(`${f.replace('_', ' ')} is not a number`)
    }
    if (product) seen.add(product.id)
    return row
  })
  return { rows }
}
