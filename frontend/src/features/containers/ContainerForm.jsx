import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileSpreadsheet, PackageCheck, Trash2, Undo2 } from 'lucide-react'
import {
  deleteContainer,
  getContainer,
  getContainerProfit,
  getContainerStock,
  getDefaultCompany,
  listProducts,
  listSuppliers,
  optional,
  reopenContainer,
  saveContainer,
} from '../../services/api'
import { CURRENCIES, ON_THE_WAY, formatDate, money, num, qtyText, today } from '../../shared/lib/format'
import { landedCosts, lineQty, packingTotals, suggestedPrice } from './containerUtils'
import { useAuth } from '../../app/auth/AuthProvider'
import { ErrorBanner, Field, Loading } from '../../shared/components/ui'
import { validatePage } from '../../shared/lib/formValidation'
import { ProductSearch } from '../../shared/components/Pickers'
import PackingListImport from './PackingListImport'
import { ContainerStatus } from './Containers'

// Fields the database keeps (older containers may have them filled); the form only shows some,
// the rest are sent back unchanged so nothing is lost.
const EMPTY = {
  container_no: '', supplier_id: '', invoice_ref: '', order_date: today(), status: 'ordered',
  shipped_date: '', port_date: '', clearing_date: '', eta: '', shipping_line: '', bl_no: '',
  currency: 'USD', exchange_rate: '', notes: '',
}
const EXPENSES = ['Freight', 'Duty', 'Clearing', 'Other'] // saved names; labels below are what people see
const EXPENSE_LABELS = {
  Freight: { label: 'Shipping (freight)', hint: 'Container rent, China to port' },
  Duty: { label: 'Customs duty & tax', hint: 'Paid to government at the port' },
  Clearing: { label: 'Clearing agent', hint: 'Agent fee and port charges' },
  Other: { label: 'Other costs', hint: 'Truck to store, labour, bank charges' },
}
const NO_EXPENSES = Object.fromEntries(EXPENSES.map((n) => [n, '']))

let nextKey = 1
const key = () => nextKey++
const str = (v) => (v === null || v === undefined ? '' : String(v))
// Blank is fine (0); anything else must be a number, 0 or more
const notAmount = (v) => String(v ?? '').trim() !== '' && !(Number(v) >= 0)
const fmt2 = (n) => num(Math.round(Number(n) * 100) / 100)

// Saved expenses -> the four boxes; any other name is added to "Other"
function toExpenseBoxes(list) {
  const boxes = { ...NO_EXPENSES }
  for (const e of list) {
    const name = EXPENSES.find((n) => n.toLowerCase() === e.name.trim().toLowerCase()) ?? 'Other'
    boxes[name] = str((Number(boxes[name]) || 0) + Number(e.amount))
  }
  return boxes
}

