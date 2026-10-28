# Royal Stationers POS

Billing, stock and import software for Royal Stationers, a wholesale stationery business that buys from China (mostly Yiwu) and sells to shops across the region. It replaces their old desktop MIS, which only worked on the shop computer and kept container sheets on paper.

There are two parts in this repo:

- **The public website** at `/` (home, products, wholesale, about, contact). No login.
- **The staff software** at `/app`. Login required. This is where invoices, stock, customers and containers live.

Both are one React app. Data lives in Supabase (Postgres + Auth + Storage), and the live site is deployed on Vercel.

Built by **Ehtisham** and **Ali Raza**.

---

## What it does

**Sales**
- Sale invoice on one screen: customer, cartons + loose pieces, store per line, discount, freight, cash / credit / cheque (with a photo of the cheque).
- Returns, linked to the original invoice so you can't return more than was sold.
- Two prints for every bill: the normal invoice for the customer, and a packing slip (no prices, grouped by store) for the godown.
- Customer ledger with running balance, receipts (cash / bank / cheque), credit limits.
- "Products bought" per customer, and Excel (CSV) export of invoices and ledgers.

**Stock**
- Several store locations (floors, basement, racks). Every stock change is a movement in a ledger, nothing is edited directly.
- Stock in, stock out, transfer between stores. Negative stock is blocked unless switched on in Settings.
- Quantities shown as cartons + loose ("12 ctn + 4 Pc"), because that is how the shop counts.
- Product ledger with in / out / balance per store and date.

