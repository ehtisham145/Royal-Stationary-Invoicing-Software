import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { isConfigured } from '../services/supabase'
import { AuthProvider, RequireAuth } from './auth/AuthProvider'
import SiteLayout from '../site/SiteLayout'
import Home from '../site/Home'
import SiteProducts from '../site/SiteProducts'
import Wholesale from '../site/Wholesale'
import About from '../site/About'
import Contact from '../site/Contact'
import NotFound from '../site/NotFound'
import Layout from '../shared/components/Layout'
import Login from './auth/Login'
import Dashboard from '../features/dashboard/Dashboard'
import InvoiceList from '../features/sales/InvoiceList'
import InvoiceForm from '../features/sales/InvoiceForm'
import InvoiceDetail from '../features/sales/InvoiceDetail'
import Receipts from '../features/sales/Receipts'
import Customers from '../features/customers/Customers'
import CustomerLedger from '../features/customers/CustomerLedger'
import Products from '../features/products/Products'
import ProductLedger from '../features/products/ProductLedger'
import Stock from '../features/stock/Stock'
import StockEntries from '../features/stock/StockEntries'
import StockEntryForm from '../features/stock/StockEntryForm'
import Users from '../features/users/Users'
import Suppliers from '../features/containers/Suppliers'
import Containers from '../features/containers/Containers'
import ContainerForm from '../features/containers/ContainerForm'
import ContainerReceive from '../features/containers/ContainerReceive'
import Settings from '../features/settings/Settings'
import Profile from '../features/users/Profile'

const only = (permission, el) => <RequireAuth permission={permission}>{el}</RequireAuth>

function ConfigMissing() {
  return (
    <div className="screen-center">
      <div className="card config-card">
        <h2>Supabase not configured</h2>
        <p className="text-secondary">
          Copy <code>.env.example</code> to <code>.env</code>, fill in your Supabase URL and publishable key, run <code>backend/supabase/setup.sql</code> in the SQL Editor, then restart{' '}
          <code>npm run dev</code>.
        </p>
      </div>
    </div>
  )
}

// Login and the software need Supabase; the public website does not
function AuthShell() {
  if (!isConfigured) return <ConfigMissing />
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public website */}
      <Route element={<SiteLayout />}>
        <Route index element={<Home />} />
        <Route path="products" element={<SiteProducts />} />
        <Route path="wholesale" element={<Wholesale />} />
        <Route path="about" element={<About />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Staff software */}
      <Route element={<AuthShell />}>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="invoices" element={only('sales', <InvoiceList />)} />
          <Route path="invoices/new" element={only('sales', <InvoiceForm />)} />
          <Route path="invoices/:id" element={only('sales', <InvoiceDetail />)} />
          <Route path="receipts" element={only('sales', <Receipts />)} />
          <Route path="customers" element={only('sales', <Customers />)} />
          <Route path="customers/:id" element={only('sales', <CustomerLedger />)} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id/ledger" element={<ProductLedger />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/entries" element={only('stock.manage', <StockEntries />)} />
          <Route path="stock/new" element={only('stock.manage', <StockEntryForm />)} />
          <Route path="containers" element={only('containers.view', <Containers />)} />
          <Route path="containers/new" element={only('containers.manage', <ContainerForm />)} />
          <Route path="containers/:id" element={only('containers.view', <ContainerForm />)} />
          <Route path="containers/:id/receive" element={only('containers.receive', <ContainerReceive />)} />
          <Route path="suppliers" element={only('containers.manage', <Suppliers />)} />
          <Route path="users" element={only('users', <Users />)} />
          <Route path="settings" element={only('settings', <Settings />)} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
