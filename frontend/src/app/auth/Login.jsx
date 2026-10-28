import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Boxes, Check, Eye, EyeOff, Lock, Mail, ReceiptText, Wallet } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { getRemember, getRememberedEmail, setRemember, setRememberedEmail } from '../../services/supabase'
import { ErrorBanner } from '../../shared/components/ui'
import { Logo } from '../../shared/components/Logo'

export default function Login() {
  const { user, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(getRememberedEmail)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRememberState] = useState(getRemember)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const from = location.state?.from?.pathname || '/app'
  if (!loading && user) return <Navigate to={from} replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    // Must be set before sign-in so the session is written to the right storage
    setRemember(remember)
    const { error } = await signIn(email.trim(), password)
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
      setBusy(false)
      return
    }
    setRememberedEmail(remember ? email.trim() : '')
    navigate(from, { replace: true })
  }

  return (
    <div className="login">
      <section className="login-aside">
        <div className="login-brand">
          <Logo light size={46} sub="Sales & Stock" />
        </div>

        <div className="login-pitch">
          <h2>Invoices, stock and accounts, in one place.</h2>
          <p>Bill customers in cartons and loose, track stock in every store, and know who owes what.</p>
          <ul>
            <li>
              <ReceiptText size={18} /> Sale invoices with bilty, packing slip and price history
            </li>
            <li>
              <Boxes size={18} /> Stock in every floor and store
            </li>
            <li>
              <Wallet size={18} /> Customer ledgers, receipts and balances
            </li>
          </ul>
        </div>

        <div className="login-foot">
          © {new Date().getFullYear()} Royal Stationers
          <Link to="/" className="login-site-link">Back to website</Link>
        </div>
      </section>

      <section className="login-main">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-mobile-logo">
            <Logo stacked size={64} />
          </div>
          <h1>Welcome back</h1>
          <p className="text-secondary">Sign in to your account to continue.</p>
          <Link to="/" className="back-link login-back">Back to website</Link>

          <ErrorBanner message={error} />

          <label className="field">
            <span className="field-label">Email</span>
            <div className="input-icon">
              <Mail size={16} />
              <input
                className="input"
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <div className="input-icon">
              <Lock size={16} />
              <input
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="input-suffix"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <label className="checkbox">
            <input type="checkbox" checked={remember} onChange={(e) => setRememberState(e.target.checked)} />
            <span className="checkbox-box" aria-hidden="true">
              <Check size={12} strokeWidth={3.2} />
            </span>
            <span>Remember me</span>
          </label>

          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-note">Accounts are created by your administrator.</p>
        </form>
      </section>
    </div>
  )
}
