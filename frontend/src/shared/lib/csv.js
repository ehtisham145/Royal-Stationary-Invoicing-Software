// CSV files that open correctly in Excel (UTF-8 with BOM, quoted where needed).

const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n')

export function downloadCsv(fileName, rows) {
  const text = typeof rows === 'string' ? rows : toCsv(rows)
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

// "Imran Stationers (DG Khan)" -> "imran-stationers-dg-khan", for file names
export const slug = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
