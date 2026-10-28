import { Link } from 'react-router-dom'
import { ArrowRight, BookUser, Boxes, Building2, ChevronDown, Package, School, Store, Truck } from 'lucide-react'
import { CtaBand, PageHero, SectionHead, usePageMeta } from './pieces'

const WHO = [
  { icon: Store, title: 'Shops and bookshops', text: 'Weekly restocking at carton rates that leave room for your margin.', to: '/products' },
  { icon: School, title: 'Schools and academies', text: 'Send the term list once. We pack it by class or by item.', to: '/products?g=school' },
  { icon: Building2, title: 'Offices', text: 'Files, registers, pens and desk supplies on one invoice.', to: '/products?g=office' },
  { icon: Truck, title: 'Shops in other cities', text: 'Order on WhatsApp, receive it by bilty through your transport.', href: '#delivery' },
]

const TERMS = [
  {
    id: 'rates',
    icon: Boxes,
    title: 'Carton rate and loose rate',
    text: 'Every item has a carton rate for full cartons and a loose rate for single pieces. You can mix both in one order. The invoice shows cartons and loose pieces separately, so you can check every line.',
  },
  {
    id: 'delivery',
    icon: Truck,
    title: 'Bilty delivery',
    text: 'Tell us the transport company and your city. We pack the order, hand it over, and send you the bilty number on WhatsApp so you can track it.',
  },
  {
    id: 'accounts',
    icon: BookUser,
    title: 'Accounts for regular customers',
    text: 'Shops that buy from us regularly can open an account. Every bill, return and payment is recorded in your ledger, and we can share your statement at any time.',
  },
]

const FAQ = [
  { q: 'Do you sell to walk-in customers?', a: 'Our rates and stock are set up for shops, schools and offices buying in quantity. Walk-in customers are welcome at the shop, but the best rates are on carton quantities.' },
  { q: 'How do I get your rate list?', a: 'Message us on WhatsApp. Rates move with the market, so we send the current list instead of printing one that goes out of date.' },
  { q: 'Can I order without visiting Lahore?', a: 'Yes. Send your list on WhatsApp, confirm the rates and payment, and we dispatch the order by bilty to your city.' },
  { q: 'How do I pay?', a: 'Cash at the shop, bank transfer or cheque. Regular customers with an account can settle against their ledger.' },
  { q: 'Can I return damaged or wrong items?', a: 'Tell us on WhatsApp as soon as the parcel arrives, with a photo. Returns are recorded against your invoice.' },
]

export default function Wholesale() {
  usePageMeta('Wholesale', 'How wholesale ordering works at Royal Stationers: carton and loose rates, bilty delivery to any city, and ledger accounts for regular shops.')

  return (
    <>
      <PageHero
        eyebrow="Wholesale"
        lines={['Wholesale rates that work for shops.', 'Carton and loose rates on every bill.', 'Bilty delivery to your city.']}
        lead="We supply stationery shops, schools and offices. Order a full carton or a few loose pieces, collect from Urdu Bazar or receive it by bilty."
        actions={
          <>
            <Link to="/contact" className="site-btn site-btn-primary">
              Ask about an account
              <ArrowRight />
            </Link>
            <Link to="/products" className="site-btn site-btn-outline">
              See what we stock
            </Link>
          </>
        }
        cards={WHO}
      />

      <section className="border-b border-line">
        <div className="site-wrap py-16 md:py-20">
          <SectionHead eyebrow="How it works" title="Rates, delivery and accounts." />
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {TERMS.map(({ id, icon: Icon, title, text }) => (
              <article key={title} id={id} data-reveal="true" className="scroll-mt-24 rounded-lg border border-line bg-surface p-6 shadow-[var(--shadow-sm)]">
                <span className="icon-tile">
                  <Icon size={22} />
                </span>
                <h3 className="mt-5 text-[18px] text-ink">{title}</h3>
                <p className="mt-2 text-[15px] text-ink-2">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-surface-2">
        <div className="site-wrap grid items-center gap-10 py-16 md:py-20 lg:grid-cols-2 lg:gap-16">
          <SectionHead
            eyebrow="Your bill"
            title="Cartons and loose pieces, line by line."
            text="Every invoice lists cartons and loose pieces separately for each item, so you can check the count against the parcel before you sign the bilty."
          />
          <RateCard />
        </div>
      </section>

      <section id="faq" className="scroll-mt-20">
        <div className="site-wrap grid gap-10 py-16 md:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="self-start lg:sticky lg:top-28">
            <SectionHead eyebrow="Questions" title="What shopkeepers ask us first." text="Anything else, ask us on the contact page." />
          </div>
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="site-faq group py-5" data-reveal="true">
                <summary className="flex items-center justify-between gap-4 text-[17px] font-semibold text-ink">
                  {q}
                  <ChevronDown size={20} className="faq-chevron shrink-0 text-ink-3 transition-transform" />
                </summary>
                <p className="mt-3 max-w-[40rem] text-[15px] text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  )
}

// Hero visual: how one invoice line reads in cartons and loose pieces (illustrative, no real prices)
function RateCard() {
  const rows = [
    { item: 'Gel pen, black', ctn: '2 ctn', loose: '12 pcs' },
    { item: 'Box file, foolscap', ctn: '1 ctn', loose: '6 pcs' },
    { item: 'Clear tape, 2 inch', ctn: '3 ctn', loose: '0' },
    { item: 'Stapler pins #10', ctn: '1 ctn', loose: '20 box' },
  ]
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-lg)]" data-reveal="true">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="icon-tile h-10 w-10">
            <Package size={20} />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-ink">Sample order</div>
            <div className="text-[13px] text-ink-3">Cartons and loose in one bill</div>
          </div>
        </div>
        <span className="rounded-full bg-good-bg px-2.5 py-1 text-[12px] font-medium text-good">Ready to pack</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.06em] text-ink-3">
              <th className="px-5 py-2.5 font-medium">Item</th>
              <th className="px-5 py-2.5 text-right font-medium">Cartons</th>
              <th className="px-5 py-2.5 text-right font-medium">Loose</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item} className="border-t border-line">
                <td className="px-5 py-3 text-ink">{r.item}</td>
                <td className="px-5 py-3 text-right tabular-nums text-ink">{r.ctn}</td>
                <td className="px-5 py-3 text-right tabular-nums text-ink-2">{r.loose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-4 text-[14px] text-ink-2">
        <Truck size={16} className="text-primary" />
        Dispatch by bilty, number shared on WhatsApp
      </div>
    </div>
  )
}
