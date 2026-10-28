import { useState } from 'react'
import { Clock, Mail, Map as MapIcon, MapPin, MessageCircle, Navigation, Phone, Send } from 'lucide-react'
import { SHOP, waLink } from './siteInfo'
import { MapEmbed, PageHero, WhatsAppIcon, usePageMeta } from './pieces'

const EMPTY = { name: '', shop: '', city: '', message: '' }

export default function Contact() {
  usePageMeta('Contact', 'Visit Royal Stationers at Shop #22, First Floor, Bashir Center, Urdu Bazar, Lahore, or message 0321-4577629 on WhatsApp.')

  return (
    <>
      <PageHero
        eyebrow="Contact"
        lines={['Visit the shop or send your list.', 'Call, message or email us.', 'We reply with rates the same day.']}
        lead="Shop #22, First Floor, Bashir Center, Urdu Bazar, Lahore. Send your list on WhatsApp and we reply with rates the same day."
        actions={
          <>
            <a href="#enquiry" className="site-btn site-btn-primary">
              <Send />
              Send an enquiry
            </a>
            <a href={SHOP.directionsUrl} target="_blank" rel="noopener noreferrer" className="site-btn site-btn-outline">
              <Navigation />
              Get directions
            </a>
          </>
        }
        cards={[
          { icon: MapPin, title: 'Address', text: SHOP.addressShort, href: SHOP.mapUrl },
          { icon: Phone, title: SHOP.phone, text: 'Call the shop', href: `tel:+${SHOP.phoneIntl}` },
          { icon: MessageCircle, title: 'WhatsApp', text: 'Send your list or ask for rates', href: waLink() },
          { icon: Mail, title: 'Email', text: SHOP.email, href: `mailto:${SHOP.email}` },
        ]}
      />

      <div className="border-b border-line bg-surface">
        <div className="site-wrap flex flex-wrap items-center gap-x-3 gap-y-1 py-4 text-[15px] text-ink-2">
          <Clock size={18} className="text-primary" />
          <span className="font-medium text-ink">{SHOP.hours}</span>
          <span>{SHOP.hoursNote}</span>
        </div>
      </div>

      <section className="bg-surface-2">
        <div className="site-wrap grid items-start gap-10 py-16 md:py-24 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]" data-reveal="true">
            <MapEmbed className="aspect-[4/3] bg-surface-2 lg:aspect-auto lg:h-[460px]" />
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <div className="min-w-0 text-[14px] text-ink-2">{SHOP.addressLines.join(', ')}</div>
              <a className="site-btn site-btn-sm site-btn-outline shrink-0 sm:ml-auto" href={SHOP.mapUrl} target="_blank" rel="noopener noreferrer">
                <MapIcon />
                Open in Google Maps
              </a>
            </div>
          </div>
          <EnquiryForm />
        </div>
      </section>
    </>
  )
}

// No backend needed: the form writes a WhatsApp message and opens it, ready to send
function EnquiryForm() {
  const [form, setForm] = useState(EMPTY)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const ready = form.name.trim() && form.message.trim()

  const submit = (e) => {
    e.preventDefault()
    if (!ready) return
    const text = [
      'Assalam o Alaikum, Royal Stationers.',
      `Name: ${form.name.trim()}`,
      form.shop.trim() && `Shop / school: ${form.shop.trim()}`,
      form.city.trim() && `City: ${form.city.trim()}`,
      '',
      form.message.trim(),
    ]
      .filter((l) => l !== false && l !== '')
      .join('\n')
    window.open(waLink(text), '_blank', 'noopener')
  }

  return (
    <form id="enquiry" data-reveal="true" onSubmit={submit} className="scroll-mt-24 rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow)] sm:p-7">
      <h2 className="font-serif text-[26px] font-semibold text-ink">Send an enquiry</h2>
      <p className="mt-2 text-[15px] text-ink-2">Your message opens in WhatsApp, ready to send to {SHOP.phone}.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">
            Your name <span className="req">*</span>
          </span>
          <input className="input h-11" id="enq-name" value={form.name} onChange={set('name')} autoComplete="name" required />
        </label>
        <label className="field">
          <span className="field-label">Shop or school</span>
          <input className="input h-11" id="enq-shop" value={form.shop} onChange={set('shop')} autoComplete="organization" />
        </label>
        <label className="field sm:col-span-2">
          <span className="field-label">City</span>
          <input className="input h-11" id="enq-city" value={form.city} onChange={set('city')} autoComplete="address-level2" placeholder="Lahore" />
        </label>
        <label className="field sm:col-span-2">
          <span className="field-label">
            What do you need? <span className="req">*</span>
          </span>
          <textarea
            className="input"
            id="enq-message"
            rows={5}
            value={form.message}
            onChange={set('message')}
            placeholder="Example: 5 cartons gel pens black, 2 cartons box files, rates for stapler pins"
            required
          />
        </label>
      </div>
      <button type="submit" className="site-btn site-btn-wa mt-6 w-full" disabled={!ready}>
        <WhatsAppIcon />
        Send on WhatsApp
        <Send />
      </button>
      <p className="mt-3 text-center text-[13px] text-ink-3">
        Prefer email? Write to <a href={`mailto:${SHOP.email}`} className="text-primary hover:underline">{SHOP.email}</a>
      </p>
    </form>
  )
}
