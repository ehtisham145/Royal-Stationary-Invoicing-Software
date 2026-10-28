import { useEffect } from 'react'

// Scroll reveal: any element marked data-reveal="true" starts hidden (see .site [data-reveal] in index.css)
// and fades up into place the first time it scrolls into view. Elements that come into view together
// are staggered, so a row of cards arrives one after another. Each element animates once, then is
// marked "done" so its own hover transitions work normally again.
// Elements added later (filters, search results) are picked up by the MutationObserver.
export function useScrollReveal() {
  useEffect(() => {
    const root = document.querySelector('.site')
    if (!root) return
    const finish = (el) => {
      el.dataset.reveal = 'done'
      el.style.removeProperty('--reveal-delay')
    }

    // No observer support: show everything. Reduced motion is handled in CSS, which never hides them.
    if (!('IntersectionObserver' in window) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const showAll = () => root.querySelectorAll('[data-reveal="true"]').forEach(finish)
      showAll()
      const mo = new MutationObserver(showAll)
      mo.observe(root, { childList: true, subtree: true })
      return () => mo.disconnect()
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries
          .filter((e) => e.isIntersecting)
          .forEach(({ target: el }, i) => {
            io.unobserve(el)
            el.style.setProperty('--reveal-delay', `${Math.min(i, 6) * 90}ms`)
            el.dataset.reveal = 'in'
            const onEnd = (ev) => {
              if (ev.target !== el || ev.propertyName !== 'opacity') return
              el.removeEventListener('transitionend', onEnd)
              finish(el)
            }
            el.addEventListener('transitionend', onEnd)
            setTimeout(() => el.dataset.reveal === 'in' && finish(el), 1500)
          })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    )

    let frame = 0
    const scan = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => root.querySelectorAll('[data-reveal="true"]').forEach((el) => io.observe(el)))
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(root, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      mo.disconnect()
      io.disconnect()
    }
  }, [])
}
