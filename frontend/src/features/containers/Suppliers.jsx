import { useEffect, useMemo, useState } from 'react'
import { Factory, Plus, Search } from 'lucide-react'
import { listSuppliers } from '../../services/api'
import { num } from '../../shared/lib/format'
import { matchesWords } from '../../shared/lib/search'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'
import { SupplierModal } from '../../shared/components/RecordModals'

const byName = (a, b) => a.name.localeCompare(b.name)

export default function Suppliers() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // {} = new

  useEffect(() => {
    listSuppliers().then(setRows).catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(
    () => (rows ?? []).filter((s) => matchesWords(q, s.name, s.country, s.city, s.contact_person, s.phone)),
    [rows, q],
  )

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy from. Containers are linked to a supplier."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})} disabled={!rows}>
            <Plus size={16} /> Add supplier
          </button>
        }
      />

      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search by name, country or contact" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {rows && <span className="text-secondary toolbar-count">{num(filtered.length)} suppliers</span>}
        </div>

        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && (
          <EmptyState
            icon={Factory}
            title="No suppliers yet"
            text="Add the companies you import from."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
                <Plus size={16} /> Add supplier
              </button>
            }
          />
        )}
        {rows && rows.length > 0 && filtered.length === 0 && <EmptyState icon={Search} title="No matches" />}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th className="hide-sm">Contact</th>
                <th>Currency</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="row-link" onClick={() => setEditing(s)}>
                  <td>
                    <div className="cell-stack">
                      <span className="strong">{s.name}</span>
                      <span className="text-muted">{[s.city, s.country].filter(Boolean).join(', ') || '—'}</span>
                    </div>
                  </td>
                  <td className="text-secondary hide-sm">{[s.contact_person, s.phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-secondary">{s.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <SupplierModal
          supplier={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setRows((prev) => [...prev.filter((r) => r.id !== s.id), s].sort(byName))
            setEditing(null)
          }}
          onDeleted={(id) => {
            setRows((prev) => prev.filter((r) => r.id !== id))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
