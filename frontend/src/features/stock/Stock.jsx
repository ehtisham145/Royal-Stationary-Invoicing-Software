import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, Boxes, History, PackageMinus, PackagePlus, Search } from 'lucide-react'
import { listLocations, listOnTheWay, listProducts, listStockLevels } from '../../services/api'
import { num, qtyText, splitQty } from '../../shared/lib/format'
import { EMPTY_STOCK, stockIndex } from './stockUtils'
import { matchesWords } from '../../shared/lib/search'
import { EmptyState, ErrorBanner, Loading, Modal, PageHeader } from '../../shared/components/ui'
import { useAuth } from '../../app/auth/AuthProvider'

const SHOW_MAX = 300

const SHOW_OPTIONS = [
  { value: 'stock', label: 'In stock' },
  { value: 'low', label: 'Low' },
  { value: 'negative', label: 'Below zero' },
  { value: 'way', label: 'On the way', permission: 'containers.view' },
  { value: 'all', label: 'All' },
]

export default function Stock() {
  const { can } = useAuth()
  const canManage = can('stock.manage')
  const showWay = can('containers.view')
  const [params, setParams] = useSearchParams()
  const [products, setProducts] = useState(null)
  const [stock, setStock] = useState({})
  const [locations, setLocations] = useState([])
  const [onWay, setOnWay] = useState({}) // { [product_id]: qty } in containers on the way
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState(null) // product whose per-store stock is shown

  const show = params.get('show') ?? 'stock'
  const locationId = params.get('location') ?? ''
  const setParam = (k, v) =>
    setParams(
      (p) => {
        if (v) p.set(k, v)
        else p.delete(k)
        return p
      },
      { replace: true },
    )

  useEffect(() => {
    Promise.all([listProducts(), listStockLevels(), listLocations(), showWay ? listOnTheWay() : {}])
      .then(([p, levels, locs, way]) => {
        setProducts(p)
        setStock(stockIndex(levels))
        setLocations(locs.filter((l) => l.active))
        setOnWay(way)
      })
      .catch((e) => setError(e.message))
  }, [showWay])

  const store = locationId ? locations.find((l) => l.id === locationId) : null

  const rows = useMemo(() => {
    if (!products) return []
    return products.filter((p) => {
      const s = stock[p.id] ?? EMPTY_STOCK
      const qty = locationId ? (s.byLocation[locationId] ?? 0) : s.total
      if (show === 'stock' && qty === 0) return false
      if (show === 'way' && !(onWay[p.id] > 0)) return false
      if (show === 'low' && !(Number(p.reorder_level) > 0 && s.total <= Number(p.reorder_level))) return false
      if (show === 'negative' && !(locationId ? qty < 0 : Object.values(s.byLocation).some((v) => v < 0))) return false
      return matchesWords(q, p.code, p.name, p.company, p.category)
    })
  }, [products, stock, onWay, show, locationId, q])

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="What is in each store, in cartons and loose."
        actions={
          canManage && (
            <>
              <Link to="/app/stock/new?kind=transfer" className="btn btn-secondary">
                <ArrowLeftRight size={16} /> Transfer
              </Link>
              <Link to="/app/stock/new?kind=out" className="btn btn-secondary">
                <PackageMinus size={16} /> Stock out
              </Link>
              <Link to="/app/stock/new?kind=in" className="btn btn-primary">
                <PackagePlus size={16} /> Stock in
              </Link>
            </>
          )
        }
      />

      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search product, code or company" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input toolbar-select" value={locationId} onChange={(e) => setParam('location', e.target.value)} aria-label="Store">
            <option value="">All stores</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="segmented">
            {SHOW_OPTIONS.filter((o) => !o.permission || can(o.permission)).map((o) => (
              <button key={o.value} className={show === o.value ? 'active' : ''} onClick={() => setParam('show', o.value === 'stock' ? '' : o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          {products && <span className="text-secondary toolbar-count">{num(rows.length)} products</span>}
        </div>

        {!products && !error && <Loading />}
        {products && rows.length === 0 && (
          <EmptyState
            icon={Boxes}
            title={products.length === 0 ? 'No products yet' : 'Nothing to show'}
            text={products.length === 0 ? 'Add products first, then post opening stock.' : 'Try another store or filter.'}
          />
        )}

        {rows.length > 0 && (
          <div className="stock-scroll">
            <table className="table table-compact stock-table">
              <thead>
                <tr>
                  <th>Product</th>
                  {store && <th className="num">{store.name}</th>}
                  <th className="num">{store ? 'All stores' : 'Total'}</th>
                  {showWay && <th className="num">On the way</th>}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOW_MAX).map((p) => {
                  const s = stock[p.id] ?? EMPTY_STOCK
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-stack">
                          <button type="button" className="link-btn stock-name" onClick={() => setViewing(p)}>
                            {p.name}
                          </button>
                          <span className="text-muted">
                            {p.code}
                            {p.carton_qty > 1 && ` · ${p.carton_qty} ${p.unit}/ctn`}
                          </span>
                        </div>
                      </td>
                      {store && <QtyCell qty={s.byLocation[store.id] ?? 0} p={p} />}
                      <QtyCell qty={s.total} p={p} />
                      {showWay && (
                        <td className={`num ${onWay[p.id] ? 'text-info' : 'text-muted'}`}>
                          {onWay[p.id] ? qtyText(onWay[p.id], p.unit, p.carton_qty, { short: true }) : '—'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > SHOW_MAX && (
                <tfoot>
                  <tr>
                    <td colSpan={2 + (store ? 1 : 0) + (showWay ? 1 : 0)} className="text-secondary">
                      Showing the first {SHOW_MAX} of {num(rows.length)}. Search or filter to narrow down.
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {viewing && <StoreStockModal product={viewing} stock={stock[viewing.id] ?? EMPTY_STOCK} locations={locations} onClose={() => setViewing(null)} />}
    </>
  )
}

function StoreStockModal({ product: p, stock: s, locations, onClose }) {
  const hasCartons = p.carton_qty > 1
  const cells = (qty) => {
    if (!hasCartons) return <td className="num strong">{qty === 0 ? '—' : num(qty)}</td>
    const { cartons, loose } = splitQty(qty, p.carton_qty)
    return (
      <>
        <td className="num">{qty === 0 ? '—' : num(cartons)}</td>
        <td className="num">{qty === 0 ? '—' : num(loose)}</td>
        <td className="num strong">{qty === 0 ? '—' : num(qty)}</td>
      </>
    )
  }
  return (
    <Modal
      title={p.name}
      onClose={onClose}
      footer={
        <>
          <Link to={`/app/products/${p.id}/ledger`} className="btn btn-secondary">
            <History size={16} /> Stock history
          </Link>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="text-secondary modal-intro">
        {p.code}
        {hasCartons && ` · ${p.carton_qty} ${p.unit} per carton`}
      </p>
      <div className="store-table-wrap">
        <table className="table table-compact store-table">
          <thead>
            <tr>
              <th>Store</th>
              {hasCartons && <th className="num">Cartons</th>}
              {hasCartons && <th className="num">Loose ({p.unit})</th>}
              <th className="num">Total ({p.unit})</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => {
              const qty = s.byLocation[l.id] ?? 0
              return (
                <tr key={l.id} className={qty === 0 ? 'text-muted' : qty < 0 ? 'text-critical' : ''}>
                  <td>{l.name}</td>
                  {cells(qty)}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className={s.total < 0 ? 'text-critical' : ''}>
              <td className="strong">Total</td>
              {cells(s.total)}
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  )
}

function QtyCell({ qty, p }) {
  return (
    <td className={`num ${qty < 0 ? 'text-critical' : qty === 0 ? 'text-muted' : ''}`}>
      <div className="strong">{qty === 0 ? '—' : qtyText(qty, p.unit, p.carton_qty, { short: true })}</div>
      {p.carton_qty > 1 && Math.abs(qty) >= p.carton_qty && (
        <div className="stock-pcs">
          {num(qty)} {p.unit}
        </div>
      )}
    </td>
  )
}
