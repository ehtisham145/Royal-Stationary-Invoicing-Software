import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  HandCoins,
  Package,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  Plus,
  ReceiptText,
  Ship,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { getDashboard, getDeliveryBoard, optional } from '../../services/api'
import { LATE_TRIP_HOURS, boardSummary } from '../delivery/deliveryUtils'
import { compactMoney, formatDate, money, num, qtyText } from '../../shared/lib/format'
import { EmptyState, ErrorBanner, Loading, PageHeader, TxnBadge } from '../../shared/components/ui'
import { useAuth } from '../../app/auth/AuthProvider'

const SERIES = '#213a73' // brand royal ink (--chart), well above 3:1 on the card surface

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const firstName = (user) => (user?.name || user?.email?.split('@')[0] || '').split(' ')[0]

function useDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    getDashboard().then(setData).catch((e) => setError(e.message))
  }, [])
  return { data, error }
}

// "2026-10" -> labels for the chart axis and tooltip
const withLabels = (months) =>
  months.map((m) => {
    const d = new Date(`${m.key}-01T00:00`)
    return {
      ...m,
      total: Number(m.total),
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      full: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    }
  })

// Admin and manager: whole business. Cashier: own sales. Store keeper: stock only.
export default function Dashboard() {
  const { can } = useAuth()
  if (can('reports')) return <AdminDashboard />
  if (can('sales')) return <CashierDashboard />
  return <StoreDashboard />
}

function HeaderActions() {
  return (
    <>
      <Link to="/app/receipts?new=1" className="btn btn-secondary">
        <HandCoins size={16} /> Receive payment
      </Link>
      <Link to="/app/invoices/new" className="btn btn-primary">
        <Plus size={16} /> New sale
      </Link>
    </>
  )
}

function AdminDashboard() {
  const { user } = useAuth()
  const { data, error } = useDashboard()
  const months = useMemo(() => (data ? withLabels(data.months) : []), [data])
  const name = firstName(user)

  const change =
    data && Number(data.last_month_to_date) > 0
      ? ((Number(data.month_sales) - Number(data.last_month_to_date)) / Number(data.last_month_to_date)) * 100
      : null

  return (
    <>
      <PageHeader title={`${greeting()}${name ? `, ${name}` : ''}`} subtitle="Here's how Royal Stationers is doing." actions={<HeaderActions />} />

      <ErrorBanner message={error} />
      {!data && !error && <Loading />}

      {data && (
        <div className="dash">
          <div className="kpi-grid">
            <Kpi
              icon={ReceiptText}
              label="Sales today"
              value={money(data.today_sales)}
              foot={<span className="text-muted">{data.today_count} invoice{data.today_count === 1 ? '' : 's'}</span>}
            />
            <Kpi
              icon={CalendarDays}
              label="Sales this month"
              value={money(data.month_sales)}
              foot={
                change === null ? (
                  <span className="text-muted">No sales last month to compare</span>
                ) : (
                  <span className={`delta ${change >= 0 ? 'up' : 'down'}`}>
                    {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {Math.abs(change).toFixed(1)}% <span className="text-muted">vs same days last month</span>
                  </span>
                )
              }
            />
            <Kpi
              icon={HandCoins}
              label="Received today"
              value={money(data.received_today)}
              foot={<span className="text-muted">Cash, bank and cheques</span>}
            />
            <Kpi
              icon={Wallet}
              label="Receivable"
              value={money(data.receivable)}
              foot={<span className="text-muted">{data.receivable_count} customer{data.receivable_count === 1 ? '' : 's'} owe money</span>}
            />
          </div>

          <StockAlerts data={data} />

          <div className="dash-row">
            <SalesChart months={months} />
            <RankCard title="Top products" subtitle="Last 30 days, by amount" rows={data.top_products} empty="No sales in the last 30 days" />
          </div>

          <div className="dash-row">
            <RecentInvoices rows={data.recent} showBy />
            <div className="dash-stack">
              <RankCard
                title="Highest balances"
                subtitle="Customers who owe the most"
                rows={data.top_receivables.map((r) => ({ name: r.city ? `${r.name} (${r.city})` : r.name, total: r.balance, to: `/app/customers/${r.id}` }))}
                empty="No customer owes money"
              />
              <RankCard title="Top customers" subtitle="Last 30 days, by amount" rows={data.top_customers} empty="No sales in the last 30 days" />
            </div>
          </div>

          <div className="dash-row">
            <LowStock rows={data.low_stock} count={data.low_stock_count} />
            <StoreSummary rows={data.locations} />
          </div>
        </div>
      )}
    </>
  )
}

// Bills waiting for delivery and trips that are out (roles with 'delivery'; quiet if upgrade 008 is missing)
function useDeliverySummary() {
  const { can } = useAuth()
  const allowed = can('delivery')
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    if (allowed) optional(getDeliveryBoard(), null).then((b) => b?.pending && setSummary(boardSummary(b)))
  }, [allowed])
  return summary
}

