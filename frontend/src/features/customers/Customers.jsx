import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import { listBalances, listCustomers } from '../../services/api'
import { money, num } from '../../shared/lib/format'
import { matchesWords } from '../../shared/lib/search'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'
import { CustomerModal } from '../../shared/components/RecordModals'

const SHOW_MAX = 300

export default function Customers() {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [balances, setBalances] = useState({})
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [owing, setOwing] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    Promise.all([listCustomers(), listBalances()])
      .then(([c, b]) => {
        setRows(c)
        setBalances(b)
      })
      .catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (c) => (!owing || (balances[c.id] ?? 0) > 0) && matchesWords(q, String(c.code), c.name, c.city, c.phone, c.phone2, c.contact_person),
      ),
    [rows, balances, q, owing],
  )

  const totalBalance = filtered.reduce((s, c) => s + (balances[c.id] ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Clients and parties you sell to. Click a row for the ledger."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add customer
          </button>
        }
      />

      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search by name, city, code or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} />
            Owes money
          </label>
          {rows && <span className="text-secondary toolbar-count">{num(filtered.length)} customers</span>}
        </div>

        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && (
          <EmptyState
            icon={Users}
            title="No customers yet"
            text="Add a customer to start billing."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                <Plus size={16} /> Add customer
              </button>
            }
          />
        )}
        {rows && rows.length > 0 && filtered.length === 0 && <EmptyState icon={Search} title="No matches" />}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th className="hide-sm">Code</th>
                <th>Customer</th>
                <th className="hide-sm">City</th>
                <th className="hide-sm">Phone</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, SHOW_MAX).map((c) => {
                const bal = balances[c.id] ?? 0
                const over = Number(c.credit_limit) > 0 && bal > Number(c.credit_limit)
                return (
                  <tr key={c.id} className="row-link" onClick={() => navigate(`/app/customers/${c.id}`)}>
                    <td className="mono text-secondary hide-sm">{c.code}</td>
                    <td>
                      <div className="cell-stack">
                        <span className="strong">{c.name}</span>
                        {c.contact_person && <span className="text-muted hide-sm">{c.contact_person}</span>}
                        <span className="text-muted show-sm">{[c.city, c.phone].filter(Boolean).join(' · ') || `#${c.code}`}</span>
                      </div>
                    </td>
                    <td className="text-secondary hide-sm">{c.city || '—'}</td>
                    <td className="text-secondary hide-sm">{c.phone || '—'}</td>
                    <td className="num">
                      <span className={`strong ${bal < 0 ? 'text-good' : ''}`}>{money(bal)}</span>
                      {over && <span className="status status-critical inline-status">Over limit</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-secondary">
                  {filtered.length > SHOW_MAX ? `Showing ${SHOW_MAX} of ${num(filtered.length)}. Search to narrow down. ` : ''}
                  Total balance
                </td>
                <td className="num strong">{money(totalBalance)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {adding && (
        <CustomerModal
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false)
            navigate(`/app/customers/${c.id}`)
          }}
        />
      )}
    </>
  )
}
