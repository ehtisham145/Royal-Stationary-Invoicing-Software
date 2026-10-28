import { Link } from 'react-router-dom'
import { ArrowRight, Handshake, MapPin, ShieldCheck, Star, Truck } from 'lucide-react'
import { SHOP } from './siteInfo'
import { CategoryGrid, CtaBand, PageHero, SectionHead, usePageMeta } from './pieces'

const VALUES = [
  { icon: ShieldCheck, title: 'Fair, clear rates', text: 'Carton and loose rates on every bill, so you can check each line.', to: '/wholesale#rates' },
  { icon: Handshake, title: 'Long-term customers', text: 'We would rather keep a customer for years than win one order.', to: '/wholesale#accounts' },
  { icon: Truck, title: 'Orders out on time', text: 'Ready stock, packed by carton, handed to transport the same day.', to: '/wholesale#delivery' },
  { icon: Star, title: `Rated ${SHOP.rating} on Google`, text: 'Read what customers who visit the shop say.', href: SHOP.mapUrl },
]

export default function About() {
  usePageMeta('About', 'Royal Stationers is a long-standing wholesale stationery supplier in Urdu Bazar, Lahore, serving shops, schools and offices across Pakistan.')

  return (
    <>
      <PageHero
        eyebrow="About us"
        lines={["Urdu Bazar's stationery supplier.", 'Trusted by shops across Pakistan.', `Rated ${SHOP.rating} by our customers.`]}
        lead="Royal Stationers has supplied stationery shops, schools and offices from Urdu Bazar, Lahore for many years. Our counter is on the first floor of Bashir Center, and our customers are spread across Pakistan."
        actions={
          <>
            <Link to="/contact" className="site-btn site-btn-primary">
              <MapPin />
              Visit the shop
            </Link>
            <Link to="/products" className="site-btn site-btn-outline">
              Browse products
            </Link>
          </>
        }
        cards={VALUES}
      />

      <section className="border-b border-line">
        <div className="site-wrap grid gap-10 py-16 md:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <SectionHead eyebrow="Our work" title="We keep the shelves of other shops full." />
          <div className="grid gap-5 text-[17px] text-ink-2" data-reveal="true">
            <p>
              Urdu Bazar is where Lahore's stationery trade buys its stock, and Royal Stationers is part of that trade. We bring in office and school
              stationery, including our own imports, and sell it on to the shops, schools and offices that serve the end customer.
            </p>
            <p>
              That is why everything we do is measured in cartons. Our rates leave room for the shopkeeper's margin, our bills show cartons and loose
              pieces line by line, and our dispatch is built around bilty, so a shop in another city can order as easily as one down the street.
            </p>
            <p>Behind the counter, every sale, return and payment is recorded in our own system, so regular customers always have a clear ledger.</p>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-surface-2">
        <div className="site-wrap py-16 md:py-20">
          <SectionHead
            eyebrow="What we stock"
            title="A look at our departments."
            action={
              <Link to="/products" className="site-btn site-btn-outline">
                All products
                <ArrowRight />
              </Link>
            }
          />
          <div className="mt-10">
            <CategoryGrid limit={4} />
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
