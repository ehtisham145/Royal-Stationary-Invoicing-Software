# Database files

## New Supabase project
Run **`setup.sql`** once in the SQL Editor. It already contains every upgrade below; do not run them.

## Existing database (dev or production)
Run the upgrades in `migrations/` **in number order, each once**. Every file is safe to run again, so running one twice does no harm.

| # | File | Adds |
|---|---|---|
| 002 | `migrations/upgrade_002_four_roles.sql` | Admin, Manager, Cashier, Store keeper |
| 003 | `migrations/upgrade_003_cheque_payment.sql` | Cheque payment with photo on invoices |
| 004 | `migrations/upgrade_004_containers.sql` | Suppliers, containers, landed cost, product cost |
| 005 | `migrations/upgrade_005_returns_against_invoice.sql` | Returns linked to the sale invoice |
| 006 | `migrations/upgrade_006_container_lots.sql` | What is left of each container and its profit |
| 007 | `migrations/upgrade_007_item_supplier.sql` | A supplier per packing list line |
| 008 | `migrations/upgrade_008_delivery.sql` | Delivery staff and trips: who took which bills, when, and cash collected |

Run the upgrades **before** deploying the frontend that needs them.

### Which ones has a database already had?
```sql
select
  exists (select 1 from information_schema.check_constraints where constraint_name = 'profiles_role_check'
          and check_clause like '%storekeeper%')                                                         as "002",
  exists (select 1 from information_schema.columns where table_name = 'invoices' and column_name = 'cheque_image') as "003",
  exists (select 1 from information_schema.tables  where table_name = 'containers')                     as "004",
  exists (select 1 from information_schema.columns where table_name = 'invoice_items' and column_name = 'return_of_item') as "005",
  exists (select 1 from information_schema.views   where table_name = 'container_stock')                as "006",
  exists (select 1 from information_schema.columns where table_name = 'container_items' and column_name = 'supplier_id') as "007",
  exists (select 1 from information_schema.tables  where table_name = 'delivery_trips')                 as "008";
```
Run only the files that show `false`.

New upgrades take the next number (008, 009, ...).
