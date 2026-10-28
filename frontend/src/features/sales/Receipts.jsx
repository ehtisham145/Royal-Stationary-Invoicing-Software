import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { HandCoins, Plus, Search, Trash2 } from 'lucide-react'
import { deleteReceipt, listBalances, listCustomers, listReceipts } from '../../services/api'
import { METHOD_LABELS, formatDate, money, monthStart, today } from '../../shared/lib/format'
import { matchesWords } from '../../shared/lib/search'
import { customerLabel } from '../../shared/lib/customerFields'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'
import { DateRange } from '../../shared/components/Pickers'
import ReceiptModal from './ReceiptModal'
import { useAuth } from '../../app/auth/AuthProvider'

export default function Receipts() {
  const { can } = useAuth()
  const canDelete = can('delete')
  const [params, setParams] = useSearchParams()
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [rows, setRows] = useState(null)
  const [customers, setCustomers] = useState([])
  const [balances, setBalances] = useState({})
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [notice, setNotice] = useState('')

  const adding = params.get('new') === '1'
  const setAdding = (on) => setParams(on ? { new: '1' } : {}, { replace: true })

  const loadReceipts = () => listReceipts(range).then(setRows).catch((e) => setError(e.message))

  useEffect(() => {
    setRows(null)
    loadReceipts()
  }, [range])

  useEffect(() => {
    if (!adding || customers.length) return
    Promise.all([listCustomers(), listBalances()])
      .then(([c, b]) => {
        setCustomers(c)
        setBalances(b)
      })
      .catch((e) => setError(e.message))
  }, [adding, customers.length])

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => matchesWords(q, String(r.receipt_no), r.customers?.name, r.customers?.city, r.reference, r.note)),
    [rows, q],
  )
  const total = filtered.reduce((s, r) => s + Number(r.amount), 0)

  async function remove(r) {
    if (!window.confirm(`Delete receipt #${r.receipt_no} of ${money(r.amount)}? The customer's balance will go up again.`)) return
    setError('')
    try {
      await deleteReceipt(r.id)
      setRows((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      <PageHeader
        title="Receipts"
        subtitle="Payments received from customers."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Receive payment
          </button>
        }
      />

      <ErrorBanner message={error} />
      {notice && <div className="notice">{notice}</div>}

      <div className="card card-flush">
        <div className="toolbar">
          <div className="input-icon toolbar-search">
            <Search size={16} />
            <input className="input" placeholder="Search customer, receipt # or reference" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <DateRange {...range} onChange={setRange} />
        </div>

        {!rows && !error && <Loading />}
        {rows && filtered.length === 0 && <EmptyState icon={HandCoins} title="No receipts in these dates" text="Change the dates, or receive a payment." />}

        {filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Rcpt #</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="hide-sm">Method</th>
                <th className="hide-sm cell-fill">Reference / note</th>
                <th className="hide-sm">By</th>
                <th className="num">Amount</th>
                {canDelete && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="strong">{r.receipt_no}</td>
                  <td className="text-secondary nowrap">{formatDate(r.receipt_date)}</td>
                  <td>
                    <Link to={`/app/customers/${r.customers?.id}`} className="link">
                      {customerLabel(r.customers)}
                    </Link>
                  </td>
                  <td className="hide-sm">{METHOD_LABELS[r.method]}</td>
                  <td className="text-secondary hide-sm cell-fill">
                    <span className="cell-truncate" title={[r.reference, r.note].filter(Boolean).join(' · ') || undefined}>
                      {[r.reference, r.note].filter(Boolean).join(' · ') || '—'}
                      {r.invoices && (
                        <Link to={`/app/invoices/${r.invoice_id}`} className="link">
                          {' '}
                          (Inv #{r.invoices.invoice_no})
                        </Link>
                      )}
                    </span>
                  </td>
                  <td className="text-secondary hide-sm">{r.creator?.name ?? '—'}</td>
                  <td className={`num strong ${Number(r.amount) < 0 ? 'text-critical' : ''}`}>{money(r.amount)}</td>
                  {canDelete && (
                    <td className="row-actions">
                      {!r.invoice_id && (
                        <button className="icon-btn danger" title="Delete receipt" aria-label="Delete receipt" onClick={() => remove(r)}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="text-secondary">
                  {filtered.length} receipt{filtered.length === 1 ? '' : 's'}
                </td>
                <td className="num strong">{money(total)}</td>
                {canDelete && <td />}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {adding && (
        <ReceiptModal
          customers={customers}
          balances={balances}
          onClose={() => setAdding(false)}
          onSaved={(r) => {
            setAdding(false)
            setNotice(`Receipt #${r.receipt_no} saved: ${money(r.amount)}.`)
            setBalances((b) => ({ ...b, [r.customer_id]: (b[r.customer_id] ?? 0) - Number(r.amount) }))
            loadReceipts()
          }}
        />
      )}
    </>
  )
}
