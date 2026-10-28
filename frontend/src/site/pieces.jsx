import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Clock, Mail, MapPin, Phone } from 'lucide-react'
import { CATEGORIES, SHOP, waLink } from './siteInfo'

const DEFAULT_TITLE = 'Royal Stationers | Wholesale stationery, Urdu Bazar Lahore'

// Sets the tab title and meta description for one public page
export function usePageMeta(title, description) {
  useEffect(() => {
    document.title = title ? `${title} | Royal Stationers` : DEFAULT_TITLE
    const meta = document.querySelector('meta[name="description"]')
    const before = meta?.getAttribute('content')
    if (meta && description) meta.setAttribute('content', description)
    return () => {
      document.title = DEFAULT_TITLE
      if (meta && before) meta.setAttribute('content', before)
    }
  }, [title, description])
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduce
}

// Types each line, pauses, deletes it, moves to the next. Starts with the first line already written.
export function Typewriter({ words }) {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [length, setLength] = useState(words[0].length)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (reduce) return
    const word = words[index]
    if (deleting && length === 0) {
      setDeleting(false)
      setIndex((i) => (i + 1) % words.length)
      return
    }
    const done = !deleting && length === word.length
    const t = setTimeout(
      () => (done ? setDeleting(true) : setLength((l) => l + (deleting ? -1 : 1))),
      done ? 2200 : deleting ? 22 : 55,
    )
    return () => clearTimeout(t)
  }, [words, index, length, deleting, reduce])

  // The longest line sits invisibly underneath, so the headline keeps its height while lines change
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a))
  return (
    <span className="typewriter" aria-hidden="true">
      <span className="tw-sizer">{longest}</span>
      <span className="tw-text">
        {words[index].slice(0, length)}
        <span className="tw-caret" />
      </span>
    </span>
  )
}

// WhatsApp's own glyph (lucide has no brand icons)
export function WhatsAppIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  )
}

export function WhatsAppButton({ text, children = 'Ask on WhatsApp', className = '' }) {
  return (
    <a href={waLink(text)} target="_blank" rel="noopener noreferrer" className={`site-btn site-btn-wa ${className}`}>
      <WhatsAppIcon />
      {children}
    </a>
  )
}

// Internal route, in-page anchor, or outside link: the card picks the right element
function CardLink({ to, href, onClick, className, children, ...rest }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} {...rest}>
        {children}
      </button>
    )
  }
  if (href) {
    const external = /^https?:/.test(href)
    return (
      <a href={href} className={className} {...rest} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to} className={className} {...rest}>
      {children}
    </Link>
  )
}

// `reveal`: fade up on scroll (used below the hero; hero cards are visible straight away)
export function LinkCard({ icon: Icon, title, text, to, href, onClick, reveal }) {
  return (
    <CardLink to={to} href={href} onClick={onClick} className="site-card group" data-reveal={reveal ? 'true' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <span className="icon-tile">
          <Icon size={22} />
        </span>
        <ArrowUpRight size={18} className="card-arrow text-ink-3 group-hover:text-primary" />
      </div>
      <div className="min-w-0">
        <div className="text-[16px] font-semibold text-ink">{title}</div>
        {text && <p className="mt-1 text-[14px] leading-snug text-ink-2 break-words">{text}</p>}
      </div>
    </CardLink>
  )
}

// Every page opens the same way: eyebrow, a typed headline that cycles through the page's lines, lead, actions, then a row of cards
export function PageHero({ eyebrow, lines, lead, actions, cards }) {
  return (
    <section className="border-b border-line bg-surface-2">
      <div className="site-wrap pt-8 pb-12 md:pt-12 md:pb-16">
        <div className="max-w-[48rem]">
          <span className="site-eyebrow">{eyebrow}</span>
          <h1 className="site-h1 mt-3 text-ink">
            <span className="sr-only">{lines.join(' ')}</span>
            <Typewriter words={lines} />
          </h1>
          {lead && <p className="site-lead mt-4">{lead}</p>}
          {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {cards && (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:mt-10 lg:grid-cols-4">
            {cards.map((c) => (
              <LinkCard key={c.title} {...c} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function SectionHead({ eyebrow, title, text, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6 self-start" data-reveal="true">
      <div className="max-w-[40rem]">
        <p className="site-eyebrow">{eyebrow}</p>
        <h2 className="site-h2 mt-3 text-ink">{title}</h2>
        {text && <p className="mt-4 text-ink-2">{text}</p>}
      </div>
      {action}
    </div>
  )
}

// Department cards with photos; each opens that department on the Products page
export function CategoryGrid({ limit }) {
  const list = limit ? CATEGORIES.slice(0, limit) : CATEGORIES
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {list.map((c) => (
        <Link key={c.slug} to={`/products?d=${c.slug}`} className="site-card group" data-reveal="true">
          <div className="site-card-media">
            <img src={c.image} alt={c.name} loading="lazy" width="960" height="720" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[16px] font-semibold text-ink">{c.name}</span>
            <span className="mt-1 text-[14px] leading-snug text-ink-2">{c.text}</span>
            <span className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-primary">
              View department
              <ArrowRight size={16} className="card-arrow" />
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

export function ContactList() {
  const rows = [
    { icon: MapPin, label: 'Address', value: SHOP.addressLines.join(', ') },
    { icon: Phone, label: 'Phone and WhatsApp', value: SHOP.phone, href: `tel:+${SHOP.phoneIntl}` },
    { icon: Mail, label: 'Email', value: SHOP.email, href: `mailto:${SHOP.email}` },
    { icon: Clock, label: 'Shop hours', value: SHOP.hours, note: SHOP.hoursNote },
  ]
  return (
    <dl className="grid gap-6">
      {rows.map(({ icon: Icon, label, value, href, note }) => (
        <div key={label} className="flex gap-4">
          <span className="icon-tile h-10 w-10">
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <dt className="text-[13px] text-ink-3">{label}</dt>
            <dd className="break-words font-medium text-ink">
              {href ? (
                <a href={href} className="hover:text-primary">
                  {value}
                </a>
              ) : (
                value
              )}
              {note && <span className="block font-normal text-ink-2">{note}</span>}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  )
}

export function MapEmbed({ className = '' }) {
  return (
    <iframe
      title="Royal Stationers on Google Maps"
      src={SHOP.mapEmbedUrl}
      className={`block w-full border-0 ${className}`}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  )
}

export function CtaBand({ title = 'Opening a shop or restocking for the season?', text = 'Send us your list and we reply with rates and stock the same day.' }) {
  return (
    <section className="bg-night">
      <div className="site-wrap flex flex-col gap-6 py-14 md:flex-row md:items-center md:gap-10 md:py-16" data-reveal="true">
        <div className="max-w-[40rem]">
          <h2 className="font-serif text-[28px] font-semibold leading-[1.2] text-night-strong md:text-[34px]">{title}</h2>
          <p className="mt-3 text-night-text">{text}</p>
        </div>
        <div className="flex flex-wrap gap-3 md:ml-auto">
          <Link to="/contact" className="site-btn bg-white text-ink hover:bg-white/90">
            Send your list
            <ArrowRight />
          </Link>
          <Link to="/products" className="site-btn border-white/25 text-night-strong hover:border-white/60">
            Browse products
          </Link>
        </div>
      </div>
    </section>
  )
}
