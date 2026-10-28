# Royal Stationers – Build Checklist

Base: the existing React + Vite + Supabase app (previously "Rizwan Global Trader").
Feature IDs (P-01, I-04 …) match the client proposal PDF.

Legend: `[x]` done · `[ ]` pending · **(client)** waiting for client decision

---

## Phase 1 – Core system (built 25 Oct 2026)

### 0. Foundation
- [x] Rebrand to Royal Stationers (name, logo, titles, storage keys)
- [x] Supabase only (remove browser demo/mock mode)
- [x] Fresh database setup file: `backend/supabase/setup.sql` (run once on a new project)
- [x] Load more than 1,000 rows (Supabase page limit) for products / customers / stock
- [x] Removed the old template SQL (Rizwan Global Trader); still in git history before the folder restructure

### 1. Products (P-01 … P-06, P-10)
- [x] Code (auto 6-digit if blank), name, company, brand, category
- [x] Units: Pc, Box, Dozen, Gurus, Carton, Pkt, Roll, Set …
- [x] Carton qty, inner qty, CBM, reorder level
- [x] Sale price with Min / Max
- [x] Company / brand / category: pick existing or type a new one
- [x] Stock shown as cartons + loose
- [x] CSV import with new columns + optional opening stock into a store

### 2. Stores & stock (S-01 … S-04, S-06)
- [x] Store locations (2nd Floor, 3rd Floor, 4th Floor, First Floor, Bahl Store, Basement, Racks), editable
- [x] Every stock change is a ledger movement (no direct stock edits)
- [x] Stock In, Stock Out, Transfer between stores (with entry no.)
- [x] Location-wise stock screen (cartons + loose)
- [x] Negative stock blocked (setting to allow it)
- [x] Product ledger: in / out / running balance, filter by store and date, show in cartons (R-01, R-02)

### 3. Sale invoice (I-01 … I-09)
- [x] One-screen entry: customer, date, Sale/Return, Cash/Credit, Counter/Bilty/Delivery, Bilty no.
- [x] Customer previous balance + balance with this bill
- [x] Product search with stock per store, price and min price
- [x] Last sales of this product to this customer (date, invoice, rate, qty)
- [x] Cartons + loose entry, store chosen per line (auto-picks the store with stock)
- [x] Discount, freight, amount received
- [x] Stock and customer account updated in one database transaction
- [x] Below min price blocked for cashiers (admin can override)
- [x] Print: Normal and Packing slip
- [x] Invoice list with search and filters; admin can delete (stock and account reverse)

### 4. Customers & accounts (A-01, A-03, A-05)
- [x] Customer code, name, city, phones, address, opening balance, credit limit
- [x] Customer ledger with running balance (print)
- [x] Receipts (cash / bank / cheque), list + new
- [x] Balance shown in customer list

### 5. Dashboard (D-01)
- [x] Sales today, this month vs last month (same days)
- [x] Received today, total receivable
- [x] 12-month sales chart (chart / table)
- [x] Top products and top customers (last 30 days)
- [x] Highest balances (who owes most)
- [x] Low stock alerts (at or below reorder level)
- [x] Stock per store summary + negative stock warning
- [x] Recent invoices
- [x] Cashier view: own sales today / this month, quick actions
- [x] Totals calculated in the database (`get_dashboard()`), not in the browser

### 6. Users & settings (SEC-01, SEC-02, SEC-05)
- [x] Four roles: Administrator, Manager, Cashier, Store keeper (`frontend/src/shared/lib/permissions.js`, `has_permission()` in the database)
  - Enforced in the database (RLS + functions), not only hidden in the menu
  - Store keepers cannot read customers, invoices or receipts; get a stock-only dashboard
  - Existing databases: run `backend/supabase/migrations/upgrade_002_four_roles.sql` once, then redeploy `admin-users`
- [x] Business profile (name, address, phones) on prints
- [x] Store locations managed in Settings
- [x] Stock rule: allow / block negative stock

---

### Verification
- [x] `npm run build` passes
- [x] Lint: no undefined / unused variables, hooks order OK
- [x] Database tested on Postgres (PGlite): products, import, stock in / out / transfer, stock + min-price checks, sale, return with refund, receipts, ledger, dashboard, admin delete reversal, cashier permissions
- [ ] Click-through in the browser on a real Supabase project

