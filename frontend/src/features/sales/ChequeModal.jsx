import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { ErrorBanner, Modal } from '../../shared/components/ui'

const MAX_SIZE = 5 * 1024 * 1024 // matches the 'cheques' bucket limit

// Asks for a photo of the cheque; a cheque payment can't be chosen without one.
export default function ChequeModal({ file: initial, onClose, onDone }) {
  const [file, setFile] = useState(initial ?? null)
  const [preview, setPreview] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!file) return setPreview('')
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function pick(f) {
    if (!f) return
    setError('')
    if (!f.type.startsWith('image/')) return setError('Please choose a photo (JPG, PNG or WEBP).')
    if (f.size > MAX_SIZE) return setError('The photo is too large. Maximum size is 5 MB.')
    setFile(f)
  }

  return (
    <Modal
      title="Cheque photo"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => (file ? onDone(file) : setError('Choose a photo of the cheque first.'))}>
            Use this photo
          </button>
        </>
      }
    >
      <p className="text-secondary modal-intro">A photo of the cheque is required for cheque payments.</p>
      <ErrorBanner message={error} />

      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${preview ? 'dropzone-preview' : ''} ${error && !file ? 'dropzone-invalid' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            pick(e.target.files[0])
            e.target.value = ''
          }}
        />
        {preview ? (
          <>
            <img src={preview} alt="Cheque" className="cheque-preview" />
            <div className="text-muted">{file.name} · click to change</div>
          </>
        ) : (
          <>
            <div className="empty-icon">
              <Camera size={20} strokeWidth={1.8} />
            </div>
            <div className="strong">Drop the cheque photo here, or click to choose</div>
            <div className="text-muted">JPG, PNG or WEBP · up to 5 MB</div>
          </>
        )}
      </div>
    </Modal>
  )
}
