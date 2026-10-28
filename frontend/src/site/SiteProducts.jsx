import { useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Boxes, Briefcase, Check, GraduationCap, PackageSearch, Search, Tags, X } from 'lucide-react'
import { BRANDS, CATEGORIES, GROUPS } from './siteInfo'
import { CtaBand, PageHero, SectionHead, WhatsAppButton, usePageMeta } from './pieces'

const GROUP_LABEL = { office: 'Office supplies', school: 'School supplies' }

export default function SiteProducts() {
  usePageMeta('Products', 'Calculators, pens, markers, files, tape, glue, staplers, notebooks and school supplies at wholesale rates from Royal Stationers, Urdu Bazar Lahore.')

  // Filter, search and the open department live in the URL, so a department can be linked to directly
  const [params, setParams] = useSearchParams()
  const group = params.get('g') || 'all'
  const query = params.get('q') || ''
  const openSlug = params.get('d')
  const open = CATEGORIES.find((c) => c.slug === openSlug)

  const update = (changes) => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CATEGORIES.filter(
      (c) => (group === 'all' || c.group === group) && (!q || [c.name, c.text, ...c.items, ...c.brands].some((t) => t.toLowerCase().includes(q))),
    )
  }, [group, query])

  const showGroup = (g) => {
    update({ g: g === 'all' ? null : g })
    document.getElementById('departments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <PageHero
        eyebrow="Products"
        lines={['Stock your shelves by the carton.', 'Calculators, pens, files and notebooks.', 'Eight departments under one roof.']}
        lead="Eight departments of office and school stationery, stocked by the carton in Urdu Bazar. Open a department to see what it carries and ask for current rates."
        actions={
          <>
            <a href="#departments" className="site-btn site-btn-primary">
              View departments
              <ArrowRight />
            </a>
            <Link to="/contact" className="site-btn site-btn-outline">
              Send your list
            </Link>
          </>
        }
        cards={[
          { icon: Briefcase, title: 'Office supplies', text: 'Calculators, pens, files, tape and staplers', onClick: () => showGroup('office') },
          { icon: GraduationCap, title: 'School supplies', text: 'Notebooks, markers, colours and geometry', onClick: () => showGroup('school') },
          { icon: Tags, title: 'Brands we stock', text: BRANDS.join(', '), href: '#brands' },
          { icon: Boxes, title: 'Carton and loose rates', text: 'How our wholesale pricing works', to: '/wholesale#rates' },
        ]}
      />

      <section id="departments" className="scroll-mt-20 bg-surface">
        <div className="site-wrap py-14 md:py-20">
          <SectionHead eyebrow="Departments" title="Browse by department." />

          <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter departments">
              {GROUPS.map((g) => (
                <button key={g.id} type="button" className="site-chip" aria-pressed={group === g.id} onClick={() => update({ g: g.id === 'all' ? null : g.id })}>
                  {g.label}
                </button>
              ))}
            </div>
            <div className="input-icon w-full lg:w-80">
              <Search size={16} />
              <input
                id="product-search"
                className="input h-11"
                type="search"
                placeholder="Search, e.g. stapler pins"
                value={query}
                onChange={(e) => update({ q: e.target.value })}
                aria-label="Search products"
              />
            </div>
          </div>

          <p className="mt-6 text-[14px] text-ink-3" aria-live="polite">
            {list.length} {list.length === 1 ? 'department' : 'departments'}
            {query && ` matching "${query}"`}
          </p>

          {list.length ? (
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((c) => (
                <button key={c.slug} type="button" className="site-card group" data-reveal="true" onClick={() => update({ d: c.slug })}>
                  <div className="site-card-media relative">
                    <img src={c.image} alt={c.name} loading="lazy" width="960" height="720" />
                    <span className="absolute top-3 left-3 rounded-full bg-surface/95 px-2.5 py-1 text-[12px] font-medium text-ink-2 shadow-[var(--shadow-sm)]">
                      {GROUP_LABEL[c.group]}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[17px] font-semibold text-ink">{c.name}</span>
                    <span className="mt-1 text-[14px] leading-snug text-ink-2">{c.text}</span>
                    <ul className="mt-3 grid gap-1.5 text-[13px] text-ink-2">
                      {c.items.slice(0, 2).map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <Check size={14} className="text-good" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[14px] font-medium text-primary">
                      View details
                      <ArrowRight size={16} className="card-arrow" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div data-reveal="true" className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface-2 px-6 py-14 text-center">
              <span className="icon-tile">
                <PackageSearch size={22} />
              </span>
              <p className="mt-4 text-[17px] font-semibold text-ink">No department matches "{query}"</p>
              <p className="mt-1 max-w-[30rem] text-[15px] text-ink-2">We stock far more than is listed here. Send us your list and we will check it for you.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button type="button" className="site-btn site-btn-outline" onClick={() => update({ q: null, g: null })}>
                  Clear search
                </button>
                <Link to="/contact" className="site-btn site-btn-primary">
                  Send your list
                </Link>
              </div>
            </div>
          )}
          <p className="mt-8 text-[12px] text-ink-3">Product photos are for illustration. Brands and models in stock change through the year.</p>
        </div>
      </section>

      <section id="brands" className="scroll-mt-20 border-y border-line bg-surface-2">
        <div className="site-wrap grid gap-8 py-14 md:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <SectionHead eyebrow="Brands" title="Names your customers ask for." />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BRANDS.map((b) => (
              <li key={b} data-reveal="true">
                <button type="button" className="site-card w-full items-center py-6 text-center" onClick={() => update({ q: b, g: null })}>
                  <span className="text-[20px] font-semibold text-ink">{b}</span>
                  <span className="text-[13px] text-ink-3">See departments</span>
                </button>
              </li>
            ))}
            <li className="flex items-center justify-center rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-6 text-center text-[14px] text-ink-3">
              and more in the shop
            </li>
          </ul>
        </div>
      </section>

      <CtaBand title="Can't find what you need?" text="We stock far more than fits on one page. Send a photo of your list and we will tell you what is in stock." />

      {open && <DepartmentDialog dept={open} onClose={() => update({ d: null })} />}
    </>
  )
}

