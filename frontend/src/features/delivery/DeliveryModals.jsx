import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { closeTrip, deleteDeliveryStaff, saveDeliveryStaff, startTrip } from '../../services/api'
import { MAX_AMOUNT, cleanAmount, money, num, timeText } from '../../shared/lib/format'
import { ErrorBanner, Field, Modal, StatusBadge } from '../../shared/components/ui'
import { useAuth } from '../../app/auth/AuthProvider'
import { cartonsText } from './deliveryUtils'

// ---------- Send the ticked bills out with one staff member ----------
export function StartTripModal({ bills, staff, busyStaff, onClose, onSaved }) {
  const active = staff.filter((s) => s.active)
  const [staffId, setStaffId] = useState(active.length === 1 ? active[0].id : '')
  const [vehicle, setVehicle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cartons = bills.reduce((s, b) => s + Number(b.cartons), 0)
  const alreadyOut = staffId && busyStaff.includes(staffId)

  async function handleSave(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await startTrip({ staffId, invoiceIds: bills.map((b) => b.invoice_id), vehicle, notes }))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Send for delivery"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="trip-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Send and print slip'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <p className="modal-intro text-secondary">
        {bills.length} bill{bills.length === 1 ? '' : 's'}
        {cartons > 0 && ` · ${num(cartons)} cartons`}: {bills.map((b) => `#${b.invoice_no} ${b.customer_name}`).join(', ')}. The time out is saved
        automatically.
      </p>
      <form id="trip-form" className="form-grid" onSubmit={handleSave}>
        <div className="span-all">
          <Field label="Who is taking the goods" hint={alreadyOut ? 'This person is already out on another trip.' : undefined}>
            <select className="input" required value={staffId} onChange={(e) => setStaffId(e.target.value)} autoFocus>
              <option value="">Choose staff member</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Vehicle">
          <input className="input" value={vehicle} maxLength={40} placeholder="Optional, e.g. LES-1234" onChange={(e) => setVehicle(e.target.value)} />
        </Field>
        <Field label="Note">
          <input className="input" value={notes} maxLength={200} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}

// ---------- Staff member is back: what happened to each bill, and cash ----------
export function CloseTripModal({ trip, onClose, onSaved }) {
  const [lines, setLines] = useState(() => trip.invoices.map((b) => ({ ...b, status: 'delivered', cashText: '' })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (id, patch) => setLines((prev) => prev.map((l) => (l.invoice_id === id ? { ...l, ...patch } : l)))
  const cashError = (l) => (Number(l.cashText) > MAX_AMOUNT ? `Cannot be more than ${money(MAX_AMOUNT)}.` : '')
  const totalCash = lines.reduce((s, l) => s + (Number(l.cashText) || 0), 0)
  const delivered = lines.filter((l) => l.status === 'delivered').length

  async function handleSave(e) {
    e.preventDefault()
    if (lines.some(cashError)) return
    setBusy(true)
    setError('')
    try {
      await closeTrip(
        trip.id,
        lines.map((l) => ({ invoice_id: l.invoice_id, status: l.status, cash: Number(l.cashText) || 0 })),
      )
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Close trip ${trip.trip_no} · ${trip.staff_name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="close-trip-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : `Close trip${totalCash > 0 ? ` · cash ${money(totalCash)}` : ''}`}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <p className="modal-intro text-secondary">
        Left at {timeText(trip.out_at)}. The time back is saved automatically. Cash entered here is added to the customer's account as a receipt
        (in {trip.staff_name}'s name). Count it before saving.
      </p>
      <form id="close-trip-form" onSubmit={handleSave}>
        <div className="table-scroll">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Customer</th>
                <th className="num hide-sm">Amount</th>
                <th>What happened</th>
                <th className="num">Cash taken (Rs)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.invoice_id}>
                  <td className="strong nowrap">#{l.invoice_no}</td>
                  <td>
                    <div className="cell-stack">
                      <span className="strong">{l.customer_name}</span>
                      <span className="text-muted">{cartonsText(l)}</span>
                    </div>
                  </td>
                  <td className="num hide-sm">{l.total === null ? '—' : money(l.total)}</td>
                  <td>
                    <div className="segmented">
                      <button type="button" className={l.status === 'delivered' ? 'active' : ''} onClick={() => set(l.invoice_id, { status: 'delivered' })}>
                        Delivered
                      </button>
                      <button type="button" className={l.status === 'returned' ? 'active' : ''} onClick={() => set(l.invoice_id, { status: 'returned' })}>
                        Came back
                      </button>
                    </div>
                  </td>
                  <td className="num">
                    <input
                      className="input input-num input-sm cash-input"
                      inputMode="decimal"
                      placeholder="0"
                      maxLength={13}
                      aria-label={`Cash for bill ${l.invoice_no}`}
                      ref={(el) => el?.setCustomValidity(cashError(l))}
                      value={l.cashText}
                      onChange={(e) => set(l.invoice_id, { cashText: cleanAmount(e.target.value) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint">
          {delivered} of {lines.length} delivered. "Came back" puts the bill back in the waiting list. If only part of a bill was taken, mark it
          delivered and make a return for the rest.
        </p>
      </form>
    </Modal>
  )
}

// ---------- Delivery staff: names only, they do not log in ----------
const EMPTY = { name: '', phone: '', active: true }

export function StaffModal({ staff, onClose, onChanged }) {
  const { can } = useAuth()
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const edit = (s) => {
    setEditingId(s.id)
    setForm({ name: s.name, phone: s.phone ?? '', active: s.active })
    setError('')
  }
  const reset = () => {
    setEditingId(null)
    setForm(EMPTY)
  }

  async function handleSave(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await saveDeliveryStaff(form, editingId)
      await onChanged()
      reset()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function remove() {
    if (!window.confirm(`Delete ${form.name}? Someone who has been on trips cannot be deleted; mark them inactive instead.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteDeliveryStaff(editingId)
      await onChanged()
      reset()
    } catch (err) {
      setError(/used in/.test(err.message) ? `${form.name} has been on trips, so mark them inactive instead.` : err.message)
    }
    setBusy(false)
  }

  return (
    <Modal title="Delivery staff" onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      <p className="modal-intro text-secondary">The people who take goods to customers. They don't need a login.</p>
      {staff.length > 0 && (
        <table className="table table-compact staff-table">
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className={`row-link ${s.active ? '' : 'row-dim'} ${editingId === s.id ? 'row-selected' : ''}`} onClick={() => edit(s)}>
                <td className="strong">{s.name}</td>
                <td className="text-secondary">{s.phone || '—'}</td>
                <td>
                  <StatusBadge status={s.active ? 'active' : 'inactive'} />
                </td>
                <td>
                  <div className="row-actions">
                    <Pencil size={15} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ErrorBanner message={error} />
      <form className="form-grid staff-form" onSubmit={handleSave}>
        <div className="span-all meta-label">{editingId ? `Edit ${staff.find((s) => s.id === editingId)?.name ?? ''}` : 'Add a staff member'}</div>
        <Field label="Name">
          <input className="input" required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className="input" inputMode="tel" maxLength={20} placeholder="Optional" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        {editingId && (
          <label className="toggle span-all">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (can be sent on trips)
          </label>
        )}
        <div className="span-all form-footer">
          {editingId && can('delete') && (
            <button type="button" className="btn btn-danger-ghost" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          {editingId && (
            <button type="button" className="btn btn-secondary" onClick={reset} disabled={busy}>
              Cancel edit
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add staff member'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
