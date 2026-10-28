// Product fields, units, duplicate rules and CSV import helpers.

export const UNITS = ['Pc', 'Box', 'Dozen', 'Gurus', 'Carton', 'Pkt', 'Roll', 'Set', 'Ream', 'Pair', 'Kg', 'Mtr']

// `suggest` = type an existing name or a new one (created on save)
export const PRODUCT_FIELDS = [
  { key: 'name', label: 'Product name', required: true, autoFocus: true, full: true },
  { key: 'code', label: 'Code', placeholder: 'Auto if blank' },
  { key: 'unit', label: 'Unit (U.O.M)', required: true, options: UNITS },
  { key: 'company', label: 'Company', suggest: 'companies', placeholder: 'e.g. China' },
  { key: 'brand', label: 'Brand', suggest: 'brands' },
  { key: 'category', label: 'Category', suggest: 'categories', placeholder: 'e.g. Pen' },
  { key: 'carton_qty', label: 'Carton qty', type: 'number', required: true, hint: 'Units in one carton' },
  { key: 'inner_qty', label: 'Inner qty', type: 'number', placeholder: '0' },
  { key: 'reorder_level', label: 'Reorder level', type: 'number', placeholder: '0', hint: 'Low-stock alert at or below this' },
  { key: 'price', label: 'Sale price (Rs)', type: 'number', required: true },
  { key: 'min_price', label: 'Min price (Rs)', type: 'number', placeholder: '0' },
  { key: 'max_price', label: 'Max price (Rs)', type: 'number', placeholder: '0 = no maximum' },
  { key: 'cbm', label: 'C.B.M (per carton)', type: 'number', placeholder: '0' },
  { key: 'cost_price', label: 'Cost price (Rs)', type: 'number', placeholder: 'Set by containers', hint: 'Average landed cost per unit. Updated when a container is received.' },
  { key: 'description', label: 'Description', textarea: true, full: true, placeholder: 'Size, colour, packing… (optional)' },
]

export const EMPTY_PRODUCT = {
  name: '', code: '', unit: 'Pc', company: '', brand: '', category: '',
  carton_qty: '1', inner_qty: '', reorder_level: '', price: '', min_price: '', max_price: '', cbm: '', cost_price: '', description: '',
}

const NUMERIC = ['carton_qty', 'inner_qty', 'reorder_level', 'price', 'min_price', 'max_price', 'cbm', 'cost_price']

// Names and codes are compared ignoring case and surrounding spaces
export const normKey = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const toNumber = (v) => (String(v ?? '').trim() === '' ? 0 : Number(String(v).replace(/,/g, '').trim()))

// Product as the edit form expects it (strings, lookup names)
export const productForm = (p) =>
  Object.fromEntries(Object.keys(EMPTY_PRODUCT).map((k) => [k, p[k] === null || p[k] === undefined ? '' : String(p[k])]))

// Payload for the save_product() / import_products() database functions
export const productPayload = (f) => ({
  ...(f.id ? { id: f.id } : {}),
  name: String(f.name ?? '').trim().replace(/\s+/g, ' '),
  code: String(f.code ?? '').trim(),
  unit: f.unit || 'Pc',
  company: String(f.company ?? '').trim(),
  brand: String(f.brand ?? '').trim(),
  category: String(f.category ?? '').trim(),
  description: String(f.description ?? '').trim(),
  ...Object.fromEntries(NUMERIC.filter((k) => k !== 'cost_price').map((k) => [k, k === 'carton_qty' ? toNumber(f[k]) || 1 : toNumber(f[k])])),
  // Left out when blank, so saving a product never wipes its cost
  ...(String(f.cost_price ?? '').trim() !== '' ? { cost_price: toNumber(f.cost_price) } : {}),
  ...(f.stock !== undefined ? { stock: toNumber(f.stock) } : {}),
})

// Returns an error message, or '' when the product is valid
export function validateProduct(f, existing = []) {
  for (const k of NUMERIC) {
    const n = toNumber(f[k])
    if (!Number.isFinite(n) || n < 0) return `${PRODUCT_FIELDS.find((x) => x.key === k).label} must be a number, 0 or more.`
  }
  const carton = toNumber(f.carton_qty)
  if (!Number.isInteger(carton) || carton < 1) return 'Carton qty must be a whole number, 1 or more.'
  if (!Number.isInteger(toNumber(f.inner_qty))) return 'Inner qty must be a whole number.'
  const max = toNumber(f.max_price)
  const price = toNumber(f.price)
  if (max > 0 && max < toNumber(f.min_price)) return 'Max price cannot be less than min price.'
  if (toNumber(f.min_price) > price) return 'Min price cannot be more than the sale price.'
  if (max > 0 && price > max) return 'Sale price cannot be more than the max price.'

  const name = normKey(f.name)
  const code = normKey(f.code)
  const others = existing.filter((p) => p.id !== f.id)
  if (name && others.some((p) => normKey(p.name) === name)) return `A product named "${f.name.trim()}" already exists.`
  if (code && others.some((p) => normKey(p.code) === code)) return `Code "${f.code.trim()}" is already used by another product.`
  return ''
}

