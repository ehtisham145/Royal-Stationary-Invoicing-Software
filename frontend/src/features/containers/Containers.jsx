import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Plus, Search, Ship } from 'lucide-react'
import { listContainerStock, listContainers, optional } from '../../services/api'
import { CONTAINER_STATUSES, ON_THE_WAY, formatDate, num } from '../../shared/lib/format'
import { matchesWords } from '../../shared/lib/search'
import { useAuth } from '../../app/auth/AuthProvider'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'

const FILTERS = [
  { value: 'open', label: 'Not received', test: (c) => c.status !== 'received' },
  { value: 'way', label: 'On the way', test: (c) => ON_THE_WAY.includes(c.status) },
  { value: 'received', label: 'Received', test: (c) => c.status === 'received' },
  { value: 'all', label: 'All', test: () => true },
]

export function ContainerStatus({ status }) {
  const s = CONTAINER_STATUSES.find((x) => x.value === status) ?? CONTAINER_STATUSES[0]
  return (
    <span className={`status ${s.tone}`}>
      {status === 'received' ? <CheckCircle2 size={13} strokeWidth={2.2} /> : <Ship size={13} strokeWidth={2.2} />}
      {s.label}
    </span>
  )
}

export default function Containers() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [rows, setRows] = useState(null)
  const [left, setLeft] = useState({}) // { [container_id]: { received, remaining } }
  const [error, setError] = useState('')
  const [notice] = useState(location.state?.notice ?? '')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('open')

  useEffect(() => {
    Promise.all([listContainers(), optional(listContainerStock())])
      .then(([c, l]) => {
        setRows(c)
        setLeft(l)
      })
      .catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(() => {
    const test = FILTERS.find((f) => f.value === filter).test
    return (rows ?? []).filter((c) => test(c) && matchesWords(q, c.container_no, c.supplier?.name, c.invoice_ref, c.bl_no))
  }, [rows, q, filter])

  const totals = (c) =>
    c.container_items.reduce((t, i) => ({ cartons: t.cartons + Number(i.cartons), cbm: t.cbm + Number(i.cartons) * Number(i.cbm) }), { cartons: 0, cbm: 0 })

  return (
    <>
      <PageHeader
        title="Containers"
        subtitle="Imports from order to arrival. Goods on the way are not sellable until received."
        actions={
          can('containers.manage') && (
            <Link to="/app/containers/new" className="btn btn-primary">
              <Plus size={16} /> New container
            </Link>
          )
        }
      />

      {notice && <div className="notice">{notice}</div>}
      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search container no., supplier or B/L" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.value} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          {rows && <span className="text-secondary toolbar-count">{num(filtered.length)} containers</span>}
        </div>

        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && (
          <EmptyState
            icon={Ship}
            title="No containers yet"
            text={can('containers.manage') ? 'Add a container and its packing list when you place an order.' : 'Containers will appear here once a manager adds them.'}
            action={
              can('containers.manage') && (
                <Link to="/app/containers/new" className="btn btn-primary btn-sm">
                  <Plus size={16} /> New container
                </Link>
              )
            }
          />
        )}
        {rows && rows.length > 0 && filtered.length === 0 && <EmptyState icon={Search} title="Nothing to show" text="Try another filter." />}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Container</th>
                <th>Status</th>
                <th className="hide-sm">Ordered</th>
                <th className="hide-sm">Arrival</th>
                <th className="num">Cartons</th>
                <th className="num hide-sm">CBM</th>
                <th className="num">Left</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const t = totals(c)
                return (
                  <tr key={c.id} className="row-link" onClick={() => navigate(`/app/containers/${c.id}`)}>
                    <td>
                      <div className="cell-stack">
                        <span className="strong mono">{c.container_no}</span>
                        <span className="text-muted">
                          {c.supplier?.name ?? 'No supplier'}
                          {mixedCount(c) > 1 && ` + ${mixedCount(c) - 1} more`} · {c.container_items.length} item{c.container_items.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <ContainerStatus status={c.status} />
                    </td>
                    <td className="text-secondary nowrap hide-sm">{formatDate(c.order_date)}</td>
                    <td className="text-secondary nowrap hide-sm">
                      {c.status === 'received' ? formatDate(c.received_date) : c.eta ? `ETA ${formatDate(c.eta)}` : '—'}
                    </td>
                    <td className="num strong">{num(t.cartons)}</td>
                    <td className="num text-secondary hide-sm">{num(t.cbm)}</td>
                    <td className="num">
                      <LeftPercent lot={left[c.id]} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

// Share of a received container still in stock, first in first out
function LeftPercent({ lot }) {
  if (!lot || lot.received <= 0) return <span className="text-muted">—</span>
  if (lot.remaining <= 0) return <span className="text-muted">Sold out</span>
  return <span className="strong">{num(Math.round((lot.remaining / lot.received) * 100))}%</span>
}

// Suppliers on a container: its own plus any named on packing list lines
const mixedCount = (c) => new Set(c.container_items.map((i) => i.supplier_id || c.supplier_id || 'none')).size
