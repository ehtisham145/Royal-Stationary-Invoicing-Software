import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeftRight, ChevronDown, ChevronRight, PackageMinus, PackagePlus, Trash2 } from 'lucide-react'
import { deleteStockEntry, listStockEntries } from '../../services/api'
import { ENTRY_LABELS, formatDate, monthStart, qtyText, today } from '../../shared/lib/format'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'
import { DateRange } from '../../shared/components/Pickers'
import { useAuth } from '../../app/auth/AuthProvider'

const KIND_CLS = { opening: 'status-neutral', in: 'status-good', out: 'status-warning', transfer: 'status-info' }

// For a transfer only the "from" side is listed, so each product appears once
const entryItems = (e) => e.stock_moves.filter((m) => e.kind !== 'transfer' || Number(m.qty) < 0)

export default function StockEntries() {
  const { can } = useAuth()
  const canDelete = can('delete')
  const location = useLocation()
  const [range, setRange] = useState({ from: monthStart(), to: today() })
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice] = useState(location.state?.notice ?? '')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    setRows(null)
    listStockEntries(range).then(setRows).catch((e) => setError(e.message))
  }, [range])

  async function remove(entry) {
    if (!window.confirm(`Delete ${ENTRY_LABELS[entry.kind].toLowerCase()} #${entry.entry_no}? Its stock changes will be reversed.`)) return
    setError('')
    try {
      await deleteStockEntry(entry.id)
      setRows((prev) => prev.filter((r) => r.id !== entry.id))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      <PageHeader
        title="Stock entries"
        subtitle="Opening stock, stock in, stock out and transfers."
        actions={
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
        }
      />

      <ErrorBanner message={error} />
      {notice && <div className="notice">{notice}</div>}

      <div className="card card-flush">
        <div className="toolbar">
          <DateRange {...range} onChange={setRange} />
          {rows && <span className="text-secondary toolbar-count">{rows.length} entries</span>}
        </div>

        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && <EmptyState icon={ArrowLeftRight} title="No stock entries in these dates" text="Change the dates, or post a stock in." />}

        {rows && rows.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Entry #</th>
                <th>Date</th>
                <th>Type</th>
                <th>Store</th>
                <th className="hide-sm cell-fill">Note</th>
                <th className="hide-sm">By</th>
                <th className="num hide-sm">Products</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const items = entryItems(e)
                const isOpen = open === e.id
                return (
                  <Fragment key={e.id}>
                    <tr className="row-link" onClick={() => setOpen(isOpen ? null : e.id)}>
                      <td className="text-muted">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                      <td className="strong">{e.entry_no}</td>
                      <td className="text-secondary nowrap">{formatDate(e.entry_date)}</td>
                      <td>
                        <span className={`status ${KIND_CLS[e.kind]}`}>{ENTRY_LABELS[e.kind]}</span>
                      </td>
                      <td>
                        <div className="store-cell">
                          <span>{e.location?.name}</span>
                          {e.to_location && <span className="text-secondary">→ {e.to_location.name}</span>}
                        </div>
                      </td>
                      <td className="text-secondary hide-sm cell-fill">
                        <span className="cell-truncate" title={e.note || undefined}>
                          {e.note || '—'}
                        </span>
                      </td>
                      <td className="text-secondary hide-sm">{e.creator?.name ?? '—'}</td>
                      <td className="num hide-sm">{items.length}</td>
                      <td className="row-actions" onClick={(ev) => ev.stopPropagation()}>
                        {canDelete && (
                          <button className="icon-btn danger" title="Delete entry" aria-label="Delete entry" onClick={() => remove(e)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="row-detail">
                        <td />
                        <td colSpan={8}>
                          <table className="table table-compact">
                            <tbody>
                              {items.map((m, i) => (
                                <tr key={i}>
                                  <td>{m.products.name}</td>
                                  <td className="num strong">{qtyText(Math.abs(m.qty), m.products.unit, m.products.carton_qty)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
