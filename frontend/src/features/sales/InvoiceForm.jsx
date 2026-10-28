import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Boxes, Camera, History, Plus, Trash2, UserRound, X } from 'lucide-react'
import {
  createInvoice,
  getDefaultCompany,
  getPriceHistory,
  getReturnableItems,
  listBalances,
  listCustomerSales,
  listCustomers,
  listLocations,
  listProducts,
  listStockLevels,
} from '../../services/api'
import { DELIVERY_LABELS, PAYMENT_LABELS, TXN_LABELS, computeInvoice, formatDate, money, num, qtyText, splitQty, toQty, today } from '../../shared/lib/format'
import { bestLocation, stockIndex } from '../stock/stockUtils'
import { customerLabel } from '../../shared/lib/customerFields'
import { EmptyState, ErrorBanner, Field, Loading, RequiredProxy } from '../../shared/components/ui'
import { validatePage } from '../../shared/lib/formValidation'
import { CustomerSearch, ProductSearch } from '../../shared/components/Pickers'
import { CustomerModal } from '../../shared/components/RecordModals'
import ChequeModal from './ChequeModal'
import { useAuth } from '../../app/auth/AuthProvider'
import DateInput from '../../shared/components/DateInput'

const n = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0
const NO_INVOICE = 'none' // return without an invoice (managers only)

