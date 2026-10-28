import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Package, Plus, Search, Upload } from 'lucide-react'
import { listLocations, listProducts, listStockLevels } from '../../services/api'
import { money, num, qtyText } from '../../shared/lib/format'
import { EMPTY_STOCK, stockIndex } from '../stock/stockUtils'
import { matchesWords } from '../../shared/lib/search'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'
import { ProductModal } from '../../shared/components/RecordModals'
import ProductImport from './ProductImport'
import { useAuth } from '../../app/auth/AuthProvider'

const byName = (a, b) => a.name.localeCompare(b.name)
const SHOW_MAX = 300

export default function Products() {
  const { can } = useAuth()
  const canManage = can('products.manage')
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [stock, setStock] = useState({})
  const [locations, setLocations] = useState([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [company, setCompany] = useState('')
  const [category, setCategory] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState(null) // null | {} (new) | product
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')

  async function load() {
    const [p, levels, locs] = await Promise.all([listProducts(), listStockLevels(), listLocations()])
    setRows(p)
    setStock(stockIndex(levels))
    setLocations(locs)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  const companies = useMemo(() => [...new Set((rows ?? []).map((p) => p.company).filter(Boolean))].sort(), [rows])
  const categories = useMemo(() => [...new Set((rows ?? []).map((p) => p.category).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(
    () =>
      (rows ?? []).filter((p) => {
        if (company && p.company !== company) return false
        if (category && p.category !== category) return false
        if (lowOnly && !(Number(p.reorder_level) > 0 && (stock[p.id]?.total ?? 0) <= Number(p.reorder_level))) return false
        return matchesWords(q, p.code, p.name, p.company, p.brand, p.category, p.description)
      }),
    [rows, stock, q, company, category, lowOnly],
  )

  const upsert = (p) => setRows((prev) => [...prev.filter((r) => r.id !== p.id), p].sort(byName))

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Items, cartons, prices and stock across all stores."
        actions={
          canManage && (
            <>
              <button className="btn btn-secondary" onClick={() => setImporting(true)} disabled={!rows}>
                <Upload size={16} /> Import
              </button>
              <button className="btn btn-primary" onClick={() => setEditing({})} disabled={!rows}>
                <Plus size={16} /> Add product
              </button>
            </>
          )
        }
      />

      <ErrorBanner message={error} />
      {notice && <div className="notice">{notice}</div>}

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search by name, code, company or category" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input toolbar-select" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="input toolbar-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>
          {rows && <span className="text-secondary toolbar-count">{num(filtered.length)} of {num(rows.length)}</span>}
        </div>

        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && (
          <EmptyState
            icon={Package}
            title="No products yet"
            text={canManage ? 'Add products one by one, or import them from a CSV file.' : 'Ask a manager to add products.'}
            action={
              canManage && (
                <div className="empty-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => setImporting(true)}>
                    <Upload size={16} /> Import CSV
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
                    <Plus size={16} /> Add product
                  </button>
                </div>
              )
            }
          />
        )}
        {rows && rows.length > 0 && filtered.length === 0 && <EmptyState icon={Search} title="No matches" />}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th className="hide-sm">Code</th>
                <th>Product</th>
                <th className="hide-sm">Unit</th>
                <th className="num hide-sm">Carton</th>
                <th className="num">Stock</th>
                <th className="num">Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, SHOW_MAX).map((p) => {
                const s = stock[p.id] ?? EMPTY_STOCK
                const low = Number(p.reorder_level) > 0 && s.total <= Number(p.reorder_level)
                return (
                  <tr
                    key={p.id}
                    className="row-link"
                    onClick={() => (canManage ? setEditing(p) : navigate(`/app/products/${p.id}/ledger`))}
                  >
                    <td className="mono text-secondary hide-sm">{p.code}</td>
                    <td>
                      <div className="cell-stack">
                        <span className="strong">
                          {p.name}
                          {p.active === false && <span className="status status-neutral inline-status">Inactive</span>}
                        </span>
                        <span className="text-muted">
                          <span className="show-sm">{p.code} · </span>
                          {[p.company, p.brand, p.category].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="text-secondary hide-sm">{p.unit}</td>
                    <td className="num text-secondary hide-sm">{p.carton_qty > 1 ? `${p.carton_qty}/ctn` : '—'}</td>
                    <td className="num" title={locations.map((l) => `${l.name}: ${num(s.byLocation[l.id] ?? 0)}`).join('\n')}>
                      <span className={s.total < 0 ? 'text-critical strong' : s.total === 0 ? 'text-muted' : 'strong'}>
                        {qtyText(s.total, p.unit, p.carton_qty)}
                      </span>
                      {low && <span className="status status-warning inline-status">Low</span>}
                    </td>
                    <td className="num">
                      <div className="cell-stack cell-num">
                        <span className="strong">{money(p.price)}</span>
                        {Number(p.min_price) > 0 && <span className="text-muted hide-sm">min {money(p.min_price)}</span>}
                      </div>
                    </td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title="Stock ledger" aria-label="Stock ledger" onClick={() => navigate(`/app/products/${p.id}/ledger`)}>
                        <History size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {filtered.length > SHOW_MAX && (
              <tfoot>
                <tr>
                  <td colSpan={7} className="text-secondary">
                    Showing the first {SHOW_MAX} of {num(filtered.length)}. Search or filter to narrow down.
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {editing && (
        <ProductModal
          product={editing.id ? editing : null}
          existing={rows}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            upsert(p)
            setEditing(null)
          }}
          onDeleted={(id) => {
            setRows((prev) => prev.filter((r) => r.id !== id))
            setEditing(null)
          }}
        />
      )}

      {importing && (
        <ProductImport
          existing={rows}
          locations={locations}
          onClose={() => setImporting(false)}
          onImported={async (count) => {
            setImporting(false)
            setNotice(`${num(count)} product${count === 1 ? '' : 's'} imported.`)
            await load().catch((e) => setError(e.message))
          }}
        />
      )}
    </>
  )
}
