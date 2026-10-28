import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogIn, Menu, X } from 'lucide-react'
import { Logo } from '../shared/components/Logo'
import { CATEGORIES, SHOP, waLink } from './siteInfo'
import { WhatsAppIcon } from './pieces'
import { useScrollReveal } from './useScrollReveal'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/products', label: 'Products' },
  { to: '/wholesale', label: 'Wholesale' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
]

const navClass = ({ isActive }) => `site-nav-link ${isActive ? 'active' : ''}`

export default function SiteLayout() {
  const [open, setOpen] = useState(false)
  const { pathname, hash } = useLocation()
  useScrollReveal()

  // New page: close the mobile menu and start at the top, or at the #section the link points to
  useEffect(() => {
    setOpen(false)
    const target = hash && document.getElementById(hash.slice(1))
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else window.scrollTo(0, 0)
  }, [pathname, hash])

  return (
    <div className="site">
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="site-wrap flex h-[68px] items-center gap-6">
          <Link to="/" aria-label="Royal Stationers home" className="shrink-0">
            <Logo size={36} />
          </Link>
          <nav className="ml-4 hidden items-center gap-7 lg:flex" aria-label="Main">
            {NAV.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/login" className="site-btn site-btn-sm site-btn-outline hidden sm:inline-flex">
              <LogIn />
              Staff login
            </Link>
            <button
              className="inline-grid h-10 w-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 lg:hidden"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-line bg-surface lg:hidden" aria-label="Mobile">
            <div className="site-wrap flex flex-col py-3">
              {NAV.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={(s) => `${navClass(s)} py-2.5`}>
                  {l.label}
                </NavLink>
              ))}
              <Link to="/login" className="site-nav-link py-2.5">
                Staff login
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="border-t border-white/10 bg-night text-night-text">
        <div className="site-wrap grid gap-10 pt-12 pb-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
          <div>
            <Logo size={36} light />
            <p className="mt-4 max-w-[22rem] text-[14px]">
              Wholesale office and school stationery from Urdu Bazar, Lahore, for shops, schools and offices across Pakistan.
            </p>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-night-strong">Pages</div>
            <ul className="mt-3 grid gap-2 text-[14px]">
              {NAV.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-night-strong">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-night-strong">Categories</div>
            <ul className="mt-3 grid gap-2 text-[14px]">
              {CATEGORIES.slice(0, 5).map((c) => (
                <li key={c.name}>
                  <Link to="/products" className="hover:text-night-strong">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-night-strong">Contact</div>
            <ul className="mt-3 grid gap-2 text-[14px]">
              <li>{SHOP.addressShort}</li>
              <li>
                <a href={`tel:+${SHOP.phoneIntl}`} className="hover:text-night-strong">
                  {SHOP.phone}
                </a>
              </li>
              <li className="break-all">
                <a href={`mailto:${SHOP.email}`} className="hover:text-night-strong">
                  {SHOP.email}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="site-wrap flex flex-col gap-2 border-t border-white/10 py-5 text-[13px] sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Royal Stationers. All rights reserved.</span>
          <Link to="/login" className="hover:text-night-strong">
            Staff login
          </Link>
        </div>
      </footer>

      <a
        href={waLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="wa-fab inline-flex h-14 w-14 items-center justify-center gap-2 rounded-full bg-wa text-white sm:w-auto sm:pr-5 sm:pl-4 shadow-[var(--shadow-lg)] transition-colors hover:bg-wa-hover"
        aria-label="Chat with Royal Stationers on WhatsApp"
      >
        <WhatsAppIcon className="h-6 w-6" />
        <span className="hidden text-[15px] font-medium sm:inline">Chat with us</span>
      </a>
    </div>
  )
}
