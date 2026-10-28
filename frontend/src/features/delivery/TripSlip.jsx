import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer, Truck } from 'lucide-react'
import { getDefaultCompany, getTrip } from '../../services/api'
import { TRIP_LINE_LABELS, durationText, money, num, timeText } from '../../shared/lib/format'
import { ErrorBanner, Loading } from '../../shared/components/ui'
import { Crown } from '../../shared/components/Logo'
import { useAuth } from '../../app/auth/AuthProvider'
import { CloseTripModal } from './DeliveryModals'
import { tripCash } from './deliveryUtils'

// One trip: the slip the staff member takes along (customers sign for the goods), and later what happened
export default function TripSlip() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { can } = useAuth()
  const [trip, setTrip] = useState(null)
  const [company, setCompany] = useState(null)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)

  const load = useCallback(() => getTrip(id).then(setTrip).catch((e) => setError(e.message)), [id])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    getDefaultCompany().then(setCompany).catch(() => {})
  }, [])

  // Just sent: open the print dialog once
  useEffect(() => {
    if (trip && company && params.get('print')) {
      setParams({}, { replace: true })
      setTimeout(() => window.print(), 300)
    }
  }, [trip, company, params, setParams])

  if (!trip) return error ? <ErrorBanner message={error} /> : <Loading />

  const open = trip.status === 'out'
  const showAmount = trip.invoices.some((b) => b.total !== null)
  const cartons = trip.invoices.reduce((s, b) => s + Number(b.cartons), 0)
  const cash = tripCash(trip)

  return (
    <>
      <div className="page-header no-print">
        <div>
          <Link to="/app/delivery" className="back-link">
            <ArrowLeft size={16} /> Delivery
          </Link>
          <div className="title-row">
            <h1>Trip {trip.trip_no}</h1>
            {open ? (
              <span className="status status-info">
                <Truck size={13} /> Out
              </span>
            ) : (
              <span className="status status-good">Back</span>
            )}
          </div>
          <p className="text-secondary created-by">
            {trip.staff_name} left at {timeText(trip.out_at)}
            {trip.created_by_name && ` (sent by ${trip.created_by_name})`}
            {trip.back_at && ` · back at ${timeText(trip.back_at)} after ${durationText(new Date(trip.back_at) - new Date(trip.out_at))}`}
            {trip.closed_by_name && ` (closed by ${trip.closed_by_name})`}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print slip
          </button>
          {open && can('delivery.manage') && (
            <button className="btn btn-primary" onClick={() => setClosing(true)}>
              Back · close trip
            </button>
          )}
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
              <h2>{company?.name ?? ''}</h2>
            </div>
            {company?.address && <div className="text-secondary">{company.address}</div>}
            <div className="text-secondary">{[company?.phone, company?.email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="paper-title">
            <div className="paper-kind">Delivery slip</div>
            <div className="paper-no">Trip {trip.trip_no}</div>
          </div>
        </header>

        <section className="paper-meta">
          <div>
            <div className="meta-label">Taken by</div>
            <div className="strong">{trip.staff_name}</div>
            {trip.staff_phone && <div className="text-secondary">{trip.staff_phone}</div>}
            {trip.vehicle && <div className="text-secondary">Vehicle {trip.vehicle}</div>}
          </div>
          <dl className="meta-list">
            <div>
              <dt>Left at</dt>
              <dd>{timeText(trip.out_at)}</dd>
            </div>
            <div>
              <dt>Back at</dt>
              <dd>{trip.back_at ? timeText(trip.back_at) : '__________'}</dd>
            </div>
            <div>
              <dt>Bills</dt>
              <dd>
                {trip.invoices.length}
                {cartons > 0 && ` · ${num(cartons)} ctn`}
              </dd>
            </div>
          </dl>
        </section>

        <table className="table paper-table slip-table">
          <thead>
            <tr>
              <th className="col-idx">#</th>
              <th>Bill</th>
              <th>Customer</th>
              <th className="num">Goods</th>
              {showAmount && <th className="num">Amount</th>}
              <th className="num">{open ? 'Cash received' : 'Cash'}</th>
              <th>{open ? 'Customer sign' : 'Result'}</th>
            </tr>
          </thead>
          <tbody>
            {trip.invoices.map((b, idx) => (
              <tr key={b.invoice_id}>
                <td className="col-idx text-muted">{idx + 1}</td>
                <td className="strong nowrap">
                  {can('sales') ? (
                    <Link to={`/app/invoices/${b.invoice_id}`} className="link">
                      #{b.invoice_no}
                    </Link>
                  ) : (
                    `#${b.invoice_no}`
                  )}
                </td>
                <td>
                  <div className="cell-stack">
                    <span className="strong">{b.customer_name}</span>
                    <span className="text-muted">{[b.customer_address, b.customer_city, b.customer_phone].filter(Boolean).join(' · ')}</span>
                  </div>
                </td>
                <td className="num nowrap">
                  {Number(b.cartons) > 0 ? `${num(b.cartons)} ctn` : '—'}
                  <div className="text-muted">
                    {b.items} item{Number(b.items) === 1 ? '' : 's'}
                  </div>
                </td>
                {showAmount && <td className="num">{money(b.total)}</td>}
                <td className="num">{open ? '' : Number(b.cash) ? money(b.cash) : '—'}</td>
                <td className={open ? 'slip-sign' : b.status === 'returned' ? 'text-warning strong' : 'text-good strong'}>
                  {open ? '' : TRIP_LINE_LABELS[b.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="paper-bottom">
          <div className="paper-notes">
            {trip.notes && (
              <>
                <div className="meta-label">Note</div>
                <p>{trip.notes}</p>
              </>
            )}
          </div>
          {!open && (
            <div className="paper-totals">
              <div className="sum-row sum-total">
                <span>Cash collected</span>
                <span>{money(cash)}</span>
              </div>
            </div>
          )}
        </section>

        <footer className="paper-foot">Sent by: ____________________     Received back by: ____________________</footer>
      </article>

      {closing && (
        <CloseTripModal
          trip={trip}
          onClose={() => setClosing(false)}
          onSaved={() => {
            setClosing(false)
            load()
          }}
        />
      )}
    </>
  )
}