**Imports (containers)**
- Suppliers, containers and their packing lists (with CSV import from the supplier's sheet).
- Mixed containers: the container has a supplier / agent, and any line can name its own supplier.
- Status: Ordered, On the way, Received. Goods on the way show on the Stock screen but can't be sold.
- Import costs (freight, duty, clearing, other) are spread over the products by CBM, or by value when CBM is missing, to get the landed cost per piece.
- Receiving puts the goods into stores and updates each product's average cost.
- First in, first out: for every received container you can see how much is left and what profit it made.

**Delivery**
- Our own staff take bills to customers. A sale with delivery "Delivery" waits on the Delivery screen until the store keeper sends it out on a trip with one staff member.
- The time out and time back are stamped by the database, nobody types them. A delivery slip is printed for the customer to sign.
- When the staff member is back, a manager closes the trip: each bill is delivered or came back (back to waiting), and any cash collected becomes a receipt in that customer's account with the staff member's name on it.
- Dashboard shows bills still waiting (red if from an earlier day) and trips out for more than 4 hours. History shows trips, deliveries and cash per staff member.

**Everything else**
- Dashboard (whole business for admin / manager, own sales for cashiers, stock only for store keepers).
- Four roles, users and passwords managed by the admin.
- Inline form validation: red * on required fields, the message under the field, and the page scrolls to the first problem on save.

---

## Roles

| | Admin | Manager | Cashier | Store keeper |
|---|:-:|:-:|:-:|:-:|
| Invoices, returns, receipts | yes | yes | yes | no |
| Sell below min price | yes | yes | no | no |
| Edit customers, credit limit | yes | yes | no | no |
| Products | yes | yes | view | view |
| Stock in / out / transfer | yes | yes | no | yes |
| Containers | yes | yes | no | view + receive, no prices |
| Delivery: send bills out | yes | yes | no | yes |
| Delivery: close trip, cash, staff list | yes | yes | no | no |
| Cost price, landed cost, profit | yes | yes | no | no |
| Delete anything | yes | no | no | no |
| Users, settings | yes | no | no | no |

The rules are enforced in the database (`has_permission()` + row level security), not only by hiding buttons. The same table lives in `frontend/src/shared/lib/permissions.js` for the UI. If you change one, change the other, and the role list in `backend/supabase/functions/admin-users`.

Passwords are never shown to anyone. The admin sets a password (or generates one) from **Users**, sees it once, and gives it to the person.

---

## Tech

- React 19 + Vite, React Router
- Plain CSS in `src/index.css` for the software, Tailwind for the public website
- Supabase: Postgres, Auth, Storage (cheque photos), one Edge Function (`admin-users`)
- Recharts for the dashboard chart, lucide-react for icons
- Vercel for hosting (`frontend/vercel.json` sends every route to `index.html`)

Most of the business logic sits in the database as SQL functions (`create_invoice`, `post_stock_entry`, `receive_container`, ...). The frontend calls them through `frontend/src/services/supabaseApi.js`. Doing it this way means a bill, its stock movements and the customer's balance are saved in one transaction, or not at all.

---

## Running it locally

You need Node 20+ (we use 24) and a Supabase project.

```bash
cd frontend
npm install
cp .env.example .env     # then fill it in, see below
npm run dev
```

Open http://localhost:5173 for the website and http://localhost:5173/app for the software.

### .env

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

Both are in Supabase under **Connect** (or Project Settings > API Keys). The names must start with `VITE_`. Supabase's own snippet uses `NEXT_PUBLIC_...`, which Vite ignores, and you get a "Supabase not configured" screen.

**Use a separate Supabase project for local work.** If `.env` points at production, every test bill you make is a real bill.

### First login

There is no sign-up page. Create the first user in Supabase: **Authentication > Users > Add user**, tick *Auto Confirm User*. The very first user becomes the admin. After that, add everyone else from **Users** inside the app (that needs the Edge Function below).

---

## Database

Everything is in `backend/supabase/`. The short version (details in `backend/supabase/README.md`):

- **New project:** run `setup.sql` once in the SQL Editor. That's all.
- **Existing database:** run the `upgrade_00X_*.sql` files you haven't run yet, in number order, each once. They are safe to run twice by mistake.

| File | Adds |
|---|---|
| `upgrade_002_four_roles.sql` | Admin, Manager, Cashier, Store keeper |
| `upgrade_003_cheque_payment.sql` | Cheque payment with photo |
| `upgrade_004_containers.sql` | Suppliers, containers, landed cost, product cost |
| `upgrade_005_returns_against_invoice.sql` | Returns linked to the sale invoice |
| `upgrade_006_container_lots.sql` | What is left of each container, and its profit |
| `upgrade_007_item_supplier.sql` | Supplier per packing list line |
| `upgrade_008_delivery.sql` | Delivery staff, trips, cash collected on delivery |

Run the upgrades **before** deploying the code that needs them. If the code goes first you'll see errors like *"Could not find the table 'public.container_stock'"*.

When you add a new upgrade: take the next number (009), make it safe to run again (`if not exists`, `create or replace`, `drop policy if exists`), put the same change in `setup.sql`, and add a row to both tables.

To continue invoice numbers from the old software (say the last bill there was 14137):

```sql
select setval('public.invoice_no_seq', 14137);
```

`rename_sample_products.sql` is a one-off for databases that imported the old sample product list. You probably don't need it.

---

## The admin-users Edge Function

Creating users and setting passwords needs the service role key, which must never be in the browser. So it goes through `backend/supabase/functions/admin-users`.

Deploy it from the dashboard: **Edge Functions > Deploy a new function > Via Editor**, name it exactly `admin-users`, paste `backend/supabase/functions/admin-users/index.ts`, deploy. (Or `supabase functions deploy admin-users` with the CLI.)

Two things that tripped us up:
- The dashboard suggests a random name like `bright-action`. The app calls `admin-users`, so anything else gives *"Failed to send a request to the Edge Function"*.
- If you get 401 / "Invalid JWT", turn off *Verify JWT* for this function. The function checks the caller itself (signed in, active, admin).

---

## Deploying

The live site runs on Vercel and deploys from `main`. The app is in `frontend/`, so the Vercel project's
**Root Directory** must be set to `frontend` (Project Settings > Build and Deployment). So:

1. Work on a branch, open a PR.
2. Vercel builds a preview link for the PR. Careful: previews use the same Supabase keys as production unless Preview env vars are set separately.
3. Run any new database upgrades on production.
4. Merge.

Environment variables on Vercel are the same two as `.env`.

---

## Project layout

```
frontend/                 the React app (website + staff software)
  index.html, vite.config.js, package.json, vercel.json, .env
  public/
  src/
    main.jsx              entry point
    index.css             styles for the software
    app/                  App.jsx (routes), auth/ (login, session, RequireAuth)
    features/             one folder per part of the software
      sales/              invoices, returns, receipts, cheque photo
      customers/          customer list and ledger
      products/           products, product ledger, CSV import
      stock/              stock screen, stock in / out / transfer
      containers/         containers, suppliers, receiving, landed cost
      delivery/           delivery trips, staff, delivery slip
      users/              users and passwords, my profile
      dashboard/
      settings/
    shared/
      components/         layout, form pieces, pickers, record modals
      lib/                format, permissions, validation, search, csv,
                          customer and product fields
    services/             supabaseApi.js: every call to Supabase lives here
    site/                 the public website

backend/
  supabase/
    setup.sql             full schema for a new project
    migrations/           upgrade_00X_*.sql, changes for existing databases
    functions/admin-users/
    README.md             which upgrades to run, and how to check

docs/
  CHECKLIST.md            what's done, what's left, go-live steps
  Royal-Stationers-Feature-Proposal.pdf   the original client proposal
  sample-products.csv
```

A few rules we try to keep:

- A screen and the helpers only it uses live in its feature folder.
- `shared/` never imports from `features/`. If two features need something, it moves to `shared/`.
- Pages don't call Supabase directly; they go through `services/`.
- Business rules that must hold (stock, balances, roles) are in the database, not only in React.

Feature IDs in `docs/CHECKLIST.md` (P-01, I-04, PI-06 ...) match the proposal PDF.

---

## Things to know

- **Container profit is FIFO** and follows invoice dates. Back-dating a bill changes which container it came out of. Profit is at the line rate, before any discount on the whole bill.
- **Average cost** of a product updates when a container is received. Reopening a container (admin) puts the old cost back, as long as nothing changed it since.
- **Invoice numbers have gaps** when a bill is deleted. That's normal for Postgres sequences, but it's one more reason we want cancel-with-reason instead of delete (see below).
- On Supabase's free plan there are no backups and the project pauses after a week without use. The client needs the Pro plan before going live.

## Still to do

Roughly in the order we'd tackle them:

- Activity log, and cancel with a reason instead of delete
- Supplier ledger and payments, local purchase invoices
- Reports page (daily sales, salesman-wise, stock valuation, profit)
- Expenses and a daily cash book
- Cheque register (pending / deposited / cleared / bounced)
- Thermal 80 mm print, WhatsApp / PDF sharing
- Import of old customers, balances and opening stock for go-live

The full list with status is in `docs/CHECKLIST.md`.

---
Developer:
  
  Senior Full AI Engineer : Ehtisham Malik
  
  
  Senior Software Engineer : Ali Raza