### Setup (new Supabase project)
1. Create a project, copy URL + publishable key into `.env`
2. SQL Editor → run `backend/supabase/setup.sql` once
3. Authentication → add the first user (becomes admin)
4. Deploy `backend/supabase/functions/admin-users` to manage users from the app
5. `npm run dev`, then Settings → business details, stores

## Phase 2 – Purchase & imports (after client review)

### Containers – Level 1 (built 27 Oct 2026)
- [x] Suppliers list (name, country, contact, currency)
- [x] Container record: number, supplier, invoice/PI no., currency + exchange rate (PI-03)
- [x] Packing list: cartons, qty/ctn, loose, CBM, weight, price; CSV import that matches products and can create missing ones (PI-04)
- [x] Status with dates: Ordered → Shipped → At port → Clearing → Received, ETA, shipping line, B/L (PI-05)
- [x] Expenses + landed cost per piece, shared by CBM / value / cartons; suggested sale price from Settings margin (PI-06, PI-08)
- [x] "On the way" stock on Stock, product ledger and dashboard (PI-07, S-08)
- [x] Receive into stores (split a product over stores, short quantities recorded), container locked after receiving
- [x] Product cost price (separate table, admin/manager only), average cost updated on receiving
- [x] Admin can reopen a received container (stock removed, costs restored) unless the stock is already sold
- [x] Store keeper sees containers and receives them, without prices; cashier sees nothing
- [x] Database tested on Postgres (PGlite): roles, landed cost, average cost, receive, reopen, upgrade path
- Existing databases: run `backend/supabase/migrations/upgrade_004_containers.sql` once, **before** deploying this frontend

### Still to do
- [x] Container lots (Level 2, built 28 Oct 2026): what is left of each container and its profit, first in first out
  - Worked out from stock moves (no extra data): deleting bills, returns and reopening stay correct
  - Container page: "Left" per product + profit card (admin/manager); containers list: % left; product ledger: left per container
  - Existing databases: run `backend/supabase/migrations/upgrade_006_container_lots.sql` once (after 004 containers)
- [x] Mixed containers: supplier per packing list line (blank = container's supplier / agent); CSV `supplier` column
  - Existing databases: run `backend/supabase/migrations/upgrade_007_item_supplier.sql` once
- [x] Delivery trips (built 28 Oct 2026): own staff take bills to customers
  - Pending list of delivery bills, trip = one staff member + several bills, time out / back stamped by the database
  - Delivery slip with customer signature column; manager closes the trip (delivered / came back) and enters cash, which becomes a receipt
  - Store keeper sends trips, manager / admin closes, cancels and manages staff; cashier sees the delivery line on the bill
  - Dashboard: bills waiting (red from earlier days), trips out over 4 hours; history per staff member
  - Existing databases: run `backend/supabase/migrations/upgrade_008_delivery.sql` once
- [ ] Supplier ledger, payments (A-02, A-04)
- [ ] Local purchase invoice (PI-01), purchase return **(client)**
- [ ] Profit report, container report (R-07, R-10)
- [ ] Attach documents (B/L, invoice PDF) to a container

## Phase 3 – Extras (client to choose)
- [ ] Granular permissions per screen (SEC-02 improved), activity log (SEC-04)
- [ ] Quotation / sales order **(client)** (I-13, I-14)
- [ ] WhatsApp / PDF sharing (I-12, A-10)
- [ ] Barcode labels and scanning (P-08)
- [ ] Physical stock count (S-07), cheque register (A-08), expenses (A-09)
- [ ] Thermal 80 mm print (I-15)
- [ ] Multi-business SaaS (one account per shop) – today: one Supabase project per client

## Before go-live
- [ ] Data transfer from old MIS (products, customers, balances, stock) (M-01)
- [ ] Set invoice number to continue after the old software (`setval`)
- [ ] Run the upgrades on the production database, in number order, each once (see `backend/supabase/README.md`):
  - [ ] `upgrade_002_four_roles.sql`
  - [ ] `upgrade_003_cheque_payment.sql`
  - [ ] `upgrade_004_containers.sql`
  - [ ] `upgrade_005_returns_against_invoice.sql`
  - [ ] `upgrade_006_container_lots.sql`
  - [ ] `upgrade_007_item_supplier.sql`
  - [ ] `upgrade_008_delivery.sql`
- [ ] Add delivery staff names (Delivery > Delivery staff)
- [ ] Deploy `admin-users` Edge Function (needed for the new roles)
- [ ] Parallel run + staff training (M-03, M-04)