export default function InvoiceForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { can } = useAuth()
  const canOverride = can('price.override')

  const [ready, setReady] = useState(false)
  const [company, setCompany] = useState(null)
  const [products, setProducts] = useState([])
  const [stock, setStock] = useState({})
  const [locations, setLocations] = useState([])
  const [customers, setCustomers] = useState([])
  const [balances, setBalances] = useState({})
  const [error, setError] = useState('')

  const [customer, setCustomer] = useState(null)
  const [date, setDate] = useState(today())
  const [txnType, setTxnType] = useState(params.get('type') === 'return' ? 'return' : 'sale')
  const [returnOf, setReturnOf] = useState(params.get('against') ?? '') // sale invoice id, NO_INVOICE or ''
  const [customerSales, setCustomerSales] = useState(null)
  const [paymentMode, setPaymentMode] = useState('credit')
  const [chequeFile, setChequeFile] = useState(null)
  const [chequeOpen, setChequeOpen] = useState(false)
  const [deliveryMode, setDeliveryMode] = useState('counter')
  const [biltyNo, setBiltyNo] = useState('')
  const [items, setItems] = useState([]) // { key, product_id, name, code, unit, carton_qty, min_price, location_id, cartons, loose, unit_price }
  const [discount, setDiscount] = useState('')
  const [freight, setFreight] = useState('')
  const [received, setReceived] = useState('')
  const [receivedTouched, setReceivedTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)

  // Entry panel for the product being added
  const [entry, setEntry] = useState(null) // { product, location_id, cartons, loose, unit_price }
  const [history, setHistory] = useState([])
  const searchRef = useRef(null)
  const cartonsRef = useRef(null)
  const looseRef = useRef(null)
  const rateRef = useRef(null)

  useEffect(() => {
    Promise.all([getDefaultCompany(), listProducts(), listStockLevels(), listLocations(), listCustomers(), listBalances()])
      .then(([co, p, levels, locs, cu, bal]) => {
        setCompany(co)
        setProducts(p)
        setStock(stockIndex(levels))
        setLocations(locs.filter((l) => l.active))
        setCustomers(cu)
        setBalances(bal)
        const pre = params.get('customer')
        if (pre) setCustomer(cu.find((c) => c.id === pre) ?? null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true))
  }, [])

  // Last sales of the product being added, to this customer
  useEffect(() => {
    setHistory([])
    if (!entry?.product || !customer) return
    let live = true
    getPriceHistory(customer.id, entry.product.id)
      .then((h) => live && setHistory(h))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [entry?.product, customer])

  // Returns: the customer's sale invoices to choose from
  useEffect(() => {
    setCustomerSales(null)
    if (txnType !== 'return' || !customer) return
    let live = true
    listCustomerSales(customer.id)
      .then((rows) => live && setCustomerSales(rows))
      .catch((e) => setError(e.message))
    return () => {
      live = false
    }
  }, [txnType, customer])

  // Return against an invoice: its lines become the bill, quantities start empty
  useEffect(() => {
    if (!returnOf || returnOf === NO_INVOICE) return
    let live = true
    getReturnableItems(returnOf)
      .then((rows) => {
        if (!live) return
        setEntry(null)
        setItems(
          rows.map((r) => ({
            key: r.id,
            return_item_id: r.id,
            product_id: r.product_id,
            name: r.product_name,
            unit: r.unit,
            carton_qty: r.carton_qty,
            min_price: 0,
            location_id: r.location_id,
            cartons: '',
            loose: '',
            unit_price: String(r.unit_price),
            sold: Number(r.qty),
            returned: r.returned,
            left: r.left,
          })),
        )
      })
      .catch((e) => setError(e.message))
    return () => {
      live = false
    }
  }, [returnOf])

  const totals = useMemo(() => computeInvoice(items, discount, freight), [items, discount, freight])

  // Cash / cheque: money taken = bill total, unless the user typed another amount
  useEffect(() => {
    if (!receivedTouched) setReceived(paymentMode !== 'credit' ? String(totals.total) : '')
  }, [paymentMode, totals.total, receivedTouched])

  if (!ready) return <Loading />
  if (!company) return <ErrorBanner message={error || 'Add your business details in Settings first.'} />

  const isSale = txnType === 'sale'
  const againstInvoice = !isSale && returnOf && returnOf !== NO_INVOICE

  function changeType(type) {
    setTxnType(type)
    if (returnOf) {
      setReturnOf('')
      setItems([])
    }
  }

  function changeCustomer(c) {
    setCustomer(c)
    if (returnOf) {
      setReturnOf('')
      setItems([])
    }
  }

  function chooseReturnOf(id) {
    if (id === returnOf) return
    // Leaving an invoice, or picking another one: the old lines go
    if (againstInvoice || id !== NO_INVOICE) setItems([])
    setReturnOf(id)
  }
  const available = (productId, locationId) => stock[productId]?.byLocation[locationId] ?? 0

  // Qty already on the bill per product+store, so two lines can't both use the same stock
  const usedOnBill = (productId, locationId, exceptKey) =>
    items
      .filter((i) => i.product_id === productId && i.location_id === locationId && i.key !== exceptKey)
      .reduce((s, i) => s + toQty(i.cartons, i.loose, i.carton_qty), 0)

  function pickProduct(p) {
    setEntry({
      product: p,
      location_id: bestLocation(stock[p.id], locations),
      cartons: '',
      loose: '',
      unit_price: String(p.price),
    })
    setTimeout(() => (p.carton_qty > 1 ? cartonsRef : looseRef).current?.focus(), 0)
  }

  const entryQty = entry ? toQty(entry.cartons, entry.loose, entry.product.carton_qty) : 0
  const entryValid = entry && entryQty > 0 && entry.unit_price !== '' && n(entry.unit_price) >= 0 && entry.location_id

  function addEntry() {
    if (!entryValid) return
    const p = entry.product
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: p.id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        carton_qty: p.carton_qty,
        min_price: Number(p.min_price),
        location_id: entry.location_id,
        cartons: entry.cartons,
        loose: entry.loose,
        unit_price: entry.unit_price,
      },
    ])
    setEntry(null)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const enterTo = (next) => (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (next) next.current?.focus()
    else addEntry()
  }

  const updateItem = (key, field, value) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
  const removeItem = (key) => setItems((prev) => prev.filter((i) => i.key !== key))

  const lines = items.map((i) => {
    const qty = toQty(i.cartons, i.loose, i.carton_qty)
    const avail = available(i.product_id, i.location_id) - usedOnBill(i.product_id, i.location_id, i.key)
    return {
      ...i,
      qty,
      amount: qty * n(i.unit_price),
      short: isSale && !company.allow_negative_stock && qty > avail,
      belowMin: isSale && i.min_price > 0 && n(i.unit_price) < i.min_price,
      over: i.return_item_id != null && qty > i.left,
      avail,
    }
  })
  // Against an invoice, lines left at 0 are simply not returned
  const billLines = againstInvoice ? lines.filter((l) => l.qty > 0) : lines

  const prevBalance = customer ? (balances[customer.id] ?? 0) : 0
  const receivedNum = n(received)
  const afterBill = isSale ? prevBalance + totals.total - receivedNum : prevBalance - totals.total + receivedNum
  const overLimit = customer && Number(customer.credit_limit) > 0 && isSale && afterBill > Number(customer.credit_limit)

  const blocking =
    billLines.some((l) => l.short || l.over || l.qty <= 0 || n(l.unit_price) < 0 || l.unit_price === '') || (!canOverride && billLines.some((l) => l.belowMin))
  const discountValid = totals.discount >= 0 && totals.discount <= totals.subtotal
  const chequeMissing = paymentMode === 'cheque' && !chequeFile
  const needsInvoice = !isSale && !returnOf
  const canSave = customer && billLines.length > 0 && !blocking && discountValid && totals.freight >= 0 && receivedNum >= 0 && date && !chequeMissing && !needsInvoice

  async function handleSave() {
    if (!validatePage()) return
    if (!canSave) {
      setError('Some items need attention: they are marked in red.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setSaving(true)
    setError('')
    try {
      const id = await createInvoice({
        customerId: customer.id,
        items: billLines,
        returnOf: againstInvoice ? returnOf : null,
        date,
        txnType,
        paymentMode,
        deliveryMode,
        biltyNo: deliveryMode === 'bilty' ? biltyNo : '',
        discount,
        freight,
        received,
        notes,
        chequeFile,
      })
      navigate(`/app/invoices/${id}`, { replace: true })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  // Returns against an invoice have no product picking, so no stock panel
  const showStockPanel = !againstInvoice && !needsInvoice
  const entryAvail = entry ? available(entry.product.id, entry.location_id) - usedOnBill(entry.product.id, entry.location_id) : 0
  const entryShort = entry && isSale && !company.allow_negative_stock && entryQty > entryAvail
  const entryBelowMin = entry && isSale && Number(entry.product.min_price) > 0 && n(entry.unit_price) < Number(entry.product.min_price)

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/app/invoices" className="back-link">
            <ArrowLeft size={16} /> Sale invoices
          </Link>
          <h1>{isSale ? 'New sale invoice' : 'New sale return'}</h1>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card invoice-head">
        <div className="invoice-head-customer">
          <Field label="Customer" required>
            {customer ? (
              <div className="picked">
                <UserRound size={16} />
                <span className="strong">{customerLabel(customer)}</span>
                <span className="text-muted">#{customer.code}</span>
                <button type="button" className="icon-btn" onClick={() => changeCustomer(null)} aria-label="Change customer">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="row-gap">
                <CustomerSearch
                  customers={customers}
                  balances={balances}
                  autoFocus
                  onPick={(c) => {
                    changeCustomer(c)
                    setTimeout(() => searchRef.current?.focus(), 0)
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => setAddingCustomer(true)}>
                  <Plus size={16} /> New
                </button>
              </div>
            )}
            <RequiredProxy value={customer} message="Choose the customer for this bill." />
          </Field>
        </div>
        <div className="invoice-head-date">
          <Field label="Date">
            <DateInput value={date} onChange={setDate} required />
          </Field>
        </div>
        <Field label="Type">
          <select className="input" value={txnType} onChange={(e) => changeType(e.target.value)}>
            {Object.entries(TXN_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {!isSale && (
          <div className="invoice-head-against">
            <Field label="Against invoice">
              <select
                className={`input ${needsInvoice && customer ? 'warn' : ''}`}
                required
                value={returnOf}
                disabled={!customer}
                onChange={(e) => chooseReturnOf(e.target.value)}
              >
                <option value="">{!customer ? 'Choose a customer first' : customerSales ? 'Choose invoice…' : 'Loading…'}</option>
                {(customerSales ?? []).map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    #{inv.invoice_no} · {formatDate(inv.invoice_date)} · {money(inv.total)}
                  </option>
                ))}
                {canOverride && <option value={NO_INVOICE}>No invoice (old sale)</option>}
              </select>
            </Field>
          </div>
        )}
        <Field label="Payment">
          <select
            className="input"
            value={paymentMode}
            onChange={(e) => (e.target.value === 'cheque' ? setChequeOpen(true) : setPaymentMode(e.target.value))}
          >
            {Object.entries(PAYMENT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {paymentMode === 'cheque' && (
          <Field label="Cheque photo" required>
            <button type="button" className="btn btn-secondary cheque-btn" onClick={() => setChequeOpen(true)} title={chequeFile?.name}>
              <Camera size={16} /> <span>{chequeFile ? chequeFile.name : 'Add photo'}</span>
            </button>
            <RequiredProxy value={chequeFile} message="Add a photo of the cheque." />
          </Field>
        )}
        <Field label="Delivery">
          <select className="input" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value)}>
            {Object.entries(DELIVERY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {deliveryMode === 'bilty' && (
          <Field label="Bilty no.">
            <input className="input" value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} placeholder="Goods transport receipt" />
          </Field>
        )}
      </div>

      <div className={`builder ${showStockPanel ? '' : 'builder-solo'}`}>
        <div className="builder-main">
          {againstInvoice ? (
            <ReturnLines lines={lines} locations={locations} invoiceNo={customerSales?.find((x) => x.id === returnOf)?.invoice_no} onChange={updateItem} />
          ) : needsInvoice ? (
            <div className="card">
              <div className="card-head card-head-tight">
                <div>
                  <h3>Items to return</h3>
                  <p className="text-secondary">
                    {customer ? 'Choose the invoice this return is for, above. Its items will appear here.' : 'Choose the customer, then the invoice this return is for.'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <div className="card">
            <div className="card-head card-head-tight">
              <div>
                <h3>Add items</h3>
                <p className="text-secondary">Search, Enter, then cartons → loose → rate → Enter.</p>
              </div>
            </div>
            <div className="field">
              <ProductSearch ref={searchRef} products={products} stock={stock} onPick={pickProduct} />
              <RequiredProxy value={lines.length} message="Add at least one item to the bill." />
            </div>

            {entry && (
              <div className="entry-panel">
                <div className="entry-title">
                  <div>
                    <div className="strong">{entry.product.name}</div>
                    <div className="text-muted">
                      {entry.product.code} · {entry.product.carton_qty > 1 ? `${entry.product.carton_qty} ${entry.product.unit} per carton` : entry.product.unit} · Price{' '}
                      {money(entry.product.price)}
                      {Number(entry.product.min_price) > 0 && ` · Min ${money(entry.product.min_price)}`}
                    </div>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setEntry(null)} aria-label="Cancel item">
                    <X size={16} />
                  </button>
                </div>

                <div className="stock-inline">
                  <EntryStock
                    name="sell-from-inline"
                    entry={entry}
                    locations={locations}
                    available={available}
                    customer={customer}
                    history={history}
                    setEntry={setEntry}
                  />
                </div>

                <div className="entry-inputs">
                  <Field label="Cartons">
                    <input
                      ref={cartonsRef}
                      className="input input-num"
                      inputMode="decimal"
                      disabled={entry.product.carton_qty <= 1}
                      placeholder={entry.product.carton_qty <= 1 ? '—' : '0'}
                      value={entry.product.carton_qty <= 1 ? '' : entry.cartons}
                      onChange={(e) => setEntry((x) => ({ ...x, cartons: e.target.value }))}
                      onKeyDown={enterTo(looseRef)}
                    />
                  </Field>
                  <Field label={`Loose (${entry.product.unit})`}>
                    <input
                      ref={looseRef}
                      className="input input-num"
                      inputMode="decimal"
                      placeholder="0"
                      value={entry.loose}
                      onChange={(e) => setEntry((x) => ({ ...x, loose: e.target.value }))}
                      onKeyDown={enterTo(rateRef)}
                    />
                  </Field>
                  <Field label={`Rate per ${entry.product.unit}`}>
                    <input
                      ref={rateRef}
                      className={`input input-num ${entryBelowMin ? 'warn' : ''}`}
                      inputMode="decimal"
                      value={entry.unit_price}
                      onChange={(e) => setEntry((x) => ({ ...x, unit_price: e.target.value }))}
                      onKeyDown={enterTo(null)}
                    />
                  </Field>
                  <Field label="Amount">
                    <div className="input input-locked">
                      <span className="text-muted">{qtyText(entryQty, entry.product.unit, entry.product.carton_qty)}</span>
                      <span>{money(entryQty * n(entry.unit_price))}</span>
                    </div>
                  </Field>
                  <button type="button" className="btn btn-primary entry-add" disabled={!entryValid} onClick={addEntry}>
                    <Plus size={16} /> Add
                  </button>
                </div>
                {entryShort && (
                  <p className="entry-warn critical">
                    <AlertTriangle size={14} /> Only {qtyText(entryAvail, entry.product.unit, entry.product.carton_qty)} available in this store.
                  </p>
                )}
                {entryBelowMin && (
                  <p className="entry-warn">
                    <AlertTriangle size={14} /> Below minimum price {money(entry.product.min_price)}
                    {canOverride ? ' (allowed for your role).' : '. A manager or administrator must make this sale.'}
                  </p>
                )}
              </div>
            )}

            {lines.length > 0 && (
              <div className="lines-wrap">
                <table className="table table-compact lines-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Store</th>
                      <th className="num">Ctn</th>
                      <th className="num">Loose</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={l.key} className={l.short || (l.belowMin && !canOverride) ? 'row-error' : ''}>
                        <td className="text-muted line-index">{idx + 1}</td>
                        <td className="line-product">
                          <div className="cell-stack">
                            <span className="strong">{l.name}</span>
                            <span className="text-muted">
                              {qtyText(l.qty, l.unit, l.carton_qty)}
                              {l.short && <span className="text-critical"> · only {num(l.avail)} {l.unit} in store</span>}
                              {l.belowMin && <span className="text-warning"> · below min {money(l.min_price)}</span>}
                            </span>
                          </div>
                        </td>
                        <td className="line-store" data-label="Store">
                          <select className="input input-sm" value={l.location_id} onChange={(e) => updateItem(l.key, 'location_id', e.target.value)}>
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num" data-label="Cartons">
                          <input
                            className="input input-num input-sm"
                            inputMode="decimal"
                            disabled={l.carton_qty <= 1}
                            value={l.carton_qty <= 1 ? '' : l.cartons}
                            onChange={(e) => updateItem(l.key, 'cartons', e.target.value)}
                          />
                        </td>
                        <td className="num" data-label="Loose">
                          <input
                            className="input input-num input-sm"
                            inputMode="decimal"
                            aria-label="Loose"
                            value={l.loose}
                            onChange={(e) => updateItem(l.key, 'loose', e.target.value)}
                            ref={(el) =>
                              el?.setCustomValidity(l.qty <= 0 ? 'Enter a quantity.' : l.short ? `Only ${num(l.avail)} ${l.unit} in this store.` : '')
                            }
                          />
                        </td>
                        <td className="num" data-label="Rate">
                          <input
                            className="input input-num input-sm"
                            inputMode="decimal"
                            aria-label="Rate"
                            value={l.unit_price}
                            onChange={(e) => updateItem(l.key, 'unit_price', e.target.value)}
                            ref={(el) =>
                              el?.setCustomValidity(
                                l.unit_price === '' || n(l.unit_price) < 0
                                  ? 'Enter a rate.'
                                  : l.belowMin && !canOverride
                                    ? `Below the minimum price of ${money(l.min_price)}.`
                                    : '',
                              )
                            }
                          />
                        </td>
                        <td className="num strong line-total" data-label="Amount">{money(l.amount)}</td>
                        <td className="row-actions">
                          <button className="icon-btn danger" onClick={() => removeItem(l.key)} aria-label="Remove">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
        </div>

        {showStockPanel && (
          <aside className="builder-aside">
            <div className="card stock-panel">
              {entry ? (
                <>
                  <div className="stock-panel-head">
                    <div className="summary-label">Stock by store</div>
                    <div className="strong">{entry.product.name}</div>
                    <div className="text-muted">
                      {entry.product.carton_qty > 1 ? `${entry.product.carton_qty} ${entry.product.unit} per carton` : entry.product.unit}
                    </div>
                  </div>
                  <EntryStock
                    name="sell-from-aside"
                    entry={entry}
                    locations={locations}
                    available={available}
                    customer={customer}
                    history={history}
                    setEntry={setEntry}
                  />
                </>
              ) : (
                <EmptyState icon={Boxes} title="Stock by store" text="Pick a product to see how much is on every floor, and choose the store to sell from." />
              )}
            </div>
          </aside>
        )}
      </div>

      <div className="card summary summary-bar">
        <div className="summary-block">
          <div className="summary-label">Customer</div>
          {customer ? (
            <>
              <div className="strong">{customerLabel(customer)}</div>
              <div className="sum-row">
                <span>Previous balance</span>
                <span>{money(prevBalance)}</span>
              </div>
            </>
          ) : (
            <div className="text-muted">No customer selected</div>
          )}
        </div>

        <div className="summary-block">
          <div className="summary-label">
            {isSale ? 'Bill' : 'Return'} · {billLines.length} item{billLines.length === 1 ? '' : 's'}
          </div>
          <div className="sum-row">
            <span>Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          <div className="sum-row sum-input">
            <span>Discount</span>
            <input
              className="input input-num input-sm"
              inputMode="decimal"
              aria-label="Discount"
              placeholder="0"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              ref={(el) => el?.setCustomValidity(discountValid ? '' : 'Discount must be between 0 and the bill amount.')}
            />
          </div>
          <div className="sum-row sum-input">
            <span>Freight</span>
            <input
              className="input input-num input-sm"
              inputMode="decimal"
              aria-label="Freight"
              placeholder="0"
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              ref={(el) => el?.setCustomValidity(totals.freight >= 0 ? '' : 'Freight cannot be negative.')}
            />
          </div>
          <div className="sum-row sum-total">
            <span>Net total</span>
            <span>{money(totals.total)}</span>
          </div>
          <div className="sum-row sum-input">
            <span>{isSale ? 'Received now' : 'Refunded now'}</span>
            <input
              className="input input-num input-sm"
              inputMode="decimal"
              placeholder="0"
              aria-label={isSale ? 'Received now' : 'Refunded now'}
              value={received}
              onChange={(e) => {
                setReceivedTouched(true)
                setReceived(e.target.value)
              }}
              ref={(el) => el?.setCustomValidity(receivedNum >= 0 ? '' : 'Amount cannot be negative.')}
            />
          </div>
          {customer && (
            <div className={`sum-row sum-after ${overLimit ? 'text-critical' : ''}`}>
              <span>Balance with this bill</span>
              <span>{money(afterBill)}</span>
            </div>
          )}
          {overLimit && <p className="entry-warn critical">Over credit limit of {money(customer.credit_limit)}.</p>}
        </div>

        <div className="summary-block">
          <Field label="Remarks">
            <textarea className="input" rows={2} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-block btn-lg summary-save" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : isSale ? 'Save invoice' : 'Save return'}
          </button>
          {!customer && <p className="text-muted summary-hint">Choose a customer to save.</p>}
          {customer && needsInvoice && <p className="text-muted summary-hint">Choose the invoice this return is for.</p>}
        </div>
      </div>

      {chequeOpen && (
        <ChequeModal
          file={chequeFile}
          onClose={() => setChequeOpen(false)}
          onDone={(f) => {
            setChequeFile(f)
            setPaymentMode('cheque')
            setChequeOpen(false)
          }}
        />
      )}
      {addingCustomer && (
        <CustomerModal
          onClose={() => setAddingCustomer(false)}
          onSaved={(c) => {
            setCustomers((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
            setCustomer(c)
            setAddingCustomer(false)
          }}
        />
      )}
    </>
  )
}

// Return against an invoice: every line of that bill, with how much can still come back
function ReturnLines({ lines, locations, invoiceNo, onChange }) {
  return (
    <div className="card">
      <div className="card-head card-head-tight">
        <div>
          <h3>Items on invoice #{invoiceNo ?? '…'}</h3>
          <p className="text-secondary">Enter what is coming back. Rates are from the original bill; leave empty for items not returned.</p>
        </div>
      </div>
      {lines.length === 0 ? (
        <p className="text-muted">Loading items…</p>
      ) : (
        <div className="lines-wrap">
          <table className="table table-compact lines-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Back to store</th>
                <th className="num">Ctn</th>
                <th className="num">Loose</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const done = l.left <= 0
                return (
                  <tr key={l.key} className={l.over ? 'row-error' : done ? 'row-muted' : ''}>
                    <td className="text-muted line-index">{idx + 1}</td>
                    <td className="line-product">
                      <div className="cell-stack">
                        <span className="strong">{l.name}</span>
                        <span className="text-muted">
                          Sold {qtyText(l.sold, l.unit, l.carton_qty)}
                          {l.returned > 0 && ` · ${qtyText(l.returned, l.unit, l.carton_qty)} already returned`}
                          {done && ' · fully returned'}
                          {l.over && <span className="text-critical"> · only {qtyText(l.left, l.unit, l.carton_qty)} can come back</span>}
                        </span>
                      </div>
                    </td>
                    <td className="line-store" data-label="Store">
                      <select className="input input-sm" value={l.location_id} disabled={done} onChange={(e) => onChange(l.key, 'location_id', e.target.value)}>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num" data-label="Cartons">
                      <input
                        className="input input-num input-sm"
                        inputMode="decimal"
                        placeholder={l.carton_qty <= 1 ? '—' : '0'}
                        disabled={done || l.carton_qty <= 1}
                        value={l.carton_qty <= 1 ? '' : l.cartons}
                        onChange={(e) => onChange(l.key, 'cartons', e.target.value)}
                      />
                    </td>
                    <td className="num" data-label="Loose">
                      <input
                        className="input input-num input-sm"
                        inputMode="decimal"
                        placeholder="0"
                        disabled={done}
                        aria-label="Loose"
                        ref={(el) => el?.setCustomValidity(l.over ? `Only ${qtyText(l.left, l.unit, l.carton_qty)} can come back.` : '')}
                        value={l.loose}
                        onChange={(e) => onChange(l.key, 'loose', e.target.value)}
                      />
                    </td>
                    <td className="num" data-label="Rate">
                      {money(l.unit_price)}
                    </td>
                    <td className="num strong line-total" data-label="Amount">
                      {money(l.amount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Stock of the picked product in every store, as a table. Clicking a row (or its radio) picks the store to sell from.
function StoreStock({ name, locations, product, qtyAt, selected, onSelect }) {
  const hasCartons = Number(product.carton_qty) > 1
  const rows = locations.map((l) => ({ ...l, qty: qtyAt(l.id) }))
  const total = rows.reduce((sum, r) => sum + r.qty, 0)
  const cell = (qty) => {
    const { cartons, loose } = splitQty(qty, product.carton_qty)
    return (
      <>
        {hasCartons && <td className="num">{cartons ? num(cartons) : '—'}</td>}
        {hasCartons && <td className="num">{loose ? num(loose) : '—'}</td>}
        <td className="num strong">
          {num(qty)} <span className="stock-unit">{product.unit}</span>
        </td>
      </>
    )
  }

  return (
    <div className="store-stock">
      <table className="table table-compact">
        <thead>
          <tr>
            <th>Store</th>
            {hasCartons && <th className="num">Cartons</th>}
            {hasCartons && <th className="num">Loose</th>}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`${r.id === selected ? 'is-selected' : ''} ${r.qty < 0 ? 'is-negative' : r.qty === 0 ? 'is-empty' : ''}`}
            >
              <td>
                <label className="store-pick">
                  <input type="radio" name={name} checked={r.id === selected} onChange={() => onSelect(r.id)} />
                  {r.name}
                </label>
              </td>
              {cell(r.qty)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>All stores</td>
            {cell(total)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// What the cashier needs while entering an item: stock per store, and this customer's last prices for it
function EntryStock({ name, entry, locations, available, customer, history, setEntry }) {
  return (
    <div className="entry-stock">
      <StoreStock
        name={name}
        locations={locations}
        product={entry.product}
        qtyAt={(locationId) => available(entry.product.id, locationId)}
        selected={entry.location_id}
        onSelect={(id) => setEntry((e) => ({ ...e, location_id: id }))}
      />
      {customer && history.length > 0 && (
        <div className="history">
          <div className="history-title">
            <History size={14} /> Last sales to {customer.name}
          </div>
          <table className="table table-compact">
            <tbody>
              {history.map((h) => (
                <tr key={`${h.invoice_id}-${h.unit_price}-${h.qty}`}>
                  <td>{formatDate(h.invoice_date)}</td>
                  <td>
                    Inv #{h.invoice_no}
                    {h.txn_type === 'return' && <span className="text-muted"> (return)</span>}
                  </td>
                  <td className="num">{qtyText(h.qty, entry.product.unit, entry.product.carton_qty)}</td>
                  <td className="num">
                    <button type="button" className="link-btn" onClick={() => setEntry((e) => ({ ...e, unit_price: String(h.unit_price) }))} title="Use this rate">
                      {money(h.unit_price)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
