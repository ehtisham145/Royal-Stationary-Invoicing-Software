import { today } from '../../shared/lib/format'

// A trip out longer than this shows in red
export const LATE_TRIP_HOURS = 4

export const isLateTrip = (trip, now = Date.now()) => trip.status === 'out' && now - new Date(trip.out_at).getTime() > LATE_TRIP_HOURS * 3600000

// A bill from an earlier day that still has not gone out
export const isOldPending = (bill) => bill.invoice_date < today()

export const cartonsText = (bill) => {
  const c = Number(bill.cartons)
  const parts = []
  if (c > 0) parts.push(`${c} ctn`)
  parts.push(`${bill.items} item${Number(bill.items) === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export const tripCash = (trip) => trip.invoices.reduce((s, b) => s + Number(b.cash || 0), 0)

// Counts for the dashboard
export function boardSummary(board, now = Date.now()) {
  return {
    pending: board.pending.length,
    oldPending: board.pending.filter(isOldPending).length,
    out: board.trips.length,
    late: board.trips.filter((t) => isLateTrip(t, now)).length,
  }
}

// Local day boundaries as timestamps, for the trip history filter ("2026-10-28" -> start of that day here)
export const dayStart = (date) => (date ? new Date(`${date}T00:00`).toISOString() : null)
export const dayEnd = (date) => {
  if (!date) return null
  const d = new Date(`${date}T00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}
