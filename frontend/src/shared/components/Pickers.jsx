import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'
import { matchesWords } from '../lib/search'
import { money, qtyText } from '../lib/format'
import { customerLabel } from '../lib/customerFields'
import DateInput from './DateInput'

const MAX_RESULTS = 40

// Type-to-search list with keyboard support (↑ ↓ Enter Esc). `render(item)` draws one row.
// `browse`: also works as a dropdown — click or ↓ with nothing typed lists every item (up to `browseLimit`).
const SearchBox = forwardRef(function SearchBox({ items, filter, render, onPick, placeholder, autoFocus, emptyText, browse, browseLimit = Infinity }, ref) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

  // `total` counts every match while browsing, so the list can say how many more there are
  const { results, total } = useMemo(() => {
    if (!q.trim() && !browse) return { results: [], total: 0 }
    const browsing = !q.trim()
    const limit = browsing ? browseLimit : MAX_RESULTS
    const out = []
    let count = 0
    for (const it of items) {
      if (!filter(it, q)) continue
      count++
      if (out.length < limit) out.push(it)
      else if (!browsing) break
    }
    return { results: out, total: count }
  }, [items, filter, q, browse, browseLimit])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(it) {
    onPick(it)
    setQ('')
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (results[active]) {
        e.preventDefault()
        pick(results[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="searchbox" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="input-icon">
        <Search size={16} />
        <input
          ref={inputRef}
          className="input"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => q && setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {q ? (
          <button type="button" className="input-suffix" onClick={() => setQ('')} aria-label="Clear">
            <X size={16} />
          </button>
        ) : (
          browse && (
            <button
              type="button"
              className="input-suffix"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen((o) => !o)
                inputRef.current?.focus()
              }}
              aria-label="Show all"
            >
              <ChevronDown size={16} />
            </button>
          )
        )}
      </div>
      {open && (q.trim() || browse) && (
        <FloatingList anchor={inputRef} listRef={listRef}>
          {results.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(it)}
              >
                {render(it)}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="searchbox-empty">{emptyText}</li>}
          {!q.trim() && total > results.length && (
            <li className="searchbox-empty">
              Showing {results.length} of {total}. Type to narrow down.
            </li>
          )}
        </FloatingList>
      )}
    </div>
  )
})

// Four rows and the top of the fifth (so it is clear the list scrolls)
const LIST_MAX_HEIGHT = 250
const GAP = 4
const EDGE = 8

// The results list is drawn on top of the page (portal), not inside the card, table or modal that holds the
// input, so their edges cannot cut it off. It opens below the input, or above when there is more room there,
// and follows the input when the page scrolls or the window is resized.
function FloatingList({ anchor, listRef, children }) {
  const [style, setStyle] = useState(null)

  useLayoutEffect(() => {
    function place() {
      const el = anchor.current?.closest('.input-icon') ?? anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - GAP - EDGE
      const above = r.top - GAP - EDGE
      const up = below < Math.min(LIST_MAX_HEIGHT, 180) && above > below
      setStyle({
        left: r.left,
        width: r.width,
        maxHeight: Math.max(120, Math.min(LIST_MAX_HEIGHT, up ? above : below)),
        ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // true: also when a card or modal scrolls
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  return createPortal(
    <ul
      className="searchbox-list"
      ref={listRef}
      role="listbox"
      style={style ?? { visibility: 'hidden' }}
      onMouseDown={(e) => e.preventDefault()} // keep focus in the input (scrollbar clicks too)
    >
      {children}
    </ul>,
    document.body,
  )
}

const productFilter = (p, q) => p.active !== false && matchesWords(q, p.code, p.name, p.company, p.brand, p.category)

// `stock` = stockIndex() result, used to show stock next to each product
export const ProductSearch = forwardRef(function ProductSearch({ products, stock, onPick, autoFocus, placeholder }, ref) {
  return (
    <SearchBox
      ref={ref}
      items={products}
      filter={productFilter}
      onPick={onPick}
      autoFocus={autoFocus}
      browse
      browseLimit={200}
      placeholder={placeholder ?? 'Search by name or code, or pick from the list'}
      emptyText="No product matches"
      render={(p) => {
        const total = stock?.[p.id]?.total ?? 0
        return (
          <>
            <span className="sb-main">
              <span className="strong">{p.name}</span>
              <span className="text-muted">
                {p.code}
                {p.company && ` · ${p.company}`}
                {p.carton_qty > 1 && ` · ${p.carton_qty}/ctn`}
              </span>
            </span>
            <span className="sb-side">
              <span className="strong">{money(p.price)}</span>
              <span className={total > 0 ? 'text-muted' : 'text-critical'}>{qtyText(total, p.unit, p.carton_qty)}</span>
            </span>
          </>
        )
      }}
    />
  )
})

const customerFilter = (c, q) => c.active !== false && matchesWords(q, String(c.code), c.name, c.city, c.phone, c.contact_person)

// `balances` = { [customer_id]: balance }
export function CustomerSearch({ customers, balances, onPick, autoFocus }) {
  return (
    <SearchBox
      items={customers}
      filter={customerFilter}
      onPick={onPick}
      autoFocus={autoFocus}
      browse
      placeholder="Select customer"
      emptyText="No customer matches"
      render={(c) => (
        <>
          <span className="sb-main">
            <span className="strong">{customerLabel(c)}</span>
            <span className="text-muted">
              #{c.code}
              {c.phone && ` · ${c.phone}`}
            </span>
          </span>
          {balances && <span className="sb-side strong">{money(balances[c.id] ?? 0)}</span>}
        </>
      )}
    />
  )
}

// From / To date filter used on list pages
export function DateRange({ from, to, onChange }) {
  return (
    <div className="date-range">
      <DateInput value={from} max={to} onChange={(v) => onChange({ from: v, to })} aria-label="From date" />
      <span className="text-muted">to</span>
      <DateInput value={to} min={from} onChange={(v) => onChange({ from, to: v })} aria-label="To date" />
    </div>
  )
}
