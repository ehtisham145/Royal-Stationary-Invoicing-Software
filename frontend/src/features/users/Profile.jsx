import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, KeyRound, LogOut, Minus } from 'lucide-react'
import { getProfile } from '../../services/api'
import { formatDate, initials } from '../../shared/lib/format'
import { ROLES, ROLE_LABELS } from '../../shared/lib/permissions'
import { useAuth } from '../../app/auth/AuthProvider'
import { ErrorBanner, Loading, PageHeader } from '../../shared/components/ui'

// What each permission means to the person reading their profile
const ACCESS = [
  { permission: 'sales', label: 'Sale invoices, returns and receipts' },
  { permission: 'price.override', label: 'Sell below the minimum price' },
  { permission: 'customers.manage', label: 'Edit customers, opening balance and credit limit' },
  { permission: 'products.manage', label: 'Add and edit products' },
  { permission: 'stock.manage', label: 'Stock in, stock out and transfers' },
  { permission: 'containers.view', label: 'See containers' },
  { permission: 'containers.receive', label: 'Receive containers into stores' },
  { permission: 'containers.manage', label: 'Create containers and suppliers' },
  { permission: 'costs', label: 'See cost prices and landed cost' },
  { permission: 'reports', label: 'Business-wide dashboard and reports' },
  { permission: 'delete', label: 'Delete records' },
  { permission: 'users', label: 'Manage users and passwords' },
  { permission: 'settings', label: 'Change business settings' },
]

export default function Profile() {
  const { user, can, signOut } = useAuth()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getProfile(user.id).then(setProfile).catch((e) => setError(e.message))
  }, [user.id])

  const role = ROLES.find((r) => r.value === user.role)

  return (
    <>
      <PageHeader title="My profile" subtitle="Your account and what you can do in the software." />
      <ErrorBanner message={error} />

      <div className="settings">
        <div className="card">
          {!profile && !error ? (
            <Loading />
          ) : (
            <div className="profile-head">
              <div className="avatar avatar-lg">{initials(user.name || user.email)}</div>
              <div className="cell-stack">
                <h2>{user.name}</h2>
                <span className="text-secondary">{user.email}</span>
                <span>
                  <span className={`role-pill role-${user.role}`}>{ROLE_LABELS[user.role] ?? user.role}</span>
                </span>
                {profile?.created_at && <span className="text-muted">Member since {formatDate(profile.created_at.slice(0, 10))}</span>}
              </div>
            </div>
          )}

          <div className="card-head card-head-tight profile-access-head">
            <div>
              <h3>Your access</h3>
              <p className="text-secondary">{role?.text}</p>
            </div>
          </div>
          <ul className="access-list">
            {ACCESS.map((a) => {
              const allowed = can(a.permission)
              return (
                <li key={a.permission} className={allowed ? '' : 'text-muted'}>
                  {allowed ? <Check size={16} className="text-good" /> : <Minus size={16} />}
                  {a.label}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="dash-stack">
          <div className="card">
            <div className="card-head card-head-tight">
              <div>
                <h3>Password</h3>
                <p className="text-secondary">Passwords are set by an administrator.</p>
              </div>
            </div>
            {can('users') ? (
              <>
                <p className="text-secondary">Change your own or anyone else's password from the Users page.</p>
                <Link to="/app/users" className="btn btn-secondary">
                  <KeyRound size={16} /> Open Users
                </Link>
              </>
            ) : (
              <p className="text-secondary">Forgot your password, or want a new one? Ask an administrator to set it for you.</p>
            )}
          </div>

          <div className="card">
            <div className="card-head card-head-tight">
              <div>
                <h3>Sign out</h3>
                <p className="text-secondary">On a shared computer, always sign out when you leave.</p>
              </div>
            </div>
            <button className="btn btn-secondary" onClick={signOut}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
