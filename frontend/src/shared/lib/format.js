const moneyFmt = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  minimumFractionDigits: 2,
})

const compactFmt = new Intl.NumberFormat('en-PK', { notation: 'compact', maximumFractionDigits: 1 })
const numFmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 })

export const money = (n) => moneyFmt.format(Number(n) || 0)

// Largest amount accepted in one entry (Rs 10 crore)
export const MAX_AMOUNT = 100000000

// Money as the user types it: digits and one decimal point, at most 2 decimals.
// Letters, commas and spaces are dropped: "12,500.505" -> "12500.50", "abc" -> ""
export function cleanAmount(text) {
  const [whole, ...rest] = String(text ?? '').replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}

export const compactMoney = (n) => `Rs ${compactFmt.format(Number(n) || 0)}`
export const num = (n) => numFmt.format(Number(n) || 0)

// 'T00:00' makes a YYYY-MM-DD string parse as local time, not UTC
export const formatDate = (d) =>
  d ? new Date(`${d}T00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''

const pad = (n) => String(n).padStart(2, '0')
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Local date as YYYY-MM-DD (toISOString would give the UTC date)
export const today = () => toISODate(new Date())

export const addDays = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

// Quick date ranges for list filters. Blank = no limit.
export const DATE_PRESETS = [
  { value: 'month', label: 'This month', range: () => ({ from: monthStart(), to: today() }) },
  { value: '3m', label: '3 months', range: () => ({ from: addDays(-90), to: today() }) },
  { value: 'year', label: 'This year', range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: today() }) },
  { value: 'all', label: 'All', range: () => ({ from: '', to: '' }) },
]

export const monthStart = () => {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export const initials = (text = '') =>
  text
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?'

export const BUSINESS_NAME = 'Royal Stationers'

export { ROLE_LABELS } from './permissions'

const round2 = (n) => Math.round(n * 100) / 100

// ---------- Cartons + loose ----------
// Quantities are stored in the product's unit; cartons are only for entry and display.

export const toQty = (cartons, loose, cartonQty) =>
  round2((Number(cartons) || 0) * (Number(cartonQty) || 1) + (Number(loose) || 0))

export function splitQty(qty, cartonQty) {
  const n = Number(qty) || 0
  const per = Number(cartonQty) || 1
  const abs = Math.abs(n)
  const cartons = per > 1 ? Math.floor(abs / per) : 0
  const loose = round2(abs - cartons * per)
  const sign = n < 0 ? -1 : 1
  return { cartons: sign * cartons, loose: sign * loose }
}

// 1836 Pc with 36/ctn -> "51 ctn", 1840 -> "51 ctn + 4 Pc", carton qty 1 -> "1,840 Pc"
// short: drop the unit after loose when cartons are shown ("51 ctn + 4")
export function qtyText(qty, unit, cartonQty, { short = false } = {}) {
  const n = Number(qty) || 0
  const neg = n < 0 ? '−' : ''
  if (!(Number(cartonQty) > 1)) return `${neg}${num(Math.abs(n))} ${unit}`
  const { cartons, loose } = splitQty(Math.abs(n), cartonQty)
  const parts = []
  if (cartons) parts.push(`${num(cartons)} ctn`)
  if (loose || !cartons) parts.push(short && cartons ? num(loose) : `${num(loose)} ${unit}`)
  return neg + parts.join(' + ')
}

export const TXN_LABELS = { sale: 'Sale', return: 'Return' }
export const PAYMENT_LABELS = { credit: 'Credit', cash: 'Cash', cheque: 'Cheque' }
export const DELIVERY_LABELS = { counter: 'Counter', bilty: 'Bilty', delivery: 'Delivery' }
export const METHOD_LABELS = { cash: 'Cash', bank: 'Bank', cheque: 'Cheque' }
export const ENTRY_LABELS = { opening: 'Opening stock', in: 'Stock in', out: 'Stock out', transfer: 'Transfer' }

// Container status as shown: Ordered, On the way, Received. The database also allows
// 'at_port' and 'clearing' (older containers); they show as "On the way".
export const CONTAINER_STATUSES = [
  { value: 'ordered', label: 'Ordered', tone: 'status-neutral' },
  { value: 'shipped', label: 'On the way', tone: 'status-info' },
  { value: 'at_port', label: 'On the way', tone: 'status-info' },
  { value: 'clearing', label: 'On the way', tone: 'status-info' },
  { value: 'received', label: 'Received', tone: 'status-good' },
]
export const ON_THE_WAY = ['shipped', 'at_port', 'clearing']
export const CURRENCIES = ['USD', 'RMB', 'PKR']

// Delivery bills: where the goods are. Bills made before delivery tracking have no status.
export const DELIVERY_STATUSES = {
  pending: { label: 'Waiting for delivery', tone: 'status-warning' },
  out: { label: 'Out for delivery', tone: 'status-info' },
  delivered: { label: 'Delivered', tone: 'status-good' },
  picked_up: { label: 'Picked up at shop', tone: 'status-good' },
}
// A bill on one trip
export const TRIP_LINE_LABELS = { out: 'Out', delivered: 'Delivered', returned: 'Came back' }

// "28 Oct, 11:20 am"; today's times show the time only
export function timeText(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  return toISODate(d) === today() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`
}

// Milliseconds as "2 hr 15 min" / "40 min"
export function durationText(ms) {
  const mins = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(mins / 60)
  return h ? `${h} hr${mins % 60 ? ` ${mins % 60} min` : ''}` : `${mins} min`
}

// Preview only - the database recalculates these when saving.
export function computeInvoice(items, discount, freight) {
  const subtotal = round2(
    items.reduce((s, i) => s + round2(toQty(i.cartons, i.loose, i.carton_qty) * (Number(i.unit_price) || 0)), 0),
  )
  const disc = Number(discount) || 0
  const frt = Number(freight) || 0
  return { subtotal, discount: disc, freight: frt, total: round2(subtotal - disc + frt) }
}
