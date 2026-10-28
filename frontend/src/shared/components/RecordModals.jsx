import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteCustomer, deleteProduct, deleteSupplier, listLookups, saveCustomer, saveProduct, saveSupplier } from '../../services/api'
import { CURRENCIES } from '../lib/format'
import { CUSTOMER_FIELDS, EMPTY_CUSTOMER, customerRow, validateCustomer } from '../lib/customerFields'
import { EMPTY_PRODUCT, PRODUCT_FIELDS, productForm, validateProduct } from '../lib/productFields'
import { useAuth } from '../../app/auth/AuthProvider'
import { ErrorBanner, Field, Modal } from './ui'

const filled = (v) => String(v ?? '').trim() !== ''

// Shared create/edit/delete modal. `onSaved(record)` after save, `onDeleted(id)` after delete.
// `suggestions` = { [field.suggest]: [names] } for type-or-pick fields.
function RecordModal({ title, initial, fields, save, remove, validate, suggestions = {}, wide, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef(null)
  const isEdit = Boolean(initial.id)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  // Required fields are checked by the browser (see shared/lib/formValidation); this runs once they are filled
  const handleSave = (e) => {
    e.preventDefault()
    const blank = fields.find((f) => f.required && !filled(form[f.key]))
    const problem = blank ? `${blank.label} cannot be only spaces.` : validate?.(form)
    if (problem) {
      setError(problem)
      formRef.current?.closest('.modal-body')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    run(async () => onSaved(await save(form)))
  }

  const handleDelete = () => {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    run(async () => {
      await remove(initial.id)
      onDeleted?.(initial.id)
    })
  }

  return (
    <Modal
      title={`${isEdit ? 'Edit' : 'New'} ${title}`}
      onClose={onClose}
      wide={wide}
      footer={
        <>
          {isEdit && remove && (
            <button type="button" className="btn btn-danger-ghost mr-auto" onClick={handleDelete} disabled={busy}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="record-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <form ref={formRef} id="record-form" className={`form-grid ${wide ? 'form-grid-3' : ''}`} onSubmit={handleSave}>
        {fields.map((f) => {
          const listId = f.suggest ? `suggest-${f.key}` : undefined
          const props = {
            className: 'input',
            required: f.required,
            autoFocus: f.autoFocus,
            placeholder: f.placeholder,
            value: form[f.key] ?? '',
            onChange: set(f.key),
          }
          return (
            <div key={f.key} className={f.full ? 'span-all' : ''}>
              <Field
                label={
                  <>
                    {f.label}
                    {!f.required && <span className="optional"> (optional)</span>}
                  </>
                }
              >
                {f.textarea ? (
                  <textarea rows={2} {...props} />
                ) : f.options ? (
                  <select {...props}>
                    {/* keep an older value that is no longer in the list */}
                    {[...new Set([...(form[f.key] ? [form[f.key]] : []), ...f.options])].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      type={f.type === 'number' ? 'text' : (f.type ?? 'text')}
                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                      data-signed={f.signed ? 'true' : undefined}
                      list={listId}
                      autoComplete={f.suggest ? 'off' : undefined}
                      {...props}
                    />
                    {listId && (
                      <datalist id={listId}>
                        {(suggestions[f.suggest] ?? []).map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    )}
                  </>
                )}
                {f.hint && <span className="field-note">{f.hint}</span>}
              </Field>
            </div>
          )
        })}
      </form>
    </Modal>
  )
}

export function CustomerModal({ customer, ...props }) {
  const { can } = useAuth()
  const fields = CUSTOMER_FIELDS.filter((f) => !f.manageOnly || can('customers.manage'))
  const initial = customer
    ? Object.fromEntries([['id', customer.id], ...CUSTOMER_FIELDS.map(({ key }) => [key, customer[key] ?? ''])])
    : EMPTY_CUSTOMER
  return (
    <RecordModal
      title="customer"
      initial={initial}
      fields={fields}
      validate={validateCustomer}
      save={(form) => saveCustomer(customerRow(form, fields), form.id)}
      remove={can('delete') ? deleteCustomer : null}
      {...props}
    />
  )
}

// `existing` = current products, used to block duplicate names / codes before saving
export function ProductModal({ product, existing = [], ...props }) {
  const { can } = useAuth()
  const [suggestions, setSuggestions] = useState({})
  useEffect(() => {
    listLookups().then(setSuggestions).catch(() => {})
  }, [])

  return (
    <RecordModal
      title="product"
      wide
      initial={product ? { id: product.id, ...productForm(product) } : EMPTY_PRODUCT}
      fields={PRODUCT_FIELDS}
      suggestions={suggestions}
      validate={(f) => validateProduct(f, existing)}
      save={saveProduct}
      remove={can('delete') ? deleteProduct : null}
      {...props}
    />
  )
}

const SUPPLIER_FIELDS = [
  { key: 'name', label: 'Name', required: true, autoFocus: true, full: true, placeholder: 'e.g. Yiwu Ruya Trade' },
  { key: 'country', label: 'Country', placeholder: 'e.g. China' },
  { key: 'city', label: 'City', placeholder: 'e.g. Yiwu' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'phone', label: 'Phone / WeChat', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'currency', label: 'Currency', required: true, options: CURRENCIES },
  { key: 'notes', label: 'Notes', textarea: true, full: true },
]

const EMPTY_SUPPLIER = { ...Object.fromEntries(SUPPLIER_FIELDS.map(({ key }) => [key, ''])), currency: 'USD' }

export function SupplierModal({ supplier, ...props }) {
  const { can } = useAuth()
  const initial = supplier
    ? Object.fromEntries([['id', supplier.id], ...SUPPLIER_FIELDS.map(({ key }) => [key, supplier[key] ?? ''])])
    : EMPTY_SUPPLIER
  const row = (f) => Object.fromEntries(SUPPLIER_FIELDS.map(({ key }) => [key, String(f[key] ?? '').trim() || null]))
  return (
    <RecordModal
      title="supplier"
      initial={initial}
      fields={SUPPLIER_FIELDS}
      save={(form) => saveSupplier(row(form), form.id)}
      remove={can('delete') ? deleteSupplier : null}
      {...props}
    />
  )
}
