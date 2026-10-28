import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react'
import { deleteInvoice, getChequeImageUrl, getInvoice } from '../../services/api'
import { DELIVERY_LABELS, PAYMENT_LABELS, formatDate, money, num, qtyText } from '../../shared/lib/format'
import { customerLabel } from '../../shared/lib/customerFields'
import { ErrorBanner, Loading, TxnBadge } from '../../shared/components/ui'
import { useAuth } from '../../app/auth/AuthProvider'
import { Crown } from '../../shared/components/Logo'

const LAYOUTS = [
  { value: 'normal', label: 'Normal' },
  { value: 'packing', label: 'Packing slip' },
]

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const canDelete = can('delete')
  const canSell = can('sales')
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [layout, setLayout] = useState('normal')
  const [chequeUrl, setChequeUrl] = useState('')

  useEffect(() => {
    setDoc(null)
    getInvoice(id).then(setDoc).catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    setChequeUrl('')
    if (doc?.cheque_image) getChequeImageUrl(doc.cheque_image).then(setChequeUrl).catch(() => {})
  }, [doc?.cheque_image])

  async function remove() {
    if (!window.confirm(`Delete invoice #${doc.invoice_no}? Stock goes back to the stores and the customer's account is reversed.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteInvoice(doc.id)
      navigate('/app/invoices', { replace: true })
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  if (!doc) return error ? <ErrorBanner message={error} /> : <Loading />

  const co = doc.companies
  const cu = doc.customers
  const isSale = doc.txn_type === 'sale'
  const sign = isSale ? 1 : -1
  const balanceAfter = Number(doc.prev_balance) + sign * Number(doc.total) - sign * Number(doc.received)
  const totalCartons = doc.items.reduce((s, it) => s + Number(it.cartons), 0)

  // Packing slip: grouped by store so each floor can pick its part
  const byStore = doc.items.reduce((acc, it) => {
    const k = it.locations?.name ?? '—'
    ;(acc[k] ??= []).push(it)
    return acc
  }, {})

  return (
    <>
      <div className="page-header no-print">
        <div>
          <Link to="/app/invoices" className="back-link">
            <ArrowLeft size={16} /> Sale invoices
          </Link>
          <div className="title-row">
            <h1>
              {isSale ? 'Invoice' : 'Return'} #{doc.invoice_no}
            </h1>
            <TxnBadge type={doc.txn_type} mode={doc.payment_mode} />
          </div>
          {doc.created_by_name && <p className="text-secondary created-by">Created by {doc.created_by_name}</p>}
          {doc.original && (
            <p className="text-secondary created-by">
              Return against{' '}
              <Link to={`/app/invoices/${doc.original.id}`} className="link">
                invoice #{doc.original.invoice_no}
              </Link>{' '}
              of {formatDate(doc.original.invoice_date)}
            </p>
          )}
          {doc.returns.length > 0 && (
            <p className="text-secondary created-by">
              Returned on:{' '}
              {doc.returns.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ', '}
                  <Link to={`/app/invoices/${r.id}`} className="link">
                    #{r.invoice_no}
                  </Link>{' '}
                  ({money(r.total)})
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="page-actions">
          {canDelete && (
            <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <div className="segmented">
            {LAYOUTS.map((l) => (
              <button key={l.value} className={layout === l.value ? 'active' : ''} onClick={() => setLayout(l.value)}>
                {l.label}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print / PDF
          </button>
          {isSale && canSell && (
            <Link to={`/app/invoices/new?type=return&customer=${doc.customer_id}&against=${doc.id}`} className="btn btn-secondary">
              <RotateCcw size={16} /> Return items
            </Link>
          )}
          <Link to="/app/invoices/new" className="btn btn-primary">
            <Plus size={16} /> New sale
          </Link>
        </div>
      </div>

      <div className="no-print">
        <ErrorBanner message={error} />
      </div>

      <article className="paper">
        <header className="paper-head">
          <div>
            <div className="paper-brand">
              <Crown size={48} />
              <h2>{co.name}</h2>
            </div>
            {co.address && <div className="text-secondary">{co.address}</div>}
            <div className="text-secondary">{[co.phone, co.email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="paper-title">
            <div className="paper-kind">{layout === 'packing' ? 'Packing slip' : isSale ? 'Sale invoice' : 'Sale return'}</div>
            <div className="paper-no">No. {doc.invoice_no}</div>
          </div>
        </header>

        <section className="paper-meta">
          <div>
            <div className="meta-label">{isSale ? 'Bill to' : 'Returned by'}</div>
            <div className="strong">{customerLabel(cu)}</div>
            <div className="text-secondary">Code {cu.code}</div>
            {cu.address && <div className="text-secondary">{cu.address}</div>}
            <div className="text-secondary">{[cu.phone, cu.phone2].filter(Boolean).join(' · ')}</div>
          </div>
          <dl className="meta-list">
            <div>
              <dt>Date</dt>
              <dd>{formatDate(doc.invoice_date)}</dd>
            </div>
            {doc.original && (
              <div>
                <dt>Against invoice</dt>
                <dd>#{doc.original.invoice_no}</dd>
              </div>
            )}
            <div>
              <dt>Payment</dt>
              <dd>{PAYMENT_LABELS[doc.payment_mode]}</dd>
            </div>
            {chequeUrl && (
              <div className="no-print">
                <dt>Cheque</dt>
                <dd>
                  <a href={chequeUrl} target="_blank" rel="noreferrer">
                    <img src={chequeUrl} alt="Cheque photo" className="cheque-thumb" />
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>Delivery</dt>
              <dd>{DELIVERY_LABELS[doc.delivery_mode]}</dd>
            </div>
            {doc.bilty_no && (
              <div>
                <dt>Bilty no.</dt>
                <dd>{doc.bilty_no}</dd>
              </div>
            )}
          </dl>
        </section>

        {layout === 'normal' ? (
          <table className="table paper-table">
            <thead>
              <tr>
                <th className="col-idx">#</th>
                <th>Description</th>
                <th className="num">Ctn</th>
                <th className="num">Loose</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="col-idx text-muted">{idx + 1}</td>
                  <td className="strong">{it.product_name}</td>
                  <td className="num">{it.carton_qty > 1 ? num(it.cartons) : '—'}</td>
                  <td className="num">{num(it.loose)}</td>
                  <td className="num">
                    {num(it.qty)} {it.unit}
                  </td>
                  <td className="num">{money(it.unit_price)}</td>
                  <td className="num">{money(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          Object.entries(byStore).map(([store, rows]) => (
            <table key={store} className="table paper-table packing-table">
              <thead>
                <tr>
                  <th colSpan={4}>Store: {store}</th>
                </tr>
                <tr>
                  <th className="col-idx">#</th>
                  <th>Description</th>
                  <th className="num">Packing</th>
                  <th className="num">Total qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it, idx) => (
                  <tr key={it.id}>
                    <td className="col-idx text-muted">{idx + 1}</td>
                    <td className="strong">{it.product_name}</td>
                    <td className="num">{qtyText(it.qty, it.unit, it.carton_qty)}</td>
                    <td className="num">
                      {num(it.qty)} {it.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        )}

        <section className="paper-bottom">
          <div className="paper-notes">
            <div className="meta-label">Summary</div>
            <p>
              {doc.items.length} item{doc.items.length === 1 ? '' : 's'}
              {totalCartons > 0 && ` · ${num(totalCartons)} carton${totalCartons === 1 ? '' : 's'}`}
            </p>
            {doc.notes && (
              <>
                <div className="meta-label paper-notes-label">Remarks</div>
                <p>{doc.notes}</p>
              </>
            )}
          </div>
          {layout === 'normal' && (
            <div className="paper-totals">
              <div className="sum-row">
                <span>Bill total</span>
                <span>{money(doc.subtotal)}</span>
              </div>
              {Number(doc.discount) > 0 && (
                <div className="sum-row">
                  <span>Discount</span>
                  <span>− {money(doc.discount)}</span>
                </div>
              )}
              {Number(doc.freight) > 0 && (
                <div className="sum-row">
                  <span>Freight</span>
                  <span>{money(doc.freight)}</span>
                </div>
              )}
              <div className="sum-row sum-total">
                <span>Net total</span>
                <span>{money(doc.total)}</span>
              </div>
              <div className="sum-row paper-balance">
                <span>Previous balance</span>
                <span>{money(doc.prev_balance)}</span>
              </div>
              {Number(doc.received) > 0 && (
                <div className="sum-row">
                  <span>{isSale ? 'Received' : 'Refunded'}</span>
                  <span>{money(doc.received)}</span>
                </div>
              )}
              <div className="sum-row strong">
                <span>Balance with this bill</span>
                <span>{money(balanceAfter)}</span>
              </div>
            </div>
          )}
        </section>

        <footer className="paper-foot">
          {layout === 'packing' ? 'Checked by: ____________________     Packed by: ____________________' : 'Thank you for your business.'}
        </footer>
      </article>
    </>
  )
}
