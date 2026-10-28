import { Link } from 'react-router-dom'
import { ArrowRight, BookUser, Boxes, LayoutGrid, Map as MapIcon, MapPin, MessageSquareText, Navigation, PackageCheck, ReceiptText, Star, Truck, Warehouse } from 'lucide-react'
import { BRANDS, SHOP } from './siteInfo'
import { CategoryGrid, ContactList, CtaBand, LinkCard, MapEmbed, PageHero, SectionHead, usePageMeta } from './pieces'

const WHY = [
  { icon: Boxes, title: 'Carton and loose rates', text: 'Buy full cartons at the best rate, or mix loose pieces to fill a small order.', to: '/wholesale#rates' },
  { icon: Truck, title: 'Bilty to any city', text: 'Orders are packed and handed to the transport you choose, with the bilty number sent on WhatsApp.', to: '/wholesale#delivery' },
  { icon: Warehouse, title: 'Ready stock', text: 'Stock is kept at the shop and our godown, so most orders leave the same day.', to: '/products' },
  { icon: BookUser, title: 'Accounts for regular shops', text: 'Regular customers get a ledger account with a clear record of every bill and payment.', to: '/wholesale#accounts' },
]

const STEPS = [
  { icon: MessageSquareText, title: 'Send your list', text: 'WhatsApp a photo or typed list of what you need, with quantities.' },
  { icon: ReceiptText, title: 'Confirm rates', text: 'We reply with current rates and stock. You confirm what to pack.' },
  { icon: PackageCheck, title: 'Collect or dispatch', text: 'Pick it up from Urdu Bazar, or we send it by bilty to your city.' },
]

// Each brand set in its own type treatment, close to how it appears on the packaging
const BRAND_STYLE = {
  next: 'text-[22px] font-semibold lowercase tracking-[-0.02em]',
  Zuofan: 'text-[18px] font-semibold uppercase tracking-[0.18em]',
  Ruya: 'font-serif text-[20px] font-semibold',
  Chanyi: 'text-[18px] font-semibold uppercase tracking-[0.06em]',
  Citizen: 'text-[19px] font-semibold uppercase tracking-[0.02em]',
}

export default function Home() {
  usePageMeta(null, 'Wholesale office and school stationery in Urdu Bazar, Lahore. Carton and loose rates for shops, schools and offices, with bilty delivery across Pakistan.')

  return (
    <>
      <PageHero
        eyebrow="Wholesale stationery, Urdu Bazar Lahore"
        lines={['Welcome to Royal Stationers.', 'Stationery by the carton for every shop.', 'Wholesale rates for schools and offices.', 'Bilty delivery to any city in Pakistan.']}
        lead="Office and school stationery for shopkeepers, schools and offices across Pakistan. Carton and loose rates, ready stock, and bilty to any city."
        actions={
          <>
            <Link to="/products" className="site-btn site-btn-primary">
              Browse products
              <ArrowRight />
            </Link>
            <Link to="/contact" className="site-btn site-btn-outline">
              Send your list
            </Link>
          </>
        }
        cards={[
          { icon: LayoutGrid, title: '8 departments', text: 'Calculators, pens, files, notebooks and more', to: '/products' },
          { icon: Boxes, title: 'Carton and loose rates', text: 'Full cartons or mixed loose pieces', to: '/wholesale#rates' },
          { icon: Truck, title: 'Bilty to all Pakistan', text: 'Packed by carton, number on WhatsApp', to: '/wholesale#delivery' },
          { icon: Star, title: `Rated ${SHOP.rating} on Google`, text: 'See reviews and the shop on Maps', href: SHOP.mapUrl },
        ]}
      />

      <section className="border-b border-line">
        <div className="site-wrap flex flex-col gap-4 py-7 md:flex-row md:items-center md:gap-10">
          <p className="shrink-0 text-[13px] font-medium text-ink-3">Brands on our shelves</p>
          <ul className="flex flex-wrap items-center gap-x-10 gap-y-3 text-ink-2" data-reveal="true">
            {BRANDS.map((b) => (
              <li key={b} className={BRAND_STYLE[b]}>
                {b}
              </li>
            ))}
            <li className="text-[14px] text-ink-3">and more</li>
          </ul>
        </div>
      </section>

      <section className="border-b border-line bg-surface-2">
        <div className="site-wrap py-16 md:py-20">
          <SectionHead
            eyebrow="What we supply"
            title="Everything a stationery shop keeps on its shelves."
            action={
              <Link to="/products" className="site-btn site-btn-outline">
                All products
                <ArrowRight />
              </Link>
            }
          />
          <div className="mt-10">
            <CategoryGrid />
          </div>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="site-wrap grid gap-12 py-16 md:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="self-start" data-reveal="true">
            <p className="site-eyebrow">Why shops buy from us</p>
            <h2 className="site-h2 mt-3 text-ink">Built for resellers, not walk-in shoppers.</h2>
            <p className="mt-5 max-w-[32rem] text-ink-2">
              Most of our customers are stationery shops, bookshops, schools and offices who reorder every week. Everything is set up to make that quick.
            </p>
            <Link to="/wholesale" className="site-btn site-btn-primary mt-8">
              How wholesale works
              <ArrowRight />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {WHY.map((w) => (
              <LinkCard key={w.title} {...w} reveal />
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-surface-2">
        <div className="site-wrap py-16 md:py-20">
          <SectionHead eyebrow="How to order" title="Send your list. We handle the rest." />
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-lg border border-line bg-surface p-6 shadow-[var(--shadow-sm)]" data-reveal="true">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-md bg-brand text-brand-ink">
                    <Icon size={22} />
                  </span>
                  <span className="font-serif text-[15px] text-ink-3">Step {i + 1} of 3</span>
                </div>
                <h3 className="mt-5 text-[18px] text-ink">{title}</h3>
                <p className="mt-2 text-[15px] text-ink-2">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section>
        <div className="site-wrap grid items-start gap-10 py-16 md:py-20 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0" data-reveal="true">
            <p className="site-eyebrow">Visit the shop</p>
            <h2 className="site-h2 mt-3 text-ink">First floor, Bashir Center, Urdu Bazar.</h2>
            <div className="mt-8">
              <ContactList />
            </div>
            <Link to="/contact" className="site-btn site-btn-outline mt-8">
              <MapPin />
              Contact page
            </Link>
          </div>
          <VisitCard />
        </div>
      </section>

      <CtaBand />
    </>
  )
}

export function VisitCard() {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]" data-reveal="true">
      <MapEmbed className="aspect-[16/10] bg-surface-2" />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="font-semibold text-ink">Royal Stationers</div>
          <div className="flex items-center gap-1.5 text-[14px] text-ink-2">
            <span className="font-semibold text-warning">{SHOP.rating}</span>
            <span className="inline-flex text-warning">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={14} className="fill-current" />
              ))}
            </span>
            <span>on Google</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <a className="site-btn site-btn-sm site-btn-outline" target="_blank" rel="noopener noreferrer" href={SHOP.mapUrl}>
            <MapIcon />
            Open map
          </a>
          <a className="site-btn site-btn-sm site-btn-primary" target="_blank" rel="noopener noreferrer" href={SHOP.directionsUrl}>
            <Navigation />
            Directions
          </a>
        </div>
      </div>
    </div>
  )
}
