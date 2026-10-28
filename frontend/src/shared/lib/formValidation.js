// Replaces the browser's validation bubbles (which can't be styled) with an inline message under each field.
// Works for every form that uses required, type="email", minLength, min/max and so on, with no per-form code.
// After a failed submit, or once a field has been typed in and left, its message updates as the user types.
// Rules the browser doesn't know (passwords match, quantity too high) use el.setCustomValidity(message).
// Pages that are not a <form> call validateWithin(root) before saving.
// The first problem is scrolled to the middle of the screen and focused.

const messages = new WeakMap()
let focusedThisRound = false
let nextId = 0

function labelFor(el) {
  const text =
    el.closest('.field')?.querySelector('.field-label')?.textContent ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    'This field'
  return text.replace(/\*/g, '').replace(/\(optional\)/i, '').trim()
}

function messageFor(el) {
  const v = el.validity
  const name = labelFor(el)
  if (v.customError) return el.validationMessage
  if (v.valueMissing) return el.type === 'checkbox' ? 'Tick this box to continue.' : `${name} is required.`
  if (v.typeMismatch && el.type === 'email') return 'Enter a valid email address, like name@shop.com.'
  if (v.typeMismatch) return `Enter a valid ${name.toLowerCase()}.`
  if (v.tooShort) return `${name} needs at least ${el.minLength} characters.`
  if (v.rangeUnderflow) return `${name} must be ${el.min} or more.`
  if (v.rangeOverflow) return `${name} must be ${el.max} or less.`
  if (v.badInput) return `Enter a number for ${name.toLowerCase()}.`
  return el.validationMessage
}

function show(el) {
  let msg = messages.get(el)
  if (!msg) {
    msg = document.createElement('span')
    msg.className = 'field-error'
    msg.id = `field-error-${++nextId}`
    msg.setAttribute('role', 'alert')
    // After the icon wrapper when there is one, so the message sits under the whole input
    const anchor = el.closest('.input-icon, .date-input') || el
    anchor.insertAdjacentElement('afterend', msg)
    messages.set(el, msg)
  }
  msg.textContent = messageFor(el)
  el.classList.add('invalid')
  el.setAttribute('aria-invalid', 'true')
  el.setAttribute('aria-describedby', msg.id)
}

function clear(el) {
  messages.get(el)?.remove()
  messages.delete(el)
  el.classList.remove('invalid')
  el.removeAttribute('aria-invalid')
  el.removeAttribute('aria-describedby')
}

const update = (el) => (el.validity.valid ? clear(el) : show(el))
const isField = (el) => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement

// A hidden stand-in (RequiredProxy) points at the visible control next to it
function focusTarget(el) {
  if (!el.classList.contains('validation-proxy')) return el
  return el.closest('.field')?.querySelector('input:not(.validation-proxy), select, textarea, button') ?? el
}

function scrollAndFocus(el) {
  const target = focusTarget(el)
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.focus({ preventScroll: true })
}

// Re-check every field that already shows (or showed) a message. Runs after React has re-rendered,
// so rules that depend on other fields (confirm password, stock) are up to date.
export function refreshValidation() {
  setTimeout(() => {
    for (const el of document.querySelectorAll('[data-validated]')) if (el.isConnected && el.willValidate) update(el)
  })
}

// The page's main area (pages inside the app layout)
export const validatePage = () => validateWithin(document.querySelector('.content') ?? document.body)

// For pages that are not a <form>: check every field inside `root`, show the messages and go to the first problem.
// Returns true when everything is valid.
export function validateWithin(root) {
  if (!root) return true
  let ok = true
  for (const el of root.querySelectorAll('input, select, textarea')) {
    if (el.willValidate && !el.checkValidity()) ok = false // fires 'invalid', handled below
  }
  return ok
}

export function installFormValidation() {
  if (window.__formValidationInstalled) return
  window.__formValidationInstalled = true

  // Submit with invalid fields: no bubble, show our message, focus the first problem
  document.addEventListener(
    'invalid',
    (e) => {
      const el = e.target
      if (!isField(el)) return
      e.preventDefault()
      el.dataset.validated = 'true'
      show(el)
      if (!focusedThisRound) {
        focusedThisRound = true
        scrollAndFocus(el)
        setTimeout(() => (focusedThisRound = false))
      }
    },
    true,
  )

  const onEdit = (e) => {
    const el = e.target
    if (!isField(el) || !el.willValidate) return
    el.dataset.touched = 'true'
    refreshValidation()
  }
  document.addEventListener('input', onEdit, true)
  document.addEventListener('change', onEdit, true)

  // Leaving a field the user has typed in checks it, without nagging about fields not reached yet
  document.addEventListener(
    'focusout',
    (e) => {
      const el = e.target
      if (!isField(el) || !el.willValidate || !el.dataset.touched) return
      el.dataset.validated = 'true'
      update(el)
    },
    true,
  )
}
