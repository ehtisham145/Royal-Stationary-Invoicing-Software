import { Fragment, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, PackageCheck, Split, Trash2 } from 'lucide-react'
import { getContainer, listLocations, listProducts, receiveContainer } from '../../services/api'
import { num, qtyText, toQty, today } from '../../shared/lib/format'
import { ErrorBanner, Field, Loading } from '../../shared/components/ui'
import { validatePage } from '../../shared/lib/formValidation'

let nextKey = 1
const key = () => nextKey++

// Puts a container's goods into stores. Normally: pick one store and confirm.
// "More options" lets you enter what actually arrived and split a product over stores.
export default function ContainerReceive() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [products, setProducts] = useState({})
  const [locations, setLocations] = useState([])
  const [store, setStore] = useState('') // where everything goes in the simple mode
  const [detailed, setDetailed] = useState(false)
  const [rows, setRows] = useState({}) // detailed mode: { [item_id]: [{ key, location_id, cartons, loose }] }
  const [date, setDate] = useState(today())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([getContainer(id), listLocations(), listProducts()])
      .then(([c, locs, p]) => {
        const active = locs.filter((l) => l.active)
        setDoc(c)
        setLocations(active)
        setStore(active[0]?.id ?? '')
        setProducts(Object.fromEntries(p.map((x) => [x.id, x])))
      })
      .catch((e) => setError(e.message))
  }, [id])

  if (!doc) return error ? <ErrorBanner message={error} /> : <Loading />
  if (doc.status === 'received') return <Navigate to={`/app/containers/${id}`} replace />

  // Full packing list quantity into one store, one row per product
  const fullRows = (locationId) =>
    Object.fromEntries(
      doc.items.map((it) => [it.id, [{ key: key(), location_id: locationId, cartons: Number(it.cartons) ? String(Number(it.cartons)) : '', loose: Number(it.loose) ? String(Number(it.loose)) : '' }]]),
    )

  function toggleDetailed() {
    if (!detailed) setRows(fullRows(store))
    setDetailed((d) => !d)
  }

  const rowQty = (it, r) => toQty(r.cartons, r.loose, it.carton_qty)
  const itemTotal = (it) => (detailed ? (rows[it.id] ?? []).reduce((s, r) => s + rowQty(it, r), 0) : Number(it.qty))

  const setRow = (itemId, k, field, value) =>
    setRows((prev) => ({ ...prev, [itemId]: prev[itemId].map((r) => (r.key === k ? { ...r, [field]: value } : r)) }))
  const split = (it) =>
    setRows((prev) => {
      const used = new Set(prev[it.id].map((r) => r.location_id))
      const other = locations.find((l) => !used.has(l.id)) ?? locations[0]
      return { ...prev, [it.id]: [...prev[it.id], { key: key(), location_id: other?.id ?? '', cartons: '', loose: '' }] }
    })
  const removeRow = (itemId, k) => setRows((prev) => ({ ...prev, [itemId]: prev[itemId].filter((r) => r.key !== k) }))

  const short = doc.items.filter((it) => itemTotal(it) < Number(it.qty))
  const totalReceived = doc.items.reduce((s, it) => s + itemTotal(it), 0)
  const nothing = totalReceived <= 0 ? 'Enter the quantity received.' : ''

  async function handleReceive() {
    if (!validatePage()) return
    if (short.length && !window.confirm(`${short.length} product${short.length === 1 ? ' is' : 's are'} less than the packing list. Receive anyway?`)) return
    setBusy(true)
    setError('')
    try {
      const lines = detailed
        ? doc.items.flatMap((it) =>
            rows[it.id]
              .filter((r) => rowQty(it, r) > 0)
              .map((r) => ({ item_id: it.id, location_id: r.location_id, cartons: Number(r.cartons) || 0, loose: Number(r.loose) || 0 })),
          )
        : doc.items.map((it) => ({ item_id: it.id, location_id: store, cartons: Number(it.cartons), loose: Number(it.loose) }))
      await receiveContainer(id, lines, date)
      navigate(`/app/containers/${id}`, { replace: true, state: { notice: 'Container received. The goods are now in stock.' } })
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Link to={`/app/containers/${id}`} className="back-link">
            <ArrowLeft size={16} /> {doc.container_no}
          </Link>
          <h1>Receive container</h1>
          <p className="text-secondary">Choose the store and confirm. Stock is added when you confirm.</p>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card">
        <div className="form-grid form-grid-4">
          {!detailed && (
            <Field label="Put everything in">
              <select className="input" required value={store} onChange={(e) => setStore(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Received on">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <button type="button" className="link-btn more-options" onClick={toggleDetailed}>
          {detailed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {detailed ? 'Back to one store, full quantity' : 'More options: less arrived, or several stores'}
        </button>
      </div>

      <div className="card entry-lines">
        <div className="table-scroll">
          <table className="table table-compact lines-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Packing list</th>
                {detailed && <th>Store</th>}
                {detailed && <th className="num">Cartons</th>}
                {detailed && <th className="num">Loose</th>}
                <th className="num">Received</th>
                {detailed && <th />}
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it) => {
                const p = products[it.product_id]
                const unit = p?.unit ?? ''
                const total = itemTotal(it)
                const diff = total - Number(it.qty)
                const list = detailed ? rows[it.id] : [null]
                return (
                  <Fragment key={it.id}>
                    {list.map((r, i) => (
                      <tr key={r?.key ?? it.id} className={diff > 0 ? 'row-error' : ''}>
                        {i === 0 && (
                          <>
                            <td className="line-product" rowSpan={list.length}>
                              <div className="cell-stack">
                                <span className="strong">{p?.name ?? 'Unknown product'}</span>
                                <span className="text-muted">
                                  {p?.code} · {it.carton_qty > 1 ? `${it.carton_qty} ${unit}/ctn` : unit}
                                </span>
                                {detailed && (
                                  <button type="button" className="link-btn split-btn" onClick={() => split(it)}>
                                    <Split size={14} /> Split to another store
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="num text-secondary" rowSpan={list.length} data-label="Packing list">
                              {qtyText(it.qty, unit, it.carton_qty)}
                            </td>
                          </>
                        )}
                        {detailed && (
                          <>
                            <td data-label="Store">
                              <select
                                className="input input-sm"
                                required
                                aria-label="Store"
                                value={r.location_id}
                                onChange={(e) => setRow(it.id, r.key, 'location_id', e.target.value)}
                              >
                                {locations.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="num" data-label="Cartons">
                              <input
                                className="input input-num input-sm"
                                inputMode="decimal"
                                disabled={it.carton_qty <= 1}
                                value={it.carton_qty <= 1 ? '' : r.cartons}
                                placeholder={it.carton_qty <= 1 ? '—' : '0'}
                                onChange={(e) => setRow(it.id, r.key, 'cartons', e.target.value)}
                              />
                            </td>
                            <td className="num" data-label="Loose">
                              <input
                                className="input input-num input-sm"
                                inputMode="decimal"
                                value={r.loose}
                                placeholder="0"
                                aria-label="Loose"
                                onChange={(e) => setRow(it.id, r.key, 'loose', e.target.value)}
                                ref={(el) =>
                                  el?.setCustomValidity(
                                    diff > 0 ? `More than the packing list (${qtyText(it.qty, unit, it.carton_qty)}).` : i === 0 && nothing ? nothing : '',
                                  )
                                }
                              />
                            </td>
                          </>
                        )}
                        {i === 0 && (
                          <td className="num strong" rowSpan={list.length} data-label="Received">
                            {qtyText(total, unit, it.carton_qty)}
                            {diff < 0 && <div className="text-warning">short {qtyText(-diff, unit, it.carton_qty)}</div>}
                            {diff > 0 && <div className="import-error">more than the list</div>}
                          </td>
                        )}
                        {detailed && (
                          <td className="row-actions">
                            {list.length > 1 && (
                              <button className="icon-btn danger" onClick={() => removeRow(it.id, r.key)} aria-label="Remove store line">
                                <Trash2 size={16} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="card-actions">
          <span className="text-secondary mr-auto">
            {`${num(doc.items.length)} product${doc.items.length === 1 ? '' : 's'}${short.length ? ` · ${short.length} short` : ' · all complete'}`}
          </span>
          <Link to={`/app/containers/${id}`} className="btn btn-secondary">
            Cancel
          </Link>
          <button className="btn btn-primary" disabled={busy} onClick={handleReceive}>
            <PackageCheck size={16} /> {busy ? 'Receiving…' : 'Confirm & add to stock'}
          </button>
        </div>
      </div>
    </>
  )
}
