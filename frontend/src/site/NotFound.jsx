import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { usePageMeta } from './pieces'

export default function NotFound() {
  usePageMeta('Page not found')

  return (
    <section className="bg-surface-2">
      <div className="site-wrap flex flex-col items-start py-24 md:py-32">
        <p className="site-eyebrow">Error 404</p>
        <h1 className="site-h1 mt-4 max-w-[40rem] text-ink">This page is not on our shelves.</h1>
        <p className="site-lead mt-5">The link may be old or mistyped. Head back to the home page or browse our departments.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/" className="site-btn site-btn-primary">
            <ArrowLeft />
            Back to home
          </Link>
          <Link to="/products" className="site-btn site-btn-outline">
            Browse products
          </Link>
        </div>
      </div>
    </section>
  )
}
