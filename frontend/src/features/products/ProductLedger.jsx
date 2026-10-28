import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, History, Printer } from 'lucide-react'
import { getProduct, getProductContainers, getProductLedger, getProductLots, listLocations, optional } from '../../services/api'
import { ON_THE_WAY, formatDate, money, num, qtyText } from '../../shared/lib/format'
import { useAuth } from '../../app/auth/AuthProvider'
import { EmptyState, ErrorBanner, Loading } from '../../shared/components/ui'
import { ContainerStatus } from '../containers/Containers'
import DateInput from '../../shared/components/DateInput'

const KIND_LABELS = {
  opening: 'Opening stock',
  in: 'Stock in',
  out: 'Stock out',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  sale: 'Sale',
  sale_return: 'Sale return',
  container_in: 'Container received',
}

export default function ProductLedger() {
  const { id } = useParams()
  const { can } = useAuth()
  const showContainers = can('containers.view')
  const [product, setProduct] = useState(null)
  const [moves, setMoves] = useState(null)
  const [locations, setLocations] = useState([])
  const [containers, setContainers] = useState([])
  const [lots, setLots] = useState({}) // { [container_id]: remaining }
  const [error, setError] = useState('')
  const [locationId, setLocationId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cartons, setCartons] = useState(true)

  useEffect(() => {
    setProduct(null)
    setMoves(null)
    Promise.all([getProduct(id), getProductLedger(id), listLocations(), showContainers ? getProductContainers(id) : [], showContainers ? optional(getProductLots(id)) : {}])
      .then(([p, m, l, c, lt]) => {
        setProduct(p)
        setMoves(m)
        setLocations(l)
        setContainers(c)
        setLots(lt)
      })
      .catch((e) => setError(e.message))
  }, [id, showContainers])

  const locName = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l.name])), [locations])

  const stockByLocation = useMemo(() => {
    const out = {}
    for (const m of moves ?? []) out[m.location_id] = (out[m.location_id] ?? 0) + Number(m.qty)
    return out
  }, [moves])

  // Moves before `from` become one opening line; the running balance continues from it
  const view = useMemo(() => {
    if (!moves) return null
    const scoped = moves.filter((m) => !locationId || m.location_id === locationId)
    let balance = 0
    let opening = 0
    const rows = []
    for (const m of scoped) {
      const qty = Number(m.qty)
      if (from && m.move_date < from) {
        opening += qty
        balance += qty
        continue
      }
      if (to && m.move_date > to) break
      balance += qty
      rows.push({ ...m, qty, balance })
    }
    const totalIn = rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
    const totalOut = rows.reduce((s, r) => s + (r.qty < 0 ? -r.qty : 0), 0)
    return { rows, opening, totalIn, totalOut, closing: opening + totalIn - totalOut }
  }, [moves, locationId, from, to])

  if (!product || !view) return error ? <ErrorBanner message={error} /> : <Loading />

  const show = (qty) => (cartons ? qtyText(qty, product.unit, product.carton_qty) : `${num(qty)}`)
  const total = Object.values(stockByLocation).reduce((s, q) => s + q, 0)
  const onWay = containers.filter((c) => ON_THE_WAY.includes(c.containers.status)).reduce((s, c) => s + Number(c.qty), 0)

  function describe(m) {
    const entry = m.stock_entries
    if (m.containers) {
      return (
        <Link to={`/app/containers/${m.containers.id}`} className="link">
          Received from container {m.containers.container_no}
        </Link>
      )
    }
    if (!m.invoices && !entry) return KIND_LABELS[m.kind]
    if (m.invoices) {
      const c = m.invoices.customers
      return (
        <>
          <Link to={`/app/invoices/${m.invoices.id}`} className="link">
            {m.kind === 'sale' ? 'Sale invoice' : 'Return'} #{m.invoices.invoice_no}
          </Link>
          <span className="text-secondary"> · {c?.name}{c?.city ? ` (${c.city})` : ''}</span>
        </>
      )
    }
    const where =
      m.kind === 'transfer_out' ? ` to ${locName[entry?.to_location_id] ?? '—'}` : m.kind === 'transfer_in' ? ` from ${locName[entry?.location_id] ?? '—'}` : ''
    return (
      <>
        {KIND_LABELS[m.kind]}
        {where} · Entry #{entry?.entry_no}
        {entry?.note && <span className="text-secondary"> · {entry.note}</span>}
      </>
    )
  }

  return (
    <>
      <div className="page-header no-print">
        <div>
          <Link to="/app/products" className="back-link">
            <ArrowLeft size={16} /> Products
          </Link>
          <h1>Stock ledger</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card ledger-head">
        <div>
          <div className="text-muted mono">Code {product.code}</div>
          <h2>{product.name}</h2>
          <div className="text-secondary">
            Unit {product.unit} · Carton qty {product.carton_qty}
            {product.inner_qty > 0 && ` · Inner qty ${product.inner_qty}`}
            {product.company && ` · ${product.company}`}
            {product.cost_price != null && ` · Cost ${money(product.cost_price)}`}
          </div>
        </div>
        <div className="ledger-total">
          <div className="meta-label">Current stock</div>
          <div className={`ledger-total-value ${total < 0 ? 'text-critical' : ''}`}>{qtyText(total, product.unit, product.carton_qty)}</div>
          {onWay > 0 && <div className="text-info">+ {qtyText(onWay, product.unit, product.carton_qty)} on the way</div>}
        </div>
        <div className="chips">
          {locations
            .filter((l) => stockByLocation[l.id])
            .map((l) => (
              <button
                key={l.id}
                className={`chip ${locationId === l.id ? 'active' : ''} ${stockByLocation[l.id] < 0 ? 'chip-critical' : ''}`}
                onClick={() => setLocationId(locationId === l.id ? '' : l.id)}
              >
                {l.name}: <b>{qtyText(stockByLocation[l.id], product.unit, product.carton_qty)}</b>
              </button>
            ))}
        </div>
      </div>

      {containers.length > 0 && (
        <div className="card card-flush no-print">
          <div className="card-head card-head-tight">
            <div>
              <h3>Containers</h3>
              <p className="text-secondary">Imports that carried this product</p>
            </div>
          </div>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Container</th>
                <th>Status</th>
                <th className="hide-sm">Date</th>
                <th className="num">Quantity</th>
                <th className="num">Left</th>
              </tr>
            </thead>
            <tbody>
              {containers.map(({ containers: c, qty, received_qty, supplier }) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-stack">
                      <Link to={`/app/containers/${c.id}`} className="link mono">
                        {c.container_no}
                      </Link>
                      <span className="text-muted">{supplier?.name ?? c.supplier?.name ?? 'No supplier'}</span>
                    </div>
                  </td>
                  <td>
                    <ContainerStatus status={c.status} />
                  </td>
                  <td className="text-secondary hide-sm">
                    {c.status === 'received' ? formatDate(c.received_date) : c.eta ? `ETA ${formatDate(c.eta)}` : formatDate(c.order_date)}
                  </td>
                  <td className="num">{qtyText(received_qty ?? qty, product.unit, product.carton_qty)}</td>
                  <td className="num strong">
                    {c.status !== 'received' ? '—' : lots[c.id] > 0 ? qtyText(lots[c.id], product.unit, product.carton_qty) : <span className="text-muted">Sold out</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card card-flush">
        <div className="toolbar no-print">
          <select className="input toolbar-select" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Store">
            <option value="">All stores</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="date-range">
            <DateInput value={from} max={to || undefined} onChange={setFrom} aria-label="From date" />
            <span className="text-muted">to</span>
            <DateInput value={to} min={from || undefined} onChange={setTo} aria-label="To date" />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={cartons} onChange={(e) => setCartons(e.target.checked)} />
            Show in cartons
          </label>
        </div>

        <div className="print-only print-title">
          {product.name} · {locationId ? locName[locationId] : 'All stores'}
          {(from || to) && ` · ${from ? formatDate(from) : '…'} to ${to ? formatDate(to) : '…'}`}
        </div>

        {view.rows.length === 0 && !view.opening ? (
          <EmptyState icon={History} title="No stock movements" text="Stock in, transfers and sales of this product will appear here." />
        ) : (
          <table className="table table-compact table-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Store</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {from && (
                <tr className="row-muted">
                  <td>{formatDate(from)}</td>
                  <td colSpan={4}>Balance brought forward</td>
                  <td className="num strong">{show(view.opening)}</td>
                </tr>
              )}
              {view.rows.map((m) => (
                <tr key={m.id}>
                  <td className="text-secondary nowrap">{formatDate(m.move_date)}</td>
                  <td>{describe(m)}</td>
                  <td className="text-secondary">{locName[m.location_id]}</td>
                  <td className="num">{m.qty > 0 ? show(m.qty) : ''}</td>
                  <td className="num">{m.qty < 0 ? show(-m.qty) : ''}</td>
                  <td className={`num strong ${m.balance < 0 ? 'text-critical' : ''}`}>{show(m.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="text-secondary">
                  {view.rows.length} movement{view.rows.length === 1 ? '' : 's'}
                </td>
                <td className="num strong">{show(view.totalIn)}</td>
                <td className="num strong">{show(view.totalOut)}</td>
                <td className="num strong">{show(view.closing)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}
