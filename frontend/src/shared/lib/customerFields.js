// Customer (client / party) fields. `manageOnly` fields need the 'customers.manage' permission.
export const CUSTOMER_FIELDS = [
  { key: 'name', label: 'Name', required: true, autoFocus: true, full: true, placeholder: 'e.g. Imran Stationers' },
  { key: 'city', label: 'City', placeholder: 'e.g. Dg Khan' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'phone', label: 'Phone', type: 'tel', placeholder: '03xx xxxxxxx' },
  { key: 'phone2', label: 'Phone 2', type: 'tel' },
  { key: 'opening_balance', label: 'Opening balance (Rs)', type: 'number', manageOnly: true, signed: true, hint: 'Amount the customer already owes. Use minus if you owe them.' },
  { key: 'credit_limit', label: 'Credit limit (Rs)', type: 'number', manageOnly: true, placeholder: '0 = no limit' },
  { key: 'ntn', label: 'NTN' },
  { key: 'address', label: 'Address', textarea: true, full: true },
  { key: 'notes', label: 'Notes', textarea: true, full: true },
]

const NUMERIC = ['opening_balance', 'credit_limit']

const clean = (v) => (typeof v === 'string' ? v.trim() : v) || null
const toNumber = (v) => Number(String(v ?? '').replace(/,/g, '').trim() || 0)

// The row written to the database. Fields the user cannot see are left out, so they keep their value.
export const customerRow = (f, fields = CUSTOMER_FIELDS) =>
  Object.fromEntries(fields.map(({ key }) => [key, NUMERIC.includes(key) ? toNumber(f[key]) : clean(f[key])]))

export const EMPTY_CUSTOMER = Object.fromEntries(CUSTOMER_FIELDS.map(({ key }) => [key, '']))

export function validateCustomer(f) {
  for (const k of NUMERIC) {
    if (f[k] === undefined) continue
    const n = toNumber(f[k])
    if (!Number.isFinite(n)) return 'Balances must be numbers.'
    if (k === 'credit_limit' && n < 0) return 'Credit limit cannot be negative.'
  }
  return ''
}

export const customerLabel = (c) => (c ? `${c.name}${c.city ? ` (${c.city})` : ''}` : '')
