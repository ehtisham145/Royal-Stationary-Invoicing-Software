import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'

const pad = (n) => String(n).padStart(2, '0')

// YYYY-MM-DD -> DD/MM/YYYY
const toText = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

// DD/MM/YYYY (also - or . between, or 8 digits) -> YYYY-MM-DD, or null if not a real date.
// Two-digit years (27/10/26) only when the user is done typing, so typing "2026" isn't cut short.
function toISO(text, allowShortYear) {
  const t = text.trim()
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t)
  if (!m) return null
  if (m[3].length === 2 && !allowShortYear) return null
  const day = +m[1]
  const month = +m[2]
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

const inRange = (iso, min, max) => (!min || iso >= min) && (!max || iso <= max)

// Date field: type DD/MM/YYYY or pick from the calendar. value / onChange use YYYY-MM-DD ('' = empty).
export default function DateInput({ value, onChange, min, max, className = '', ...rest }) {
  const [text, setText] = useState(() => toText(value))
  const pickerRef = useRef(null)

  // Follow outside changes (calendar, reset buttons), but leave the text alone while it already means this date
  useEffect(() => {
    if (toISO(text, true) !== (value || null)) setText(toText(value))
  }, [value])

  function handleChange(e) {
    let t = e.target.value.replace(/[^\d/.-]/g, '').slice(0, 10)
    // Add the slashes while typing digits: 27 -> 27/, 27/10 -> 27/10/
    if (t.length > text.length && (/^\d{2}$/.test(t) || /^\d{1,2}\/\d{2}$/.test(t))) t += '/'
    setText(t)
    const iso = toISO(t, false)
    if (iso && inRange(iso, min, max)) onChange(iso)
  }

  function commit() {
    if (!text.trim()) {
      if (value) onChange('')
      return
    }
    const iso = toISO(text, true)
    if (iso && inRange(iso, min, max)) {
      if (iso !== value) onChange(iso)
      setText(toText(iso))
    } else {
      setText(toText(value)) // not a valid date: go back to the last good one
    }
  }

  function openPicker() {
    const el = pickerRef.current
    try {
      el.showPicker()
    } catch {
      el.focus()
      el.click()
    }
  }

  const full = text.length >= 8
  const bad = full && !(toISO(text, true) && inRange(toISO(text, true), min, max))

  return (
    <div className={`date-input ${className}`}>
      <input
        {...rest}
        className={`input ${bad ? 'invalid' : ''}`}
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={text}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <button type="button" className="date-input-btn" onClick={openPicker} aria-label="Open calendar" tabIndex={-1}>
        <CalendarDays size={16} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="date-input-native"
        value={value || ''}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
