import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileUp, PackagePlus, Upload } from 'lucide-react'
import { importProducts, listProducts } from '../../services/api'
import { PACKING_TEMPLATE_CSV, readPackingList } from './containerUtils'
import { num } from '../../shared/lib/format'
import { downloadCsv } from '../../shared/lib/csv'
import { useAuth } from '../../app/auth/AuthProvider'
import { ErrorBanner, Modal } from '../../shared/components/ui'

// Reads a packing list CSV, matches rows to products and hands the good rows to `onImport(rows)`.
// Rows with an unknown product can be created as new products first (needs 'products.manage').
export default function PackingListImport({ products, suppliers = [], onProducts, onImport, onClose }) {
  const { can } = useAuth()
  const inputRef = useRef(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = rows?.filter((r) => r.errors.length === 0) ?? []
  const invalid = rows?.filter((r) => r.errors.length > 0) ?? []
  // Unknown products that only fail because they don't exist yet
  const creatable = invalid.filter((r) => !r.product && r.name && r.errors.length === 1)

  function read(csv, list) {
    const result = readPackingList(csv, list, suppliers)
    if (result.error) setError(result.error)
    else if (!result.rows.length) setError('No rows found under the header.')
    else setRows(result.rows)
  }

  async function readFile(file) {
    if (!file) return
    setError('')
    setRows(null)
    if (!/\.csv$/i.test(file.name)) {
      setError('Please choose a .csv file. In Excel: File → Save As → CSV (Comma delimited).')
      return
    }
    const csv = await file.text()
    setFileName(file.name)
    setText(csv)
    read(csv, products)
  }

  async function createMissing() {
    setBusy(true)
    setError('')
    try {
      // Sale price 0 for now: set it on the product once the landed cost is known
      await importProducts(
        creatable.map((r) => ({ name: r.name, code: r.code, unit: 'Pc', carton_qty: r.carton_qty, cbm: r.cbm, price: 0 })),
        null,
      )
      const fresh = await listProducts()
      onProducts(fresh)
      read(text, fresh)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <Modal
      title="Import packing list"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost mr-auto" onClick={() => downloadCsv('packing-list-template.csv', PACKING_TEMPLATE_CSV)}>
            <Download size={16} /> Download template
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onImport(valid)} disabled={busy || valid.length === 0}>
            <Upload size={16} /> Add {valid.length ? num(valid.length) : ''} line{valid.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />

      <div className="dropzone" onClick={() => inputRef.current?.click()}>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            readFile(e.target.files[0])
            e.target.value = ''
          }}
        />
        <div className="empty-icon">
          <FileUp size={20} strokeWidth={1.8} />
        </div>
        <div className="strong">{fileName || 'Click to choose the packing list (CSV)'}</div>
        <div className="text-muted">
          Required: <b>code</b> or <b>name</b>, <b>cartons</b> · Optional: carton qty, loose, cbm, price (per piece, in the container currency), supplier
        </div>
      </div>

      {rows && (
        <>
          <div className="import-summary">
            <span className="status status-good">
              <CheckCircle2 size={13} /> {num(valid.length)} ready
            </span>
            {invalid.length > 0 && (
              <span className="status status-critical">
                <AlertCircle size={13} /> {num(invalid.length)} with problems (will be skipped)
              </span>
            )}
            {creatable.length > 0 && can('products.manage') && (
              <button className="btn btn-secondary btn-sm" onClick={createMissing} disabled={busy}>
                <PackagePlus size={16} /> {busy ? 'Creating…' : `Create ${num(creatable.length)} new product${creatable.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>

          <div className="import-table">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Product</th>
                  <th className="num">Cartons</th>
                  <th className="num">Qty/ctn</th>
                  <th className="num">CBM</th>
                  <th className="num">Price</th>
                  <th>Supplier</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {[...invalid, ...valid].map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'row-error' : ''}>
                    <td className="text-muted">{r.line}</td>
                    <td>
                      <div className="cell-stack">
                        <span className="strong">{r.product?.name ?? (r.name || '—')}</span>
                        <span className="text-muted">{r.product?.code ?? (r.code || '')}</span>
                      </div>
                    </td>
                    <td className="num">{r.cartons || 0}</td>
                    <td className="num">{r.carton_qty}</td>
                    <td className="num">{r.cbm || '—'}</td>
                    <td className="num">{r.unit_price || '—'}</td>
                    <td className="text-secondary">{r.supplier_name || 'Same as container'}</td>
                    <td>
                      {r.errors.length ? (
                        <span className="import-error">{r.errors.join(' · ')}</span>
                      ) : (
                        <span className="import-ok">
                          <CheckCircle2 size={14} /> OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}
