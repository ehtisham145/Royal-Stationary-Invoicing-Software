// Every word must appear somewhere in the text: "tape 1262" finds "TAPE CHANYI CY1262 200YD"
export function matchesWords(query, ...fields) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}
