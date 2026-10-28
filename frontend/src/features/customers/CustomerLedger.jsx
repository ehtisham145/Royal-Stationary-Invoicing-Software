import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Download, HandCoins, Package, Pencil, Plus, Printer, ReceiptText } from 'lucide-react'
import { getCustomer, getCustomerLedger, listCustomerItems } from '../../services/api'
import { formatDate, money, num, qtyText } from '../../shared/lib/format'
import { downloadCsv, slug } from '../../shared/lib/csv'
import { customerLabel } from '../../shared/lib/customerFields'
import { EmptyState, ErrorBanner, Loading } from '../../shared/components/ui'
import { CustomerModal } from '../../shared/components/RecordModals'
import ReceiptModal from '../sales/ReceiptModal'
import { useAuth } from '../../app/auth/AuthProvider'
import DateInput from '../../shared/components/DateInput'

const KIND_LABELS = { opening: 'Opening', sale: 'Sale', return: 'Return', receipt: 'Receipt' }

const TABS = [
  { value: 'ledger', label: 'Ledger' },
  { value: 'products', label: 'Products bought' },
]

// One row per product: quantity and amount net of returns, number of bills, last sale rate
function productSummary(items, from, to) {
  const map = new Map()
  for (const it of items) {
    const { invoice_date: date, txn_type: type, invoice_no: no } = it.invoices
    if ((from && date < from) || (to && date > to)) continue
    const sign = type === 'return' ? -1 : 1
    const row = map.get(it.product_id) ?? {
      product_id: it.product_id, name: it.product_name, unit: it.unit, carton_qty: it.carton_qty,
      qty: 0, amount: 0, bills: new Set(), last_date: null, last_rate: null, last_no: null,
    }
    row.qty += sign * Number(it.qty)
    row.amount += sign * Number(it.line_total)
    row.bills.add(no)
    // items are oldest first, so the last sale seen is the latest
    if (type === 'sale') Object.assign(row, { last_date: date, last_rate: Number(it.unit_price), last_no: no, name: it.product_name })
    map.set(it.product_id, row)
  }
  return [...map.values()].map((r) => ({ ...r, bills: r.bills.size })).sort((a, b) => b.amount - a.amount)
}

