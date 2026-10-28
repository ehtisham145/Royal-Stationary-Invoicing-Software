// The Royal Stationers crown, drawn as SVG so it stays sharp at any size and in print.
// Single colour (currentColor), set by .logo .crown / .logo-light .crown in index.css.
export function Crown({ size = 32, className = '' }) {
  return (
    <svg className={`crown ${className}`} width={size} height={(size * 44) / 64} viewBox="0 0 64 44" aria-hidden="true">
      <path d="M5 13 L14 27 L18 11 L25 25 L32 5 L39 25 L46 11 L50 27 L59 13 L54 35 H10 Z" fill="currentColor" />
      <rect x="10" y="37" width="44" height="5" rx="1.5" fill="currentColor" />
      {[
        [5, 12],
        [18, 9],
        [32, 4],
        [46, 9],
        [59, 12],
      ].map(([cx, cy]) => (
        <circle key={cx} cx={cx} cy={cy} r="3.2" fill="currentColor" />
      ))}
    </svg>
  )
}

// Crown + "ROYAL / STATIONERS". `stacked` puts the crown above the name, like the printed logo.
export function Logo({ size = 34, stacked = false, light = false, sub }) {
  return (
    <div className={`logo ${stacked ? 'logo-stacked' : ''} ${light ? 'logo-light' : ''}`}>
      <Crown size={size} />
      <div className="logo-text">
        <span className="logo-royal">ROYAL</span>
        <span className="logo-stationers">STATIONERS</span>
        {sub && <span className="logo-sub">{sub}</span>}
      </div>
    </div>
  )
}