function DepartmentDialog({ dept, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const Icon = dept.icon
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/55 sm:place-items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dept.name}
        className="relative grid max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:rounded-2xl md:grid-cols-2"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-surface/95 text-ink-2 shadow-[var(--shadow-sm)] hover:text-ink"
          aria-label="Close"
        >
          <X size={20} />
        </button>
        <div className="bg-surface-2">
          <img src={dept.image} alt={dept.name} className="aspect-[4/3] w-full object-cover md:h-full md:aspect-auto" width="960" height="720" />
        </div>
        <div className="flex flex-col p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="icon-tile h-10 w-10">
              <Icon size={20} />
            </span>
            <span className="text-[13px] font-medium text-ink-3">{GROUP_LABEL[dept.group]}</span>
          </div>
          <h2 className="mt-4 font-serif text-[28px] font-semibold leading-tight text-ink">{dept.name}</h2>
          <p className="mt-2 text-[15px] text-ink-2">{dept.text}</p>

          <div className="mt-6 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">In this department</div>
          <ul className="mt-3 grid gap-2.5 text-[15px] text-ink">
            {dept.items.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check size={18} className="mt-0.5 text-good" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-6 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Brands</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {dept.brands.map((b) => (
              <span key={b} className="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium text-ink-2">
                {b}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row md:mt-auto md:pt-8">
            <WhatsAppButton text={`Assalam o Alaikum, mujhe ${dept.name} ke wholesale rates chahiye.`} className="sm:flex-1">
              Ask for rates
            </WhatsAppButton>
            <Link to="/contact" className="site-btn site-btn-outline sm:flex-1">
              Send a full list
            </Link>
          </div>
          <p className="mt-3 text-[12px] text-ink-3">Photo: {dept.credit} on Unsplash</p>
        </div>
      </div>
    </div>
  )
}
