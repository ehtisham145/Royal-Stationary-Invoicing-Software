import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react'
import { importProducts } from '../../services/api'
import { TEMPLATE_CSV, readImport } from '../../shared/lib/productFields'
import { money, num } from '../../shared/lib/format'
import { ErrorBanner, Field, Modal } from '../../shared/components/ui'

const PREVIEW_MAX = 500

function downloadTemplate() {
  const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'products-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function ProductImport({ existing, locations, onClose, onImported }) {
  const inputRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)

  const valid = rows?.filter((r) => r.errors.length === 0) ?? []
  const invalid = rows?.filter((r) => r.errors.length > 0) ?? []
  const withStock = valid.filter((r) => Number(String(r.form.stock).replace(/,/g, '')) !== 0 && r.form.stock !== '')

  async function readFile(file) {
    if (!file) return
    setError('')
    setRows(null)
    if (!/\.csv$/i.test(file.name)) {
      setError('Please choose a .csv file. In Excel: File → Save As → CSV (Comma delimited).')
      return
    }
    setFileName(file.name)
    const result = readImport(await file.text(), existing)
    if (result.error) setError(result.error)
    else if (!result.rows.length) setError('No product rows found under the header.')
    else setRows(result.rows)
  }

  async function handleImport() {
    if (withStock.length && !locationId) {
      setError('Choose the store for the opening stock.')
      return
    }
    setBusy(true)
    setError('')
    try {
      onImported(await importProducts(valid.map((r) => r.form), locationId, setProgress))
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  // Invalid rows first, so problems are visible without scrolling
  const preview = rows ? [...invalid, ...valid].slice(0, PREVIEW_MAX) : []

  return (
    <Modal
      title="Import products"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost mr-auto" onClick={downloadTemplate}>
            <Download size={16} /> Download template
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={busy || valid.length === 0}>
            <Upload size={16} />
            {busy ? `Importing… ${num(progress)} / ${num(valid.length)}` : `Import ${valid.length ? num(valid.length) : ''} product${valid.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />

      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          readFile(e.dataTransfer.files[0])
        }}
      >
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
        <div className="strong">{fileName || 'Drop a CSV file here, or click to choose'}</div>
        <div className="text-muted">
          Required: <b>name</b>, <b>price</b> · Optional: code, unit, company, brand, category, carton qty, inner qty, min price, max price, reorder level, cbm, stock
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
                <AlertCircle size={13} /> {num(invalid.length)} with errors (will be skipped)
              </span>
            )}
          </div>

          {withStock.length > 0 && (
            <div className="import-location">
              <Field label={`Opening stock for ${num(withStock.length)} product${withStock.length === 1 ? '' : 's'} goes into`}>
                <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Choose a store…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <div className="import-table">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Company</th>
                  <th className="num">Ctn qty</th>
                  <th className="num">Price</th>
                  <th className="num">Stock</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'row-error' : ''}>
                    <td className="text-muted">{r.line}</td>
                    <td className="mono">{r.form.code || 'auto'}</td>
                    <td className="strong">{r.form.name || '—'}</td>
                    <td>{r.form.unit}</td>
                    <td>{r.form.company || '—'}</td>
                    <td className="num">{r.form.carton_qty}</td>
                    <td className="num">{r.form.price === '' ? '—' : money(String(r.form.price).replace(/,/g, ''))}</td>
                    <td className="num">{r.form.stock || 0}</td>
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
          {rows.length > PREVIEW_MAX && <p className="text-muted import-more">Preview shows {PREVIEW_MAX} of {num(rows.length)} rows.</p>}
        </>
      )}
    </Modal>
  )
}
