// Turns stock_levels rows into a per-product index:
// { [product_id]: { total, byLocation: { [location_id]: qty } } }
export function stockIndex(levels) {
  const index = {}
  for (const { product_id, location_id, qty } of levels) {
    const entry = (index[product_id] ??= { total: 0, byLocation: {} })
    entry.byLocation[location_id] = Number(qty)
    entry.total += Number(qty)
  }
  return index
}

export const EMPTY_STOCK = { total: 0, byLocation: {} }


// Store with the most stock of this product, or the first store when none has any
export function bestLocation(stock, locations) {
  let best = locations[0]?.id ?? ''
  let max = 0
  for (const l of locations) {
    const q = stock?.byLocation[l.id] ?? 0
    if (q > max) {
      max = q
      best = l.id
    }
  }
  return best
}