export default function ContainerForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = useAuth()
  const showCosts = can('costs')
  const canManage = can('containers.manage')

  const [products, setProducts] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [margin, setMargin] = useState(0)
  const [doc, setDoc] = useState(null) // saved container, null when new
  const [form, setForm] = useState(EMPTY)
  // supplier_id '' = same as the container's supplier (mixed containers name the shop per line)
  const [lines, setLines] = useState([]) // { key, product, supplier_id, supplier_name, cartons, carton_qty, loose, cbm, weight, unit_price, received_qty }
  const [expenses, setExpenses] = useState(NO_EXPENSES) // { Freight: '1200', ... } in Rs
  const [lots, setLots] = useState({}) // { [product_id]: { received, remaining } }, first in first out
  const [profit, setProfit] = useState({}) // { [product_id]: { sold, revenue, profit, ... } }
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(location.state?.notice ?? '')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [version, setVersion] = useState(0)
  const searchRef = useRef(null)
  const cartonRefs = useRef({})

  useEffect(() => {
    setError('')
    Promise.all([
      listProducts(),
      canManage ? listSuppliers() : [],
      getDefaultCompany(),
      id ? getContainer(id, { withCosts: showCosts }) : null,
      id ? optional(getContainerStock(id)) : {},
      id && showCosts ? optional(getContainerProfit(id)) : {},
    ])
      .then(([p, s, company, c, stockLeft, profitRows]) => {
        const byId = Object.fromEntries(p.map((x) => [x.id, x]))
        setProducts(p)
        setSuppliers(s.filter((x) => x.active || x.id === c?.supplier_id))
        setMargin(Number(company?.default_margin) || 0)
        setDoc(c)
        setLots(stockLeft)
        setProfit(profitRows)
        if (c) {
          setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, str(c[k])])))
          setLines(
            c.items.map((it) => ({
              key: key(),
              product: byId[it.product_id],
              supplier_id: str(it.supplier_id),
              supplier_name: it.supplier?.name ?? '',
              cartons: str(it.cartons),
              carton_qty: str(it.carton_qty),
              loose: Number(it.loose) ? str(it.loose) : '',
              cbm: str(it.cbm),
              weight: str(it.weight),
              unit_price: it.price ? str(it.price.unit_price) : '',
              received_qty: it.received_qty,
            })),
          )
          setExpenses(toExpenseBoxes(c.expenses))
        }
        setDirty(false)
      })
      .catch((e) => setError(e.message))
  }, [id, version, canManage, showCosts])

  const received = doc?.status === 'received'
  const editable = canManage && !received
  const totals = useMemo(() => packingTotals(lines), [lines])
  // Expenses are shared by CBM (container space) when the products have it, otherwise by value
  const costBasis = totals.cbm > 0 ? 'cbm' : 'value'
  const expenseList = useMemo(() => EXPENSES.filter((n) => Number(expenses[n]) > 0).map((n) => ({ name: n, amount: expenses[n] })), [expenses])
  const costs = useMemo(
    () => (showCosts ? landedCosts(lines, { exchangeRate: form.exchange_rate, costBasis, expenses: expenseList }) : []),
    [showCosts, lines, form.exchange_rate, costBasis, expenseList],
  )

  if (!products) return error ? <ErrorBanner message={error} /> : <Loading />

  const change = (fn) => {
    setDirty(true)
    setNotice('')
    fn()
  }
  const set = (k) => (e) => change(() => setForm((f) => ({ ...f, [k]: e.target.value })))
  const onTheWay = ON_THE_WAY.includes(form.status)

  function setOnTheWay(yes) {
    change(() =>
      setForm((f) => {
        if (!yes) return { ...f, status: 'ordered' }
        // keep an older "at port" / "clearing" status as it is
        return ON_THE_WAY.includes(f.status) ? f : { ...f, status: 'shipped', shipped_date: f.shipped_date || today() }
      }),
    )
  }

  function chooseSupplier(e) {
    const s = suppliers.find((x) => x.id === e.target.value)
    change(() => setForm((f) => ({ ...f, supplier_id: e.target.value, currency: s?.currency ?? f.currency })))
  }

  function addProduct(p) {
    const existing = lines.find((l) => l.product.id === p.id)
    if (existing) {
      cartonRefs.current[existing.key]?.focus()
      return
    }
    const line = { key: key(), product: p, supplier_id: '', cartons: '', carton_qty: str(p.carton_qty), loose: '', cbm: str(p.cbm), weight: '', unit_price: '' }
    change(() => setLines((prev) => [...prev, line]))
    setTimeout(() => cartonRefs.current[line.key]?.focus(), 0)
  }

  // Imported rows replace lines for the same product
  function importRows(rows) {
    change(() =>
      setLines((prev) => {
        const next = [...prev]
        for (const r of rows) {
          const line = {
            key: key(),
            product: r.product,
            supplier_id: r.supplier_id,
            cartons: r.cartons,
            carton_qty: r.carton_qty,
            loose: r.loose,
            cbm: r.cbm,
            weight: r.weight,
            unit_price: r.unit_price,
          }
          const i = next.findIndex((l) => l.product.id === r.product.id)
          if (i >= 0) next[i] = line
          else next.push(line)
        }
        return next
      }),
    )
    setImporting(false)
  }

  const updateLine = (k, field, value) => change(() => setLines((prev) => prev.map((l) => (l.key === k ? { ...l, [field]: value } : l))))
  const removeLine = (k) => change(() => setLines((prev) => prev.filter((l) => l.key !== k)))

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const handleSave = () =>
    validatePage() &&
    run(async () => {
      const savedId = await saveContainer({
        ...(id ? { id } : {}),
        ...form,
        cost_basis: costBasis,
        items: lines.map((l) => ({
          product_id: l.product.id,
          supplier_id: l.supplier_id || null,
          cartons: l.cartons,
          carton_qty: l.carton_qty,
          loose: l.loose,
          cbm: l.cbm,
          weight: l.weight,
          unit_price: l.unit_price,
        })),
        expenses: expenseList,
      })
      if (!id) {
        navigate(`/app/containers/${savedId}`, { replace: true, state: { notice: 'Container saved.' } })
        return
      }
      setNotice('Container saved.')
      setVersion((v) => v + 1)
    })

  const handleReopen = () => {
    if (!window.confirm('Reopen this container? The stock it added will be removed from the stores and product costs restored.')) return
    run(async () => {
      await reopenContainer(id)
      setNotice('Container reopened. Its stock was removed.')
      setVersion((v) => v + 1)
    })
  }

  const handleDelete = () => {
    if (!window.confirm(`Delete container ${doc.container_no}? This cannot be undone.`)) return
    run(async () => {
      await deleteContainer(id)
      navigate('/app/containers', { replace: true, state: { notice: `Container ${doc.container_no} deleted.` } })
    })
  }

  // Managers have the supplier list and may be changing it; others see the saved name
  const supplierName = canManage ? suppliers.find((s) => s.id === form.supplier_id)?.name : doc?.supplier?.name
  // Distinct suppliers on the packing list (a blank line counts as the container's supplier)
  const supplierCount = new Set(lines.map((l) => l.supplier_id || form.supplier_id || 'none')).size
  const totalLanded = costs.reduce((s, c) => s + c.goods + c.share, 0)
  const expenseTotal = expenseList.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/app/containers" className="back-link">
            <ArrowLeft size={16} /> Containers
          </Link>
          <h1 className="container-title">
            {doc ? <span className="mono">{doc.container_no}</span> : 'New container'}
            {doc && <ContainerStatus status={doc.status} />}
          </h1>
          {doc && (
            <p className="text-secondary">
              {supplierName ?? 'No supplier'}
              {received ? ` · Received ${formatDate(doc.received_date)}` : doc.eta ? ` · Arrives ${formatDate(doc.eta)}` : ''}
            </p>
          )}
        </div>
        <div className="page-actions">
          {doc && received && can('delete') && (
            <button className="btn btn-secondary" onClick={handleReopen} disabled={busy}>
              <Undo2 size={16} /> Reopen
            </button>
          )}
          {doc && !received && can('delete') && (
            <button className="btn btn-danger-ghost" onClick={handleDelete} disabled={busy}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          {doc && !received && can('containers.receive') && (
            <Link
              to={`/app/containers/${id}/receive`}
              className={`btn btn-primary ${dirty || lines.length === 0 ? 'disabled' : ''}`}
              onClick={(e) => (dirty || lines.length === 0) && e.preventDefault()}
              title={dirty ? 'Save your changes first' : undefined}
            >
              <PackageCheck size={16} /> Receive container
            </Link>
          )}
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}
      <ErrorBanner message={error} />
      {received && doc.notes && <p className="text-secondary form-help">Notes: {doc.notes}</p>}
      {received && canManage && (
        <p className="text-secondary form-help">Received and locked. {can('delete') ? 'Reopen it to make changes.' : 'An administrator can reopen it.'}</p>
      )}

      <div className="stack">
        {/* ---------- Details ---------- */}
        {(editable || !received) && (
          <div className="card">
            <fieldset className="plain-fieldset" disabled={!editable}>
              <div className="form-grid form-grid-4">
                <Field label="Container no.">
                  <input
                    className="input mono"
                    required
                    value={form.container_no}
                    onChange={set('container_no')}
                    placeholder="e.g. MSKU0221809"
                    autoFocus={!id}
                    ref={(el) => el?.setCustomValidity(form.container_no && !form.container_no.trim() ? 'Container no. cannot be only spaces.' : '')}
                  />
                </Field>
                <Field label="Supplier / Agent">
                  {editable ? (
                    <select className="input" value={form.supplier_id} onChange={chooseSupplier}>
                      <option value="">No supplier</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input" value={supplierName ?? '—'} readOnly />
                  )}
                </Field>
                <Field label="Status">
                  <div className="segmented segmented-fill">
                    <button type="button" className={!onTheWay ? 'active' : ''} onClick={() => setOnTheWay(false)}>
                      Ordered
                    </button>
                    <button type="button" className={onTheWay ? 'active' : ''} onClick={() => setOnTheWay(true)}>
                      On the way
                    </button>
                  </div>
                </Field>
                <Field label="Expected arrival">
                  <input type="date" className="input" value={form.eta} onChange={set('eta')} />
                </Field>
                {showCosts && (
                  <>
                    <Field label="Currency">
                      <select className="input" value={form.currency} onChange={set('currency')}>
                        {CURRENCIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`Rate (Rs for 1 ${form.currency})`}>
                      <input
                        className="input input-num"
                        inputMode="decimal"
                        required
                        value={form.exchange_rate}
                        onChange={set('exchange_rate')}
                        ref={(el) => el?.setCustomValidity(form.exchange_rate !== '' && !(Number(form.exchange_rate) > 0) ? 'Rate must be a number more than 0.' : '')}
                        placeholder={form.currency === 'PKR' ? '1' : 'e.g. 280'}
                      />
                    </Field>
                  </>
                )}
                <div className={showCosts ? 'span-2' : 'span-all'}>
                  <Field label="Notes">
                    <input className="input" value={form.notes} onChange={set('notes')} placeholder="Optional: B/L no., shipping line, anything else" />
                  </Field>
                </div>
              </div>
            </fieldset>
            {onTheWay && <p className="text-secondary form-help">On the way: shown on the Stock screen, not sellable until received.</p>}
          </div>
        )}

        {/* ---------- Packing list ---------- */}
        <div className="card">
          <div className="card-head card-head-tight">
            <div>
              <h3>Products</h3>
              <p className="text-secondary">
                {editable ? 'Search a product and press Enter, or import the supplier’s list.' : 'What is in this container.'}
                {showCosts && editable && ` Price is per piece in ${form.currency}.`}
              </p>
            </div>
            {editable && (
              <button className="btn btn-secondary btn-sm" onClick={() => setImporting(true)}>
                <FileSpreadsheet size={16} /> Import CSV
              </button>
            )}
          </div>
          {editable && <ProductSearch ref={searchRef} products={products} onPick={addProduct} placeholder="Add a product by name or code" />}

          {lines.length > 0 ? (
            <div className="table-scroll">
              <table className="table table-compact lines-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Supplier</th>
                    <th className="num">Cartons</th>
                    <th className="num">Per carton</th>
                    <th className="num">Loose</th>
                    <th className="num">Total</th>
                    {showCosts && <th className="num">Price</th>}
                    {received && <th className="num">Received</th>}
                    {received && <th className="num">Left</th>}
                    {editable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const p = l.product
                    const qty = lineQty(l)
                    const input = (field, extra = {}) =>
                      editable ? (
                        <input
                          className="input input-num input-sm"
                          inputMode="decimal"
                          value={l[field]}
                          placeholder="0"
                          onChange={(e) => updateLine(l.key, field, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && searchRef.current?.focus()}
                          {...extra}
                        />
                      ) : (
                        num(l[field])
                      )
                    const short = received && Number(l.received_qty) < qty
                    return (
                      <tr key={l.key} className={short ? 'row-warn' : ''}>
                        <td className="line-product">
                          <div className="cell-stack">
                            <Link to={`/app/products/${p.id}/ledger`} className="strong link">
                              {p.name}
                            </Link>
                            <span className="text-muted">
                              {p.code} · {p.unit}
                            </span>
                          </div>
                        </td>
                        <td className="line-supplier" data-label="Supplier">
                          {editable ? (
                            <select className="input input-sm" value={l.supplier_id} onChange={(e) => updateLine(l.key, 'supplier_id', e.target.value)}>
                              <option value="">Same as container{supplierName ? ` (${supplierName})` : ''}</option>
                              {suppliers.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          ) : l.supplier_id ? (
                            l.supplier_name || '—'
                          ) : (
                            <span className="text-muted">{supplierName ?? '—'}</span>
                          )}
                        </td>
                        <td className="num" data-label="Cartons">
                          {input('cartons', {
                            ref: (el) => {
                              cartonRefs.current[l.key] = el
                              el?.setCustomValidity(qty > 0 ? '' : 'Enter cartons or loose pieces.')
                            },
                          })}
                        </td>
                        <td className="num" data-label="Per carton">
                          {input('carton_qty', { ref: (el) => el?.setCustomValidity(Number(l.carton_qty) >= 1 ? '' : 'At least 1 per carton.') })}
                        </td>
                        <td className="num" data-label="Loose">
                          {input('loose', { ref: (el) => el?.setCustomValidity(notAmount(l.loose) ? 'Loose must be a number.' : '') })}
                        </td>
                        <td className="num strong" data-label="Total">
                          {qtyText(qty, p.unit, l.carton_qty)}
                        </td>
                        {showCosts && (
                          <td className="num" data-label="Price">
                            {input('unit_price', { ref: (el) => el?.setCustomValidity(notAmount(l.unit_price) ? 'Price must be a number, 0 or more.' : '') })}
                          </td>
                        )}
                        {received && (
                          <td className={`num ${short ? 'text-warning strong' : ''}`} data-label="Received">
                            {qtyText(l.received_qty, p.unit, l.carton_qty)}
                            {short && <div className="text-muted">short {qtyText(qty - Number(l.received_qty), p.unit, l.carton_qty)}</div>}
                          </td>
                        )}
                        {received && (
                          <td className="num strong" data-label="Left">
                            <Left lot={lots[p.id]} unit={p.unit} cartonQty={l.carton_qty} />
                          </td>
                        )}
                        {editable && (
                          <td className="row-actions">
                            <button className="icon-btn danger" onClick={() => removeLine(l.key)} aria-label="Remove">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-secondary">
                      {lines.length} product{lines.length === 1 ? '' : 's'}
                      {totals.cbm > 0 && ` · ${num(totals.cbm)} m³`}
                    </td>
                    <td className="text-secondary">{supplierCount > 1 ? `${supplierCount} suppliers` : ''}</td>
                    <td className="num strong">{num(totals.cartons)}</td>
                    <td colSpan={2} />
                    <td className="num strong">{num(totals.qty)}</td>
                    {showCosts && (
                      <td className="num strong">
                        {form.currency} {fmt2(totals.value)}
                      </td>
                    )}
                    {received && <td />}
                    {received && <td />}
                    {editable && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-muted rank-empty">{editable ? 'No products yet.' : 'This container has no products.'}</p>
          )}
        </div>

        {/* ---------- Expenses + landed cost (admin / manager) ---------- */}
        {showCosts && (
          <div className="container-costs">
            <div className="card">
              <div className="card-head card-head-tight">
                <div>
                  <h3>Import costs (Rs)</h3>
                  <p className="text-secondary">Money paid on top of the goods price, from China to your store.</p>
                </div>
              </div>
              <fieldset className="plain-fieldset" disabled={!editable}>
                <div className="expense-boxes">
                  {EXPENSES.map((name) => (
                    <Field key={name} label={EXPENSE_LABELS[name].label}>
                      <input
                        className="input input-num"
                        inputMode="decimal"
                        placeholder="0"
                        value={expenses[name]}
                        onChange={(e) => change(() => setExpenses((x) => ({ ...x, [name]: e.target.value })))}
                        ref={(el) => el?.setCustomValidity(notAmount(expenses[name]) ? 'Enter an amount in Rs, 0 or more.' : '')}
                      />
                      <span className="field-note">{EXPENSE_LABELS[name].hint}</span>
                    </Field>
                  ))}
                </div>
              </fieldset>
              <div className="cost-total">
                <span className="text-secondary">Total import costs</span>
                <span className="strong">{money(expenseTotal)}</span>
              </div>
              <p className="text-muted field-note">
                {costBasis === 'cbm'
                  ? 'Split over the products by the space they take in the container (CBM).'
                  : 'Split over the products by their price. Add CBM to the products to split by space instead.'}
              </p>
            </div>

            <div className="card card-flush">
              <div className="card-head">
                <div>
                  <h3>Landed cost</h3>
                  <p className="text-secondary">What one piece costs at the store. Suggested price adds {num(margin)}% (Settings).</p>
                </div>
              </div>
              {lines.length === 0 ? (
                <p className="text-muted rank-empty">Add products to see their landed cost.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Landed / pc</th>
                        <th className="num">Sale price</th>
                        <th className="num">Suggested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const c = costs[i]
                        const low = c.landed > 0 && Number(l.product.price) < c.landed
                        return (
                          <tr key={l.key}>
                            <td className="strong">{l.product.name}</td>
                            <td className="num strong">{money(c.landed)}</td>
                            <td className={`num ${low ? 'text-critical strong' : ''}`} title={low ? 'Sale price is below the landed cost' : undefined}>
                              {money(l.product.price)}
                            </td>
                            <td className="num">{money(suggestedPrice(c.landed, margin))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="text-secondary">Whole container</td>
                        <td colSpan={3} className="num strong">
                          {money(totalLanded)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {received && showCosts && <ProfitCard lines={lines} lots={lots} profit={profit} />}

        {editable && (
          <div className="card form-footer">
            <span className="text-secondary mr-auto">{dirty ? 'Unsaved changes' : doc ? 'All changes saved' : ''}</span>
            <Link to="/app/containers" className="btn btn-secondary">
              Cancel
            </Link>
            <button className="btn btn-primary" disabled={busy || (doc && !dirty)} onClick={handleSave}>
              {busy ? 'Saving…' : 'Save container'}
            </button>
          </div>
        )}
      </div>

      {importing && (
        <PackingListImport products={products} suppliers={suppliers} onProducts={setProducts} onImport={importRows} onClose={() => setImporting(false)} />
      )}
    </>
  )
}

// What is still in stock from this container (first in, first out)
function Left({ lot, unit, cartonQty }) {
  if (!lot) return '—'
  return lot.remaining > 0 ? qtyText(lot.remaining, unit, cartonQty) : <span className="text-muted">Sold out</span>
}

// Sales matched to this container's goods, first in first out (admin / manager)
function ProfitCard({ lines, lots, profit }) {
  const rows = lines.map((l) => ({ line: l, p: profit[l.product.id] ?? { sold: 0, revenue: 0, profit: 0 } }))
  const total = rows.reduce((t, { p }) => ({ revenue: t.revenue + p.revenue, profit: t.profit + p.profit }), { revenue: 0, profit: 0 })
  return (
    <div className="card card-flush">
      <div className="card-head">
        <div>
          <h3>Sales and profit</h3>
          <p className="text-secondary">Oldest stock is sold first. Profit is at the bill rate, before bill discounts.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Sold</th>
              <th className="num">Left</th>
              <th className="num">Revenue</th>
              <th className="num">Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line: l, p }) => (
              <tr key={l.key}>
                <td className="strong">{l.product.name}</td>
                <td className="num">{qtyText(p.sold, l.product.unit, l.carton_qty)}</td>
                <td className="num">
                  <Left lot={lots[l.product.id]} unit={l.product.unit} cartonQty={l.carton_qty} />
                </td>
                <td className="num">{money(p.revenue)}</td>
                <td className={`num strong ${p.profit < 0 ? 'text-critical' : ''}`}>{money(p.profit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="strong">Total</td>
              <td colSpan={2} />
              <td className="num strong">{money(total.revenue)}</td>
              <td className={`num strong ${total.profit < 0 ? 'text-critical' : ''}`}>{money(total.profit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
