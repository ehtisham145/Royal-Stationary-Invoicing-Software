import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight,
  Boxes,
  Factory,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldCheck,
  Ship,
  Truck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../../app/auth/AuthProvider'
import { ROLE_LABELS, initials } from '../lib/format'
import { Logo } from './Logo'

const NAV = [
  { section: 'Overview', links: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    section: 'Sales',
    links: [
      { to: '/app/invoices', label: 'Sale invoices', icon: ReceiptText, permission: 'sales' },
      { to: '/app/receipts', label: 'Receipts', icon: HandCoins, permission: 'sales' },
      { to: '/app/customers', label: 'Customers', icon: Users, permission: 'sales' },
    ],
  },
  {
    section: 'Stock',
    links: [
      { to: '/app/products', label: 'Products', icon: Package },
      { to: '/app/stock', label: 'Stock', icon: Boxes, end: true },
      { to: '/app/stock/entries', label: 'Stock entries', icon: ArrowLeftRight, permission: 'stock.manage' },
      { to: '/app/delivery', label: 'Delivery', icon: Truck, permission: 'delivery' },
    ],
  },
  {
    section: 'Purchase',
    links: [
      { to: '/app/containers', label: 'Containers', icon: Ship, permission: 'containers.view' },
      { to: '/app/suppliers', label: 'Suppliers', icon: Factory, permission: 'containers.manage' },
    ],
  },
  {
    section: 'Administration',
    links: [
      { to: '/app/users', label: 'Users', icon: ShieldCheck, permission: 'users' },
      { to: '/app/settings', label: 'Settings', icon: SettingsIcon, permission: 'settings' },
    ],
  },
]

export default function Layout() {
  const { user, can, signOut } = useAuth()
  const nav = NAV.map((g) => ({ ...g, links: g.links.filter((l) => !l.permission || can(l.permission)) })).filter((g) => g.links.length)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer after navigating
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="shell">
      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Logo light size={38} />
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map((group) => (
            <div key={group.section} className="nav-group">
              <div className="nav-section">{group.section}</div>
              {group.links.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="nav-link">
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-user">
          <NavLink to="/app/profile" className="sidebar-profile" title="My profile">
            <div className="avatar">{initials(user?.name || user?.email)}</div>
            <div className="user-meta">
              <div className="user-email" title={user?.email}>
                {user?.name || user?.email}
              </div>
              <div className="user-role">{ROLE_LABELS[user?.role] ?? user?.role}</div>
            </div>
          </NavLink>
          <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {open && <div className="scrim no-print" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-date">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <span className={`role-pill role-${user?.role}`}>{ROLE_LABELS[user?.role]}</span>
          <UserMenu user={user} signOut={signOut} />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// Avatar in the top bar: opens a small menu with the profile link and sign out
function UserMenu({ user, signOut }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const close = (e) => (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="avatar avatar-sm avatar-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={user?.name || user?.email}
      >
        {initials(user?.name || user?.email)}
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head">
            <span className="strong">{user?.name}</span>
            <span className="text-muted">{user?.email}</span>
          </div>
          <Link to="/app/profile" className="user-menu-item" role="menuitem">
            <UserRound size={16} /> My profile
          </Link>
          <button type="button" className="user-menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
