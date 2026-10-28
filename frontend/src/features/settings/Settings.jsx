import { useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, LogOut, Pencil, Plus, X } from 'lucide-react'
import { getDefaultCompany, listLocations, saveCompany, saveLocation } from '../../services/api'
import { validateWithin } from '../../shared/lib/formValidation'
import { ROLE_LABELS, initials } from '../../shared/lib/format'
import { useAuth } from '../../app/auth/AuthProvider'
import { ErrorBanner, Field, Loading, PageHeader } from '../../shared/components/ui'

const EMPTY = { name: '', address: '', phone: '', email: '', ntn: '', strn: '', allow_negative_stock: false, default_margin: 0 }

export default function Settings() {
  const { user, signOut } = useAuth()
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDefaultCompany()
      .then((c) => setForm(c ?? EMPTY))
      .catch((e) => setError(e.message))
  }, [])

  const set = (k) => (e) => {
    setSaved(false)
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setForm(await saveCompany(form))
      setSaved(true)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Business profile, stock rules, stores and account." />
      <ErrorBanner message={error} />

      <div className="settings">
        <form className="card" onSubmit={handleSave}>
          <div className="card-head card-head-tight">
            <div>
              <h3>Business profile</h3>
              <p className="text-secondary">Shown on every invoice and packing slip.</p>
            </div>
          </div>

          {!form ? (
            <Loading />
          ) : (
            <>
              <div className="form-grid">
                <div className="span-all">
                  <Field label="Business name">
                    <input className="input" required value={form.name ?? ''} onChange={set('name')} />
                  </Field>
                </div>
                <Field label="Phone">
                  <input className="input" value={form.phone ?? ''} onChange={set('phone')} placeholder="0300-4625471, 0323-4106428" />
                </Field>
                <Field label="Email">
                  <input className="input" type="email" value={form.email ?? ''} onChange={set('email')} />
                </Field>
                <Field label="NTN">
                  <input className="input" value={form.ntn ?? ''} onChange={set('ntn')} />
                </Field>
                <Field label="STRN">
                  <input className="input" value={form.strn ?? ''} onChange={set('strn')} />
                </Field>
                <div className="span-all">
                  <Field label="Address">
                    <textarea className="input" rows={2} value={form.address ?? ''} onChange={set('address')} />
                  </Field>
                </div>
                <Field label="Margin for suggested price (%)">
                  <input
                    className="input input-num"
                    inputMode="decimal"
                    value={form.default_margin ?? 0}
                    onChange={set('default_margin')}
                    ref={(el) => {
                      const m = Number(form.default_margin ?? 0)
                      el?.setCustomValidity(Number.isFinite(m) && m >= 0 && m <= 1000 ? '' : 'Margin must be a number from 0 to 1000.')
                    }}
                  />
                  <span className="field-note">Containers suggest a sale price of landed cost + this margin.</span>
                </Field>
                <div className="span-all">
                  <label className="setting-row">
                    <input type="checkbox" checked={Boolean(form.allow_negative_stock)} onChange={set('allow_negative_stock')} />
                    <span>
                      <span className="strong">Allow selling more than the stock in a store</span>
                      <span className="text-muted">
                        Off (recommended): a sale or transfer is blocked when the store doesn't have enough. On: stock can go below zero, like the old
                        software.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="card-actions">
                {saved && (
                  <span className="saved-note">
                    <CheckCircle2 size={16} /> Saved
                  </span>
                )}
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </form>

        <div className="dash-stack">
          <Locations />

          <div className="card">
            <div className="card-head card-head-tight">
              <div>
                <h3>Account</h3>
                <p className="text-secondary">You are signed in as</p>
              </div>
            </div>
            <div className="party">
              <div className="avatar">{initials(user?.name || user?.email)}</div>
              <div>
                <div className="strong">{user?.name}</div>
                <div className="text-muted">
                  {user?.email} · {ROLE_LABELS[user?.role]}
                </div>
              </div>
            </div>
            <div className="card-actions">
              <button className="btn btn-secondary" onClick={signOut}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// Store locations: add, rename, reorder, hide. Stores with stock history are hidden, not deleted.
function Locations() {
  const editRef = useRef(null)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { id?, name, sort_order, active }

  useEffect(() => {
    listLocations().then(setRows).catch((e) => setError(e.message))
  }, [])

  async function save(row) {
    if (!row.name.trim()) {
      validateWithin(editRef.current)
      return
    }
    setError('')
    try {
      const saved = await saveLocation(row)
      setRows((prev) => [...prev.filter((r) => r.id !== saved.id), saved].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
      setEditing(null)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="card">
      <div className="card-head card-head-tight">
        <div>
          <h3>Stores</h3>
          <p className="text-secondary">Floors and godowns where stock is kept.</p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setEditing({ name: '', sort_order: (rows?.length ?? 0) + 1, active: true })}
          disabled={!rows}
        >
          <Plus size={16} /> Add
        </button>
      </div>
      <ErrorBanner message={error} />
      {!rows ? (
        <Loading />
      ) : (
        <ul className="location-list">
          {[...rows, ...(editing && !editing.id ? [editing] : [])].map((l) =>
            editing && (editing.id ? editing.id === l.id : l === editing) ? (
              <li key={l.id ?? 'new'} className="location-edit" ref={editRef}>
                <input
                  className="input input-sm"
                  aria-label="Store name"
                  required
                  autoFocus
                  value={editing.name}
                  placeholder="Store name"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(editing)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
                <input
                  className="input input-sm input-num location-order"
                  inputMode="numeric"
                  value={editing.sort_order}
                  title="Order"
                  onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })}
                />
                <button className="icon-btn ok" onClick={() => save(editing)} aria-label="Save">
                  <Check size={16} />
                </button>
                <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Cancel">
                  <X size={16} />
                </button>
              </li>
            ) : (
              <li key={l.id} className={l.active ? '' : 'row-dim'}>
                <span className="strong">{l.name}</span>
                {!l.active && <span className="status status-neutral">Hidden</span>}
                <span className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => save({ ...l, active: !l.active })}>
                    {l.active ? 'Hide' : 'Show'}
                  </button>
                  <button className="icon-btn" onClick={() => setEditing({ ...l })} aria-label={`Rename ${l.name}`}>
                    <Pencil size={16} />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