// ---------- CSV ----------

export function parseCSV(text) {
  text = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

const HEADER_ALIASES = {
  name: ['name', 'product', 'product name', 'item', 'item name'],
  code: ['code', 'product code', 'item code', 'sku', 'id'],
  unit: ['unit', 'uom', 'u.o.m'],
  company: ['company', 'maker'],
  brand: ['brand'],
  category: ['category', 'group'],
  carton_qty: ['carton qty', 'carton_qty', 'ctn qty', 'qty/ctn', 'qty per carton', 'pack'],
  inner_qty: ['inner qty', 'inner_qty', 'inner'],
  price: ['price', 'sale price', 's.price', 'rate', 'unit price'],
  min_price: ['min', 'min price', 'min_price'],
  max_price: ['max', 'max price', 'max_price'],
  reorder_level: ['reorder', 'reorder level', 'reorder_level'],
  cbm: ['cbm', 'c.b.m'],
  cost_price: ['cost', 'cost price', 'cost_price', 'purchase price'],
  stock: ['stock', 'opening stock', 'qty', 'quantity'],
  description: ['description', 'details', 'desc'],
}

const UNIT_ALIASES = {
  pc: 'Pc', pcs: 'Pc', piece: 'Pc', pieces: 'Pc', nos: 'Pc',
  doz: 'Dozen', dozens: 'Dozen', gross: 'Gurus', guru: 'Gurus',
  ctn: 'Carton', cartons: 'Carton', pkt: 'Pkt', packet: 'Pkt', pack: 'Pkt',
  rolls: 'Roll', sets: 'Set', boxes: 'Box', reams: 'Ream', pairs: 'Pair', kgs: 'Kg', meter: 'Mtr', metre: 'Mtr',
}

// "pcs", "BOX", "doz" -> Pc, Box, Dozen. Unknown units are kept as typed.
function matchUnit(raw) {
  const k = normKey(raw)
  return UNITS.find((u) => u.toLowerCase() === k) ?? UNIT_ALIASES[k] ?? String(raw).trim()
}

const TEMPLATE_ROWS = [
  ['code', 'name', 'unit', 'company', 'brand', 'category', 'carton qty', 'inner qty', 'price', 'min price', 'max price', 'reorder level', 'cbm', 'stock'],
  ['', 'TAPE CHANYI CY1262 200YD', 'Pc', 'China', 'Chanyi', 'Tape', '36', '0', '505', '495', '0', '100', '0.041', '9024'],
  ['003628', 'STAPLER PIN NEXT # 10', 'Box', 'China', 'Next', 'Stapler Pin', '50', '0', '120', '110', '0', '0', '0', '120'],
]

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const TEMPLATE_CSV = TEMPLATE_ROWS.map((r) => r.map(csvCell).join(',')).join('\r\n')

// Turns CSV text into rows with per-row errors, checked against the catalog and the file itself
export function readImport(text, existing) {
  const [header, ...body] = parseCSV(text)
  if (!header) return { error: 'The file is empty.' }

  const cols = {}
  header.forEach((h, i) => {
    const k = normKey(h)
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(k) && cols[field] === undefined) cols[field] = i
  })
  const missing = ['name', 'price'].filter((f) => cols[f] === undefined)
  if (missing.length) return { error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template to see the format.` }

  // Sets, not validateProduct(form, existing): files can have thousands of rows
  const existingNames = new Set(existing.map((p) => normKey(p.name)))
  const existingCodes = new Set(existing.map((p) => normKey(p.code)))
  const seenNames = new Set()
  const seenCodes = new Set()
  const rows = body.map((cells, i) => {
    const get = (f) => (cols[f] === undefined ? '' : String(cells[cols[f]] ?? '').trim())
    const form = Object.fromEntries(Object.keys(HEADER_ALIASES).map((f) => [f, get(f)]))
    form.unit = form.unit ? matchUnit(form.unit) : 'Pc'
    if (!form.carton_qty) form.carton_qty = '1'

    const errors = []
    if (!form.name) errors.push('Name is missing')
    if (form.price === '') errors.push('Price is missing')
    const problem = validateProduct(form)
    if (problem) errors.push(problem)
    const stock = toNumber(form.stock)
    if (!Number.isFinite(stock)) errors.push('Stock must be a number')

    const n = normKey(form.name)
    const c = normKey(form.code)
    if (n && existingNames.has(n)) errors.push('A product with this name already exists')
    if (c && existingCodes.has(c)) errors.push('This code is already used')
    if (n && seenNames.has(n)) errors.push('Same name appears earlier in the file')
    if (c && seenCodes.has(c)) errors.push('Same code appears earlier in the file')
    if (n) seenNames.add(n)
    if (c) seenCodes.add(c)

    return { line: i + 2, form, errors }
  })
  return { rows }
}
