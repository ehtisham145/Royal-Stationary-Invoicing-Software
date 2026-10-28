import { useEffect } from 'react'
import { refreshValidation } from '../lib/formValidation'
import { AlertCircle, Ban, Banknote, CheckCircle2, Clock, Landmark, ReceiptText, RotateCcw, X } from 'lucide-react'

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

const STATUS = {
  active: { label: 'Active', cls: 'good', icon: CheckCircle2 },
  inactive: { label: 'Inactive', cls: 'neutral', icon: Ban },
}

// Status always carries an icon + label, never color alone
export function StatusBadge({ status }) {
  const s = STATUS[status] ?? { label: status, cls: 'neutral', icon: Clock }
  const Icon = s.icon
  return (
    <span className={`status status-${s.cls}`}>
      <Icon size={13} strokeWidth={2.2} />
      {s.label}
    </span>
  )
}

// Sale / return and cash / credit, always icon + label
const SALE_BADGES = {
  cash: { Icon: Banknote, tone: 'status-good', label: 'Cash sale' },
  cheque: { Icon: Landmark, tone: 'status-good', label: 'Cheque sale' },
  credit: { Icon: ReceiptText, tone: 'status-info', label: 'Credit sale' },
}

export function TxnBadge({ type, mode }) {
  if (type === 'return') {
    return (
      <span className="status status-warning">
        <RotateCcw size={13} strokeWidth={2.2} />
        Return
      </span>
    )
  }
  const { Icon, tone, label } = SALE_BADGES[mode] ?? SALE_BADGES.credit
  return (
    <span className={`status ${tone}`}>
      <Icon size={13} strokeWidth={2.2} />
      {label}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="empty-icon">
          <Icon size={20} strokeWidth={1.8} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {text && <p className="text-secondary">{text}</p>}
      {action}
    </div>
  )
}

export function ErrorBanner({ message }) {
  if (!message) return null
  return (
    <div className="alert">
      <AlertCircle size={16} />
      <span>{message}</span>
    </div>
  )
}

export function Loading() {
  return (
    <div className="loading">
      <div className="spinner" />
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// `required` marks controls that are not inputs (pickers, buttons) with the red *.
// Inputs with the `required` attribute get the * on their own (CSS).
export function Field({ label, hint, required = false, children }) {
  return (
    <label className={`field ${required ? 'field-required' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

// Lets something that is not an input (a customer picker, a photo button, a product list) take part
// in form validation. Put it last inside the Field. Invalid while `value` is empty, with `message`.
export function RequiredProxy({ value, message }) {
  const filled = Boolean(value)
  useEffect(() => refreshValidation(), [filled])
  return (
    <input
      className="validation-proxy"
      tabIndex={-1}
      aria-hidden="true"
      required
      value={filled ? '1' : ''}
      onChange={() => {}}
      ref={(el) => el?.setCustomValidity(filled || !message ? '' : message)}
    />
  )
}