function DeliveryAlerts() {
  const d = useDeliverySummary()
  if (!d || (d.pending <= 0 && d.out <= 0)) return null
  return (
    <>
      {d.pending > 0 && (
        <Link to="/app/delivery" className={`dash-alert ${d.oldPending ? 'critical' : 'warn'}`}>
          <Truck size={17} />
          <span>
            <b>{num(d.pending)}</b> bill{d.pending === 1 ? '' : 's'} waiting for delivery
            {d.oldPending > 0 && ` · ${num(d.oldPending)} from earlier days`}
          </span>
        </Link>
      )}
      {d.out > 0 && (
        <Link to="/app/delivery" className={`dash-alert ${d.late ? 'critical' : 'info'}`}>
          <Truck size={17} />
          <span>
            <b>{num(d.out)}</b> delivery trip{d.out === 1 ? '' : 's'} out
            {d.late > 0 && ` · ${num(d.late)} over ${LATE_TRIP_HOURS} hours`}
          </span>
        </Link>
      )}
    </>
  )
}

function StockAlerts({ data }) {
  const way = data.containers?.on_the_way ?? 0
  return (
    <div className="alert-row">
      <DeliveryAlerts />
      {way > 0 && (
        <Link to="/app/containers" className="dash-alert info">
          <Ship size={17} />
          <span>
            <b>{num(way)}</b> container{way === 1 ? ' is' : 's are'} on the way
            {data.containers.next_eta && ` · next arrival ${formatDate(data.containers.next_eta)}`}
          </span>
        </Link>
      )}
      {data.low_stock_count > 0 && (
        <Link to="/app/stock?show=low" className="dash-alert warn">
          <PackageSearch size={18} />
          <span>
            <b>{num(data.low_stock_count)}</b> product{data.low_stock_count === 1 ? ' is' : 's are'} at or below reorder level
          </span>
        </Link>
      )}
      {data.negative_count > 0 && (
        <Link to="/app/stock?show=negative" className="dash-alert critical">
          <AlertTriangle size={18} />
          <span>
            <b>{num(data.negative_count)}</b> stock balance{data.negative_count === 1 ? ' is' : 's are'} below zero. Check the stores.
          </span>
        </Link>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, foot }) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">
          <Icon size={18} strokeWidth={1.9} />
        </span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </div>
  )
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const m = payload[0].payload
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{m.full}</div>
      <div className="chart-tip-row">
        <span className="swatch" style={{ background: SERIES }} />
        <span className="strong">{money(m.total)}</span>
      </div>
      <div className="text-muted">
        {m.count} invoice{m.count === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function SalesChart({ months }) {
  const [view, setView] = useState('chart')
  const yearTotal = months.reduce((s, m) => s + m.total, 0)

  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h3>Sales, last 12 months</h3>
          <p className="text-secondary">{money(yearTotal)} net of returns</p>
        </div>
        <div className="segmented" role="tablist">
          <button className={view === 'chart' ? 'active' : ''} onClick={() => setView('chart')}>
            Chart
          </button>
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </div>

      {view === 'chart' ? (
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
              <YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false} width={64} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(33, 58, 115, 0.06)' }} />
              <Bar dataKey="total" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-box chart-table">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Invoices</th>
                <th className="num">Sales</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.key}>
                  <td>{m.full}</td>
                  <td className="num">{m.count}</td>
                  <td className="num">{money(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RankCard({ title, subtitle, rows, empty }) {
  const max = Math.max(...rows.map((r) => Number(r.total)), 1)
  return (
    <div className="card">
      <div className="card-head card-head-tight">
        <div>
          <h3>{title}</h3>
          <p className="text-secondary">{subtitle}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted rank-empty">{empty}</p>
      ) : (
        <ul className="rank">
          {rows.map((r) => {
            const line = (
              <>
                <div className="rank-line">
                  <span className="rank-name" title={r.name}>
                    {r.name}
                  </span>
                  <span className="rank-value">{money(r.total)}</span>
                </div>
                <div className="rank-track">
                  <div className="rank-fill" style={{ width: `${Math.max(0, (Number(r.total) / max) * 100)}%`, background: SERIES }} />
                </div>
              </>
            )
            return <li key={r.name}>{r.to ? <Link to={r.to} className="rank-link">{line}</Link> : line}</li>
          })}
        </ul>
      )}
    </div>
  )
}

function RecentInvoices({ rows, showBy, title = 'Recent invoices', subtitle = 'Latest sales and returns' }) {
  const navigate = useNavigate()
  return (
    <div className="card card-flush">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          <p className="text-secondary">{subtitle}</p>
        </div>
        <Link to="/app/invoices" className="btn btn-ghost btn-sm">
          View all
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No invoices yet"
          text="Your latest invoices will appear here."
          action={
            <Link to="/app/invoices/new" className="btn btn-primary btn-sm">
              <Plus size={16} /> New sale
            </Link>
          }
        />
      ) : (
        <div className="table-scroll">
        <table className="table table-compact recent-table">
          <thead>
            <tr>
              <th>Inv #</th>
              <th>Customer</th>
              <th className="hide-sm">Date</th>
              {showBy && <th className="hide-sm">By</th>}
              <th>Type</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.id} className="row-link" onClick={() => navigate(`/app/invoices/${inv.id}`)}>
                <td className="strong">{inv.invoice_no}</td>
                <td>
                  <div className="cell-stack">
                    <span>{inv.customer_name}</span>
                    <span className="text-muted">
                      {inv.customer_city}
                      <span className="show-sm">
                        {inv.customer_city && ' · '}
                        {formatDate(inv.invoice_date)}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="text-secondary nowrap hide-sm">{formatDate(inv.invoice_date)}</td>
                {showBy && <td className="text-secondary hide-sm">{inv.created_by_name ?? '—'}</td>}
                <td className="nowrap">
                  <TxnBadge type={inv.txn_type} mode={inv.payment_mode} />
                </td>
                <td className="num strong nowrap">{money(inv.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

function LowStock({ rows, count }) {
  const navigate = useNavigate()
  return (
    <div className="card card-flush">
      <div className="card-head">
        <div>
          <h3>Low stock</h3>
          <p className="text-secondary">At or below reorder level · most short first</p>
        </div>
        {count > rows.length && (
          <Link to="/app/stock?show=low" className="btn btn-ghost btn-sm">
            All {num(count)}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="Nothing is running low" text="Set a reorder level on products to get alerts here." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">In stock</th>
              <th className="num">Reorder at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="row-link" onClick={() => navigate(`/app/products/${p.id}/ledger`)}>
                <td>
                  <div className="cell-stack">
                    <span className="strong">{p.name}</span>
                    <span className="text-muted">{p.code}</span>
                  </div>
                </td>
                <td className={`num strong ${Number(p.qty) <= 0 ? 'text-critical' : ''}`}>{qtyText(p.qty, p.unit, p.carton_qty)}</td>
                <td className="num text-secondary">{qtyText(p.reorder_level, p.unit, p.carton_qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function StoreSummary({ rows }) {
  return (
    <div className="card">
      <div className="card-head card-head-tight">
        <div>
          <h3>Stores</h3>
          <p className="text-secondary">Products in stock at each location</p>
        </div>
        <Link to="/app/stock" className="btn btn-ghost btn-sm">
          Open stock
        </Link>
      </div>
      <ul className="store-list">
        {rows.map((l) => (
          <li key={l.id}>
            <Link to={`/app/stock?location=${l.id}`}>
              <span className="strong">{l.name}</span>
              <span className="store-meta">
                <span>{num(l.items)} items</span>
                {l.negative > 0 && <span className="status status-critical">{l.negative} below zero</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Cashier: own numbers + shortcuts ----------

function CashierDashboard() {
  const { user } = useAuth()
  const { data, error } = useDashboard()

  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName(user)}`} subtitle="Your sales at a glance." actions={<HeaderActions />} />

      <ErrorBanner message={error} />
      {!data && !error && <Loading />}

      {data && (
        <div className="dash">
          <div className="kpi-grid">
            <Kpi
              icon={ReceiptText}
              label="My sales today"
              value={money(data.mine.today)}
              foot={<span className="text-muted">{data.mine.today_count} invoice{data.mine.today_count === 1 ? '' : 's'} today</span>}
            />
            <Kpi
              icon={CalendarDays}
              label="My sales this month"
              value={money(data.mine.month)}
              foot={<span className="text-muted">{data.mine.month_count} invoice{data.mine.month_count === 1 ? '' : 's'}</span>}
            />
            <Kpi icon={HandCoins} label="Received today" value={money(data.received_today)} foot={<span className="text-muted">All counters</span>} />
            <Kpi icon={Users} label="Customers" value={num(data.counts.customers)} foot={<span className="text-muted">{num(data.counts.products)} products</span>} />
          </div>

          <div className="dash-row">
            <RecentInvoices rows={data.mine.recent} title="My recent invoices" subtitle="Invoices you created" />
            <div className="card">
              <div className="card-head card-head-tight">
                <div>
                  <h3>Quick actions</h3>
                  <p className="text-secondary">Start something new</p>
                </div>
              </div>
              <div className="quick-actions">
                <QuickAction to="/app/invoices/new" icon={ReceiptText} title="New sale" text="Bill a customer" />
                <QuickAction to="/app/receipts?new=1" icon={HandCoins} title="Receive payment" text="Cash, bank or cheque" />
                <QuickAction to="/app/stock" icon={Boxes} title="Check stock" text="See stock in every store" />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------- Store keeper: stock only, no money ----------

function StoreDashboard() {
  const { user } = useAuth()
  const { data, error } = useDashboard()

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user)}`}
        subtitle="Stock across your stores."
        actions={
          <Link to="/app/stock/new?kind=in" className="btn btn-primary">
            <PackagePlus size={16} /> Stock in
          </Link>
        }
      />

      <ErrorBanner message={error} />
      {!data && !error && <Loading />}

      {data && (
        <div className="dash">
          <div className="kpi-grid">
            <Kpi icon={Package} label="Products" value={num(data.counts.products)} foot={<span className="text-muted">Active items</span>} />
            <Kpi
              icon={PackageSearch}
              label="Low stock"
              value={num(data.low_stock_count)}
              foot={<span className="text-muted">At or below reorder level</span>}
            />
            <Kpi
              icon={AlertTriangle}
              label="Below zero"
              value={num(data.negative_count)}
              foot={<span className="text-muted">Store balances to check</span>}
            />
            <Kpi icon={Boxes} label="Stores" value={num(data.locations.length)} foot={<span className="text-muted">Active locations</span>} />
          </div>

          <StockAlerts data={data} />

          <div className="dash-row">
            <LowStock rows={data.low_stock} count={data.low_stock_count} />
            <div className="dash-stack">
              <div className="card">
                <div className="card-head card-head-tight">
                  <div>
                    <h3>Quick actions</h3>
                    <p className="text-secondary">Record a stock movement</p>
                  </div>
                </div>
                <div className="quick-actions">
                  <QuickAction to="/app/stock/new?kind=in" icon={PackagePlus} title="Stock in" text="Goods received into a store" />
                  <QuickAction to="/app/stock/new?kind=out" icon={PackageMinus} title="Stock out" text="Goods taken out of a store" />
                  <QuickAction to="/app/stock/new?kind=transfer" icon={ArrowLeftRight} title="Transfer" text="Move goods between stores" />
                  <QuickAction to="/app/delivery" icon={Truck} title="Delivery" text="Send bills out with our staff" />
                </div>
              </div>
              <StoreSummary rows={data.locations} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function QuickAction({ to, icon: Icon, title, text }) {
  return (
    <Link to={to} className="quick-action">
      <span className="kpi-icon">
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="cell-stack">
        <span className="strong">{title}</span>
        <span className="text-muted">{text}</span>
      </span>
    </Link>
  )
}
