import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Plus, ReceiptText, Search, UserRound, X } from 'lucide-react'
import { findInvoiceId, listCustomers, listInvoices } from '../../services/api'
import { DATE_PRESETS, DELIVERY_LABELS, PAYMENT_LABELS, TXN_LABELS, formatDate, money, monthStart, today } from '../../shared/lib/format'
import { customerLabel } from '../../shared/lib/customerFields'
import { downloadCsv, slug } from '../../shared/lib/csv'
import { matchesWords } from '../../shared/lib/search'
import { EmptyState, ErrorBanner, Loading, PageHeader, TxnBadge } from '../../shared/components/ui'
import { CustomerSearch, DateRange } from '../../shared/components/Pickers'
import { useAuth } from '../../app/auth/AuthProvider'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'return', label: 'Returns' },
]

const net = (r) => (r.txn_type === 'return' ? -Number(r.total) : Number(r.total))

export default function InvoiceList() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const showBy = can('reports')
  const [params, setParams] = useSearchParams()
  const customerId = params.get('customer') ?? ''
  // Opened for one customer (from their ledger): show all their invoices, not just this month
  const [range, setRange] = useState(() => (customerId ? { from: '', to: '' } : { from: monthStart(), to: today() }))
  const [customers, setCustomers] = useState([])
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [goNo, setGoNo] = useState('')

  useEffect(() => {
    listCustomers().then(setCustomers).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    setRows(null)
    listInvoices({ ...range, customerId }).then(setRows).catch((e) => setError(e.message))
  }, [range, customerId])

  const customer = customers.find((c) => c.id === customerId) ?? null
  const setCustomer = (c) =>
    setParams(
      (p) => {
        if (c) p.set('customer', c.id)
        else p.delete('customer')
        return p
      },
      { replace: true },
    )
  const preset = DATE_PRESETS.find((p) => {
    const r = p.range()
    return r.from === range.from && r.to === range.to
  })?.value

  const filtered = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        if (filter === 'return' && r.txn_type !== 'return') return false
        if ((filter === 'cash' || filter === 'credit' || filter === 'cheque') && (r.txn_type !== 'sale' || r.payment_mode !== filter)) return false
        return matchesWords(q, String(r.invoice_no), r.customers?.name, r.customers?.city, r.bilty_no)
      }),
    [rows, q, filter],
  )

  const total = filtered.reduce((s, r) => s + net(r), 0)

  function exportCsv() {
    const header = ['Invoice', 'Date', 'Customer', 'City', 'Type', 'Payment', 'Delivery', 'Bilty', 'Amount', 'Received', ...(showBy ? ['By'] : [])]
    const body = filtered.map((r) => [
      r.invoice_no,
      r.invoice_date,
      r.customers?.name,
      r.customers?.city,
      TXN_LABELS[r.txn_type],
      r.txn_type === 'sale' ? PAYMENT_LABELS[r.payment_mode] : '',
      DELIVERY_LABELS[r.delivery_mode],
      r.bilty_no,
      net(r),
      Number(r.received),
      ...(showBy ? [r.created_by_name] : []),
    ])
    const who = customer ? slug(customerLabel(customer)) : 'all'
    const when = range.from || range.to ? `${range.from || 'start'}-to-${range.to || today()}` : 'all-dates'
    downloadCsv(`invoices-${who}-${when}.csv`, [header, ...body, [], ['Total', '', '', '', '', '', '', '', total]])
  }

  async function goTo(e) {
    e.preventDefault()
    const no = Number(goNo)
    if (!Number.isInteger(no) || no <= 0) return
    setError('')
    try {
      const id = await findInvoiceId(no)
      if (id) navigate(`/app/invoices/${id}`)
      else setError(`Invoice #${no} was not found.`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <PageHeader
        title="Sale invoices"
        subtitle="Sales and returns. Click a row to view or print."
        actions={
          <>
            <form className="go-to" onSubmit={goTo}>
              <input className="input" inputMode="numeric" data-numeric="int" placeholder="Invoice #" value={goNo} onChange={(e) => setGoNo(e.target.value)} aria-label="Open invoice number" />
              <button className="btn btn-secondary">Open</button>
            </form>
            <Link to="/app/invoices/new" className="btn btn-primary">
              <Plus size={16} /> New sale
            </Link>
          </>
        }
      />

      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search invoice #, customer, city or bilty" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="toolbar-customer">
            {customer ? (
              <div className="picked">
                <UserRound size={16} />
                <span className="strong">{customerLabel(customer)}</span>
                <button type="button" className="icon-btn" onClick={() => setCustomer(null)} aria-label="Show all customers">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <CustomerSearch customers={customers} onPick={setCustomer} />
            )}
          </div>
          <DateRange {...range} onChange={setRange} />
          <div className="segmented">
            {DATE_PRESETS.map((p) => (
              <button key={p.value} className={preset === p.value ? 'active' : ''} onClick={() => setRange(p.range())}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="segmented">
            {FILTERS.map((f) => (
              <button key={f.value} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!filtered.length} title="Download as a CSV file for Excel">
            <Download size={16} /> Excel
          </button>
        </div>

        {!rows && !error && <Loading />}
        {rows && filtered.length === 0 && (
          <EmptyState
            icon={rows.length ? Search : ReceiptText}
            title={rows.length ? 'No matches' : customer ? `No invoices for ${customerLabel(customer)} in these dates` : 'No invoices in these dates'}
            text={rows.length ? 'Try a different search or filter.' : customer ? 'Try "All" dates.' : 'Change the dates, or create a new sale.'}
            action={
              !rows.length && (
                <Link to="/app/invoices/new" className="btn btn-primary btn-sm">
                  <Plus size={16} /> New sale
                </Link>
              )
            }
          />
        )}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Inv #</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Type</th>
                <th className="hide-sm">Delivery</th>
                {showBy && <th className="hide-sm">By</th>}
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="row-link" onClick={() => navigate(`/app/invoices/${r.id}`)}>
                  <td className="strong">{r.invoice_no}</td>
                  <td className="text-secondary nowrap">{formatDate(r.invoice_date)}</td>
                  <td>
                    {r.customers?.name}
                    {r.customers?.city && <span className="text-muted"> · {r.customers.city}</span>}
                  </td>
                  <td>
                    <TxnBadge type={r.txn_type} mode={r.payment_mode} />
                  </td>
                  <td className="text-secondary hide-sm">
                    {DELIVERY_LABELS[r.delivery_mode]}
                    {r.bilty_no && ` · ${r.bilty_no}`}
                  </td>
                  {showBy && <td className="text-secondary hide-sm">{r.created_by_name ?? '—'}</td>}
                  <td className={`num strong ${r.txn_type === 'return' ? 'text-warning' : ''}`}>{money(net(r))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showBy ? 6 : 5} className="text-secondary">
                  {filtered.length} invoice{filtered.length === 1 ? '' : 's'} · net of returns
                </td>
                <td className="num strong">{money(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}
