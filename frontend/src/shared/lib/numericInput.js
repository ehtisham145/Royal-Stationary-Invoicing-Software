// Number fields accept numbers only: letters and symbols are blocked as they are typed, and cleaned out of
// pasted or dropped text. Works app-wide with no per-field code.
//
// Which inputs count as number fields:
//   .input-num, inputmode="decimal", or data-numeric       -> digits and one decimal point
//   data-numeric="int", or .input-num with inputmode="numeric" -> digits only
//   data-signed="true"                                      -> may also start with a minus sign
// Commas are not allowed (several calculations read "1,250" as not-a-number); pasted "1,250" becomes "1250".
// Date fields use inputmode="numeric" without .input-num, so they are left alone.

const isNumeric = (el) =>
  el instanceof HTMLInputElement && (el.classList.contains('input-num') || el.inputMode === 'decimal' || el.dataset.numeric != null)
const isInteger = (el) => el.dataset.numeric === 'int' || (el.inputMode === 'numeric' && el.classList.contains('input-num'))

function clean(value, el) {
  const integer = isInteger(el)
  const signed = el.dataset.signed === 'true'
  let out = ''
  let dot = false
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') out += ch
    else if (ch === '.' && !integer && !dot) {
      dot = true
      out += ch
    } else if (ch === '-' && signed && out === '') out += ch
  }
  return out
}

// React tracks the value through the element's own setter; the prototype setter goes around it,
// so React still sees the change and its state receives the cleaned value
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set

let tip = null
let tipTimer = 0
function warn(el) {
  const message = isInteger(el) ? 'Whole numbers only' : el.dataset.signed === 'true' ? 'Numbers only (minus allowed at the start)' : 'Numbers only'
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'num-tip'
    tip.setAttribute('role', 'status')
    document.body.appendChild(tip)
  }
  tip.textContent = message
  const r = el.getBoundingClientRect()
  tip.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 36)}px`
  tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`
  tip.hidden = false
  el.classList.add('input-reject')
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => {
    tip.hidden = true
    document.querySelectorAll('.input-reject').forEach((x) => x.classList.remove('input-reject'))
  }, 1400)
}

export function installNumericInput() {
  if (window.__numericInputInstalled) return
  window.__numericInputInstalled = true

  // Typing: refuse a character that would make the value invalid, before it appears
  document.addEventListener(
    'beforeinput',
    (e) => {
      const el = e.target
      if (!isNumeric(el) || !e.data || !e.inputType.startsWith('insert')) return
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const next = el.value.slice(0, start) + e.data + el.value.slice(end)
      if (clean(next, el) !== next) {
        e.preventDefault()
        warn(el)
      }
    },
    true,
  )

  // Paste, drop, autofill: clean whatever got in, keeping the caret where it was
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target
      if (!isNumeric(el)) return
      const value = el.value
      const cleaned = clean(value, el)
      if (cleaned === value) return
      const caret = el.selectionStart ?? value.length
      const caretAfter = clean(value.slice(0, caret), el).length
      setNativeValue.call(el, cleaned)
      el.setSelectionRange?.(caretAfter, caretAfter)
      warn(el)
    },
    true,
  )
}
