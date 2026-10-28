import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock, Printer, RefreshCw, Send, Store, Truck, UserPlus, Users, X } from 'lucide-react'
import { getDeliveryBoard, listDeliveryStaff, listTrips, markPickedUp, cancelTrip } from '../../services/api'
import { DATE_PRESETS, durationText, formatDate, money, num, timeText, today } from '../../shared/lib/format'
import { EmptyState, ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'
import { DateRange } from '../../shared/components/Pickers'
import { useAuth } from '../../app/auth/AuthProvider'
import { LATE_TRIP_HOURS, cartonsText, dayEnd, dayStart, isLateTrip, isOldPending, tripCash } from './deliveryUtils'
import { CloseTripModal, StaffModal, StartTripModal } from './DeliveryModals'

const TABS = [
  { value: 'now', label: 'Now' },
  { value: 'history', label: 'History' },
]

export default function Delivery() {
  const { can } = useAuth()
  const canManage = can('delivery.manage')
  const [tab, setTab] = useState('now')
  const [staff, setStaff] = useState(null)
  const [showStaff, setShowStaff] = useState(false)
  const [error, setError] = useState('')

  const loadStaff = useCallback(() => listDeliveryStaff().then(setStaff).catch((e) => setError(e.message)), [])
  useEffect(() => {
    loadStaff()
  }, [loadStaff])

  return (
    <>
      <PageHeader
        title="Delivery"
        subtitle="Who took which bills, when they left and when they came back."
        actions={
          <>
            <div className="segmented">
              {TABS.map((t) => (
                <button key={t.value} className={tab === t.value ? 'active' : ''} onClick={() => setTab(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
            {canManage && (
              <button className="btn btn-secondary" onClick={() => setShowStaff(true)}>
                <Users size={16} /> Delivery staff
              </button>
            )}
          </>
        }
      />

      <ErrorBanner message={error} />

      {staff && staff.length === 0 && (
        <div className="alert alert-info">
          <UserPlus size={16} />
          <span>
            {canManage ? 'Add the people who take goods to customers first.' : 'No delivery staff yet. Ask a manager to add them.'}{' '}
            {canManage && (
              <button className="link-btn" onClick={() => setShowStaff(true)}>
                Add delivery staff
              </button>
            )}
          </span>
        </div>
      )}

      {tab === 'now' ? <NowTab staff={staff ?? []} canManage={canManage} /> : <HistoryTab staff={staff ?? []} />}

      {showStaff && <StaffModal staff={staff ?? []} onClose={() => setShowStaff(false)} onChanged={loadStaff} />}
    </>
  )
}

// ---------- Now: bills waiting, and trips that are out ----------

function NowTab({ staff, canManage }) {
  const navigate = useNavigate()
  const [board, setBoard] = useState(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [sending, setSending] = useState(false)
  const [closing, setClosing] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(
    () =>
      getDeliveryBoard()
        .then((b) => {
          setBoard(b)
          setNow(Date.now())
          // drop picks for bills that are no longer waiting
          setPicked((prev) => new Set([...prev].filter((id) => b.pending.some((p) => p.invoice_id === id))))
        })
        .catch((e) => setError(e.message)),
    [],
  )

  // Refresh every minute so "out for" times and new bills stay current
  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function pickedUp(bill) {
    if (!window.confirm(`Bill #${bill.invoice_no}: did ${bill.customer_name} take the goods from the shop? It will leave the delivery list.`)) return
    setError('')
    try {
      await markPickedUp(bill.invoice_id)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function cancel(trip) {
    if (!window.confirm(`Cancel trip ${trip.trip_no}? Only do this if the goods did not leave the shop. Its bills go back to waiting.`)) return
    setError('')
    try {
      await cancelTrip(trip.id)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  if (!board) return error ? <ErrorBanner message={error} /> : <Loading />

  const pickedBills = board.pending.filter((b) => picked.has(b.invoice_id))
  const showAmount = board.pending.some((b) => b.total !== null)
  const allPicked = board.pending.length > 0 && pickedBills.length === board.pending.length

  return (
    <div className="stack">
      <ErrorBanner message={error} />

      <div className="card card-flush">
        <div className="card-head">
          <div>
            <h3>Waiting for delivery</h3>
            <p className="text-secondary">Bills with delivery "Delivery" that have not gone out yet. Tick the ones going together.</p>
          </div>
          <div className="card-head-actions">
            <button className="icon-btn" onClick={load} title="Refresh" aria-label="Refresh">
              <RefreshCw size={16} />
            </button>
            <button className="btn btn-primary" disabled={!pickedBills.length || !staff.some((s) => s.active)} onClick={() => setSending(true)}>
              <Send size={16} /> Send {pickedBills.length ? `${pickedBills.length} bill${pickedBills.length === 1 ? '' : 's'}` : 'selected'}
            </button>
          </div>
        </div>

        {board.pending.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing waiting" text="Every delivery bill is out or delivered." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      className="row-check"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(board.pending.map((b) => b.invoice_id)))}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Bill</th>
                  <th>Customer</th>
                  <th className="hide-sm">Goods</th>
                  {showAmount && <th className="num hide-sm">Amount</th>}
                  <th>Waiting since</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {board.pending.map((b) => {
                  const old = isOldPending(b)
                  return (
                    <tr key={b.invoice_id} className={`row-link ${old ? 'row-warn' : ''}`} onClick={() => toggle(b.invoice_id)}>
                      <td className="col-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="row-check" checked={picked.has(b.invoice_id)} onChange={() => toggle(b.invoice_id)} aria-label={`Select bill ${b.invoice_no}`} />
                      </td>
                      <td className="strong nowrap">#{b.invoice_no}</td>
                      <td>
                        <div className="cell-stack">
                          <span className="strong">{b.customer_name}</span>
                          <span className="text-muted">{[b.customer_city, b.customer_phone].filter(Boolean).join(' · ') || '—'}</span>
                        </div>
                      </td>
                      <td className="text-secondary hide-sm nowrap">{cartonsText(b)}</td>
                      {showAmount && <td className="num hide-sm">{money(b.total)}</td>}
                      <td>
                        <div className="cell-stack">
                          <span className={old ? 'text-critical strong' : ''}>{old ? formatDate(b.invoice_date) : timeText(b.created_at)}</span>
                          {Number(b.came_back) > 0 && <span className="text-warning">Came back {b.came_back}×</span>}
                        </div>
                      </td>
                      {canManage && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions">
                            <button className="btn btn-ghost btn-sm" onClick={() => pickedUp(b)} title="Customer took it from the shop">
                              <Store size={15} /> Picked up
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-flush">
        <div className="card-head">
          <div>
            <h3>Out now</h3>
            <p className="text-secondary">
              Trips that have left. Over {LATE_TRIP_HOURS} hours shows in red.{canManage ? ' Close a trip when the staff member is back.' : ''}
            </p>
          </div>
        </div>

        {board.trips.length === 0 ? (
          <EmptyState icon={Truck} title="No one is out" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Trip</th>
                  <th>Taken by</th>
                  <th>Left at</th>
                  <th>Out for</th>
                  <th className="hide-sm">Bills</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {board.trips.map((t) => {
                  const late = isLateTrip(t, now)
                  return (
                    <tr key={t.id} className={`row-link ${late ? 'row-error' : ''}`} onClick={() => navigate(`/app/delivery/trips/${t.id}`)}>
                      <td className="strong nowrap">Trip {t.trip_no}</td>
                      <td>
                        <div className="cell-stack">
                          <span className="strong">{t.staff_name}</span>
                          <span className="text-muted">{[t.vehicle, t.staff_phone].filter(Boolean).join(' · ') || '—'}</span>
                        </div>
                      </td>
                      <td className="nowrap">{timeText(t.out_at)}</td>
                      <td className={`nowrap ${late ? 'text-critical strong' : ''}`}>
                        <Clock size={13} /> {durationText(now - new Date(t.out_at).getTime())}
                      </td>
                      <td className="hide-sm text-secondary">
                        {t.invoices.map((b) => `#${b.invoice_no}`).join(', ')}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <Link to={`/app/delivery/trips/${t.id}`} className="icon-btn" title="Delivery slip" aria-label="Delivery slip">
                            <Printer size={16} />
                          </Link>
                          {canManage && (
                            <>
                              <button className="icon-btn" onClick={() => cancel(t)} title="Cancel trip (made by mistake)" aria-label="Cancel trip">
                                <X size={16} />
                              </button>
                              <button className="btn btn-primary btn-sm" onClick={() => setClosing(t)}>
                                Back · close
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sending && (
        <StartTripModal
          bills={pickedBills}
          staff={staff}
          busyStaff={board.trips.map((t) => t.staff_id)}
          onClose={() => setSending(false)}
          onSaved={(id) => {
            setSending(false)
            navigate(`/app/delivery/trips/${id}?print=1`)
          }}
        />
      )}
      {closing && (
        <CloseTripModal
          trip={closing}
          onClose={() => setClosing(null)}
          onSaved={() => {
            setClosing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

// ---------- History: closed and open trips in a date range, per staff member ----------

function HistoryTab({ staff }) {
  const navigate = useNavigate()
  const [range, setRange] = useState(() => DATE_PRESETS[0].range())
  const [staffId, setStaffId] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setRows(null)
    listTrips({ from: dayStart(range.from), to: dayEnd(range.to) })
      .then(setRows)
      .catch((e) => setError(e.message))
  }, [range.from, range.to])

  const trips = useMemo(() => (rows ?? []).filter((t) => !staffId || t.staff_id === staffId), [rows, staffId])

  // One line per staff member
  const perStaff = useMemo(() => {
    const out = {}
    for (const t of trips) {
      const s = (out[t.staff_id] ??= { name: t.staff_name, trips: 0, delivered: 0, cameBack: 0, cash: 0, minutes: 0, closed: 0 })
      s.trips++
      s.delivered += t.invoices.filter((b) => b.status === 'delivered').length
      s.cameBack += t.invoices.filter((b) => b.status === 'returned').length
      s.cash += tripCash(t)
      if (t.back_at) {
        s.closed++
        s.minutes += (new Date(t.back_at) - new Date(t.out_at)) / 60000
      }
    }
    return Object.values(out).sort((a, b) => b.trips - a.trips)
  }, [trips])

  return (
    <div className="stack">
      <ErrorBanner message={error} />
      <div className="card card-flush">
        <div className="toolbar">
          <div className="segmented">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                className={JSON.stringify(p.range()) === JSON.stringify(range) ? 'active' : ''}
                onClick={() => setRange(p.range())}
              >
                {p.label}
              </button>
            ))}
            <button className={range.from === today() && range.to === today() ? 'active' : ''} onClick={() => setRange({ from: today(), to: today() })}>
              Today
            </button>
          </div>
          <DateRange from={range.from} to={range.to} onChange={setRange} />
          <select className="input toolbar-select" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff member">
            <option value="">All staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {rows && <span className="text-secondary toolbar-count">{num(trips.length)} trips</span>}
        </div>

        {!rows && !error && <Loading />}
        {rows && trips.length === 0 && <EmptyState icon={Truck} title="No trips in this period" />}

        {perStaff.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th className="num">Trips</th>
                  <th className="num">Delivered</th>
                  <th className="num">Came back</th>
                  <th className="num hide-sm">Average trip</th>
                  <th className="num">Cash collected</th>
                </tr>
              </thead>
              <tbody>
                {perStaff.map((s) => (
                  <tr key={s.name}>
                    <td className="strong">{s.name}</td>
                    <td className="num">{num(s.trips)}</td>
                    <td className="num">{num(s.delivered)}</td>
                    <td className={`num ${s.cameBack ? 'text-warning' : ''}`}>{num(s.cameBack)}</td>
                    <td className="num hide-sm">{s.closed ? durationText((s.minutes / s.closed) * 60000) : '—'}</td>
                    <td className="num">{money(s.cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {trips.length > 0 && (
        <div className="card card-flush">
          <div className="card-head">
            <div>
              <h3>Trips</h3>
              <p className="text-secondary">Newest first. Open one to see its bills or print the slip again.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Trip</th>
                  <th>Taken by</th>
                  <th>Left</th>
                  <th>Back</th>
                  <th className="hide-sm">Bills</th>
                  <th className="num">Cash</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => {
                  const back = t.invoices.filter((b) => b.status === 'returned').length
                  return (
                    <tr key={t.id} className="row-link" onClick={() => navigate(`/app/delivery/trips/${t.id}`)}>
                      <td className="strong nowrap">Trip {t.trip_no}</td>
                      <td>{t.staff_name}</td>
                      <td className="nowrap">{timeText(t.out_at)}</td>
                      <td className="nowrap">
                        {t.back_at ? (
                          <div className="cell-stack">
                            <span>{timeText(t.back_at)}</span>
                            <span className="text-muted">{durationText(new Date(t.back_at) - new Date(t.out_at))}</span>
                          </div>
                        ) : (
                          <span className="status status-info">
                            <Truck size={13} /> Still out
                          </span>
                        )}
                      </td>
                      <td className="hide-sm text-secondary">
                        {t.invoices.length} bill{t.invoices.length === 1 ? '' : 's'}
                        {back > 0 && <span className="text-warning"> · {back} came back</span>}
                      </td>
                      <td className="num">{tripCash(t) ? money(tripCash(t)) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