export default function CustomerLedger() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const canEdit = can('customers.manage')
  const [customer, setCustomer] = useState(null)
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [modal, setModal] = useState(null) // 'edit' | 'receipt'
  const [tab, setTab] = useState('ledger')
  const [items, setItems] = useState(null) // loaded when "Products bought" is first opened

  const load = () =>
    Promise.all([getCustomer(id), getCustomerLedger(id)])
      .then(([c, e]) => {
        setCustomer(c)
        setEntries(e)
      })
      .catch((e) => setError(e.message))

  useEffect(() => {
    setCustomer(null)
    setEntries(null)
    setItems(null)
    load()
  }, [id])

  useEffect(() => {
    if (tab === 'products' && !items) listCustomerItems(id).then(setItems).catch((e) => setError(e.message))
  }, [tab, items, id])

  const products = useMemo(() => (items ? productSummary(items, from, to) : null), [items, from, to])

  // Entries before `from` (and the opening balance) become one brought-forward line
  const view = useMemo(() => {
    if (!entries) return null
    let balance = 0
    let opening = 0
    const rows = []
    for (const e of entries) {
      const amt = Number(e.debit) - Number(e.credit)
      if (from && (e.entry_date === null || e.entry_date < from)) {
        opening += amt
        balance += amt
        continue
      }
      if (to && e.entry_date > to) continue
      balance += amt
      rows.push({ ...e, balance })
    }
    const debit = rows.reduce((s, r) => s + Number(r.debit), 0)
    const credit = rows.reduce((s, r) => s + Number(r.credit), 0)
    const current = entries.reduce((s, e) => s + Number(e.debit) - Number(e.credit), 0)
    return { rows, opening, debit, credit, closing: opening + debit - credit, current }
  }, [entries, from, to])

  if (!customer || !view) return error ? <ErrorBanner message={error} /> : <Loading />

  const refLink = (e) => {
    if (e.kind === 'sale' || e.kind === 'return') return <Link to={`/app/invoices/${e.ref_id}`} className="link">Inv #{e.ref_no}</Link>
    if (e.kind === 'receipt') return `Rcpt #${e.ref_no}`
    return '—'
  }

  const overLimit = Number(customer.credit_limit) > 0 && view.current > Number(customer.credit_limit)
  const period = from || to ? `${from || 'start'}-to-${to || 'today'}` : 'all-dates'

  function exportCsv() {
    const name = slug(customerLabel(customer))
    if (tab === 'products') {
      downloadCsv(`products-bought-${name}-${period}.csv`, [
        ['Product', 'Unit', 'Quantity', 'Amount', 'Bills', 'Last sale', 'Last rate'],
        ...products.map((p) => [p.name, p.unit, p.qty, p.amount, p.bills, p.last_date ?? '', p.last_rate ?? '']),
        [],
        ['Total', '', '', products.reduce((sum, p) => sum + p.amount, 0)],
      ])
      return
    }
    downloadCsv(`ledger-${name}-${period}.csv`, [
      ['Date', 'Type', 'Ref', 'Description', 'Debit', 'Credit', 'Balance'],
      ...(from ? [[from, '', '', 'Balance brought forward', '', '', view.opening]] : []),
      ...view.rows.map((e) => [e.entry_date ?? '', KIND_LABELS[e.kind], e.ref_no ?? '', e.description, Number(e.debit) || '', Number(e.credit) || '', e.balance]),
      ['', '', '', 'Totals', view.debit, view.credit, view.closing],
    ])
  }

  return (
    <>
      <div className="page-header no-print">
        <div>
          <Link to="/app/customers" className="back-link">
            <ArrowLeft size={16} /> Customers
          </Link>
          <h1>Customer ledger</h1>
        </div>
        <div className="page-actions">
          {canEdit && (
            <button className="btn btn-secondary" onClick={() => setModal('edit')}>
              <Pencil size={16} /> Edit
            </button>
          )}
          <Link to={`/app/invoices?customer=${customer.id}`} className="btn btn-secondary">
            <ReceiptText size={16} /> All invoices
          </Link>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print
          </button>
          <button className="btn btn-secondary" onClick={() => setModal('receipt')}>
            <HandCoins size={16} /> Receive payment
          </button>
          <Link to={`/app/invoices/new?customer=${customer.id}`} className="btn btn-primary">
            <Plus size={16} /> New sale
          </Link>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card ledger-head">
        <div>
          <div className="text-muted mono">Code {customer.code}</div>
          <h2>{customerLabel(customer)}</h2>
          <div className="text-secondary">
            {[customer.contact_person, customer.phone, customer.phone2].filter(Boolean).join(' · ') || 'No contact details'}
          </div>
          {customer.address && <div className="text-secondary">{customer.address}</div>}
        </div>
        <div className="ledger-total">
          <div className="meta-label">{view.current < 0 ? 'We owe them' : 'Balance due'}</div>
          <div className={`ledger-total-value ${overLimit ? 'text-critical' : ''}`}>{money(Math.abs(view.current))}</div>
          {Number(customer.credit_limit) > 0 && (
            <div className={overLimit ? 'text-critical' : 'text-muted'}>
              Credit limit {money(customer.credit_limit)}
              {overLimit && ' · over limit'}
            </div>
          )}
        </div>
      </div>

      <div className="card card-flush">
        <div className="toolbar no-print">
          <div className="segmented">
            {TABS.map((t) => (
              <button key={t.value} className={tab === t.value ? 'active' : ''} onClick={() => setTab(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="date-range">
            <DateInput value={from} max={to || undefined} onChange={setFrom} aria-label="From date" />
            <span className="text-muted">to</span>
            <DateInput value={to} min={from || undefined} onChange={setTo} aria-label="To date" />
          </div>
          {(from || to) && (
            <button className="btn btn-ghost btn-sm" onClick={() => (setFrom(''), setTo(''))}>
              Show all
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm toolbar-end"
            onClick={exportCsv}
            disabled={tab === 'products' ? !products?.length : view.rows.length === 0 && !view.opening}
            title="Download as a CSV file for Excel"
          >
            <Download size={16} /> Excel
          </button>
        </div>

        <div className="print-only print-title">
          {customerLabel(customer)} · {tab === 'products' ? 'Products bought' : 'Ledger'}
          {(from || to) && ` · ${from ? formatDate(from) : '…'} to ${to ? formatDate(to) : '…'}`}
        </div>

        {tab === 'products' ? (
          <ProductsBought rows={products} />
        ) : view.rows.length === 0 && !view.opening ? (
          <EmptyState icon={BookOpen} title="No entries yet" text="Sales, returns and payments for this customer will appear here." />
        ) : (
          <table className="table table-compact table-wide">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Ref</th>
                <th>Description</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {from && (
                <tr className="row-muted">
                  <td>{formatDate(from)}</td>
                  <td colSpan={5}>Balance brought forward</td>
                  <td className="num strong">{money(view.opening)}</td>
                </tr>
              )}
              {view.rows.map((e, i) => (
                <tr key={`${e.kind}-${e.ref_id ?? 'opening'}-${i}`}>
                  <td className="text-secondary nowrap">{e.entry_date ? formatDate(e.entry_date) : '—'}</td>
                  <td>{KIND_LABELS[e.kind]}</td>
                  <td className="nowrap">{refLink(e)}</td>
                  <td className="text-secondary">{e.description}</td>
                  <td className="num">{Number(e.debit) ? money(e.debit) : ''}</td>
                  <td className="num">{Number(e.credit) ? money(e.credit) : ''}</td>
                  <td className="num strong">{money(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-secondary">
                  Totals
                </td>
                <td className="num strong">{money(view.debit)}</td>
                <td className="num strong">{money(view.credit)}</td>
                <td className="num strong">{money(view.closing)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {modal === 'edit' && (
        <CustomerModal
          customer={customer}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
          onDeleted={() => navigate('/app/customers', { replace: true })}
        />
      )}
      {modal === 'receipt' && (
        <ReceiptModal
          customer={customer}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
    </>
  )
}

function ProductsBought({ rows }) {
  if (!rows) return <Loading />
  if (rows.length === 0) return <EmptyState icon={Package} title="Nothing bought in these dates" text="Products from this customer's sale invoices appear here." />
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <table className="table table-compact table-wide">
      <thead>
        <tr>
          <th>Product</th>
          <th className="num">Quantity</th>
          <th className="num">Amount</th>
          <th className="num hide-sm">Bills</th>
          <th className="hide-sm">Last sale</th>
          <th className="num">Last rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product_id}>
            <td>
              <Link to={`/app/products/${r.product_id}/ledger`} className="link strong">
                {r.name}
              </Link>
            </td>
            <td className={`num ${r.qty < 0 ? 'text-warning' : ''}`}>{qtyText(r.qty, r.unit, r.carton_qty)}</td>
            <td className="num strong">{money(r.amount)}</td>
            <td className="num text-secondary hide-sm">{num(r.bills)}</td>
            <td className="text-secondary nowrap hide-sm">{r.last_date ? `${formatDate(r.last_date)} · #${r.last_no}` : 'Returns only'}</td>
            <td className="num">{r.last_rate !== null ? money(r.last_rate) : '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="text-secondary">
            {rows.length} product{rows.length === 1 ? '' : 's'} · net of returns
          </td>
          <td />
          <td className="num strong">{money(total)}</td>
          <td colSpan={3} className="hide-sm" />
        </tr>
      </tfoot>
    </table>
  )
}
