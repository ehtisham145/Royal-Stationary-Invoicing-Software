import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { listLocations, listProducts, listStockLevels, postStockEntry } from '../../services/api'
import { ENTRY_LABELS, qtyText, toQty, today } from '../../shared/lib/format'
import { stockIndex } from './stockUtils'
import { ErrorBanner, Field, Loading, RequiredProxy } from '../../shared/components/ui'
import { validatePage } from '../../shared/lib/formValidation'
import { ProductSearch } from '../../shared/components/Pickers'
import DateInput from '../../shared/components/DateInput'

const KINDS = ['in', 'out', 'transfer', 'opening']

const HELP = {
  in: 'Goods received into a store (purchase, return from party, found stock).',
  out: 'Goods leaving a store without a sale invoice (damage, shortage, sample). Write the reason in the note.',
  transfer: 'Move goods from one store to another. Total stock does not change.',
  opening: 'Starting stock when you begin using the system.',
}

export default function StockEntryForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [products, setProducts] = useState(null)
  const [stock, setStock] = useState({})
  const [locations, setLocations] = useState([])
  const [error, setError] = useState('')

  const [kind, setKind] = useState(KINDS.includes(params.get('kind')) ? params.get('kind') : 'in')
  const [date, setDate] = useState(today())
  const [locationId, setLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState([]) // { product, cartons, loose }
  const [saving, setSaving] = useState(false)
  const searchRef = useRef(null)
  const cartonRefs = useRef({})

  useEffect(() => {
    Promise.all([listProducts(), listStockLevels(), listLocations()])
      .then(([p, levels, locs]) => {
        const active = locs.filter((l) => l.active)
        setProducts(p)
        setStock(stockIndex(levels))
        setLocations(active)
        setLocationId(active[0]?.id ?? '')
        setToLocationId(active[1]?.id ?? '')
      })
      .catch((e) => setError(e.message))
  }, [])

  const available = (productId) => stock[productId]?.byLocation[locationId] ?? 0
  const takesStock = kind === 'out' || kind === 'transfer'

  if (!products) return error ? <ErrorBanner message={error} /> : <Loading />

  function addProduct(p) {
    if (items.some((i) => i.product.id === p.id)) {
      cartonRefs.current[p.id]?.focus()
      return
    }
    setItems((prev) => [...prev, { product: p, cartons: '', loose: '' }])
    // focus the new line's carton box once it renders
    setTimeout(() => cartonRefs.current[p.id]?.focus(), 0)
  }

  const lines = items.map((i) => {
    const qty = toQty(i.cartons, i.loose, i.product.carton_qty)
    return { ...i, qty, short: takesStock && qty > available(i.product.id) }
  })

  const update = (id, field, value) => setItems((prev) => prev.map((i) => (i.product.id === id ? { ...i, [field]: value } : i)))
  const remove = (id) => setItems((prev) => prev.filter((i) => i.product.id !== id))

  async function handleSave() {
    if (!validatePage()) return
    setSaving(true)
    setError('')
    try {
      await postStockEntry({
        kind,
        locationId,
        toLocationId,
        date,
        note,
        items: lines.map((l) => ({ product_id: l.product.id, cartons: l.cartons, loose: l.loose })),
      })
      navigate('/app/stock/entries', { replace: true, state: { notice: `${ENTRY_LABELS[kind]} saved.` } })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/app/stock/entries" className="back-link">
            <ArrowLeft size={16} /> Stock entries
          </Link>
          <h1>New {ENTRY_LABELS[kind].toLowerCase()}</h1>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card">
        <div className="segmented segmented-wide">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {ENTRY_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="text-secondary form-help">{HELP[kind]}</p>

        <div className="form-grid form-grid-4">
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label={kind === 'transfer' ? 'From store' : 'Store'}>
            <select className="input" required value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          {kind === 'transfer' ? (
            <Field label="To store">
              <select
                className="input"
                required
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                ref={(el) => el?.setCustomValidity(toLocationId && toLocationId === locationId ? 'Choose a different store to move the goods to.' : '')}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div />
          )}
          <Field label="Note">
            <input className="input" placeholder={kind === 'out' ? 'Reason (damage, shortage…)' : 'Optional'} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card entry-lines">
        <div className="card-head card-head-tight">
          <div>
            <h3>Products</h3>
            <p className="text-secondary">Search, press Enter, type cartons and loose.</p>
          </div>
        </div>
        <div className="field">
          <ProductSearch ref={searchRef} products={products} stock={stock} onPick={addProduct} autoFocus />
          <RequiredProxy value={lines.length} message="Add at least one product." />
        </div>

        {lines.length > 0 && (
          <table className="table table-compact lines-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">{takesStock ? 'Available' : 'In store now'}</th>
                <th className="num">Cartons</th>
                <th className="num">Loose</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = l.product
                return (
                  <tr key={p.id} className={l.short ? 'row-error' : ''}>
                    <td className="line-product">
                      <div className="cell-stack">
                        <span className="strong">{p.name}</span>
                        <span className="text-muted">
                          {p.code} · {p.carton_qty > 1 ? `${p.carton_qty} ${p.unit}/ctn` : p.unit}
                        </span>
                      </div>
                    </td>
                    <td className="num text-secondary line-store" data-label={takesStock ? 'Available' : 'In store now'}>
                      {qtyText(available(p.id), p.unit, p.carton_qty)}
                    </td>
                    <td className="num" data-label="Cartons">
                      <input
                        ref={(el) => (cartonRefs.current[p.id] = el)}
                        className="input input-num input-sm"
                        inputMode="decimal"
                        disabled={p.carton_qty <= 1}
                        value={p.carton_qty <= 1 ? '' : l.cartons}
                        placeholder={p.carton_qty <= 1 ? '—' : '0'}
                        onChange={(e) => update(p.id, 'cartons', e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchRef.current?.focus()}
                      />
                    </td>
                    <td className="num" data-label="Loose">
                      <input
                        className="input input-num input-sm"
                        inputMode="decimal"
                        value={l.loose}
                        placeholder="0"
                        onChange={(e) => update(p.id, 'loose', e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchRef.current?.focus()}
                        ref={(el) =>
                          el?.setCustomValidity(
                            l.qty <= 0 ? 'Enter a quantity.' : l.short ? `Only ${qtyText(available(p.id), p.unit, p.carton_qty)} in this store.` : '',
                          )
                        }
                      />
                    </td>
                    <td className="num strong" data-label="Total">
                      {qtyText(l.qty, p.unit, p.carton_qty)}
                    </td>
                    <td className="row-actions">
                      <button className="icon-btn danger" onClick={() => remove(p.id)} aria-label="Remove">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="card-actions">
          <span className="text-secondary mr-auto">
            {lines.length} product{lines.length === 1 ? '' : 's'}
          </span>
          <Link to="/app/stock/entries" className="btn btn-secondary">
            Cancel
          </Link>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : `Save ${ENTRY_LABELS[kind].toLowerCase()}`}
          </button>
        </div>
      </div>
    </>
  )
}
