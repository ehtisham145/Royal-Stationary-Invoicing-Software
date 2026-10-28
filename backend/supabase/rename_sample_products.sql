-- =============================================================
-- Royal Stationers - shorter product names for the sample products
-- Renames products already imported from the OLD docs/sample-products.csv
-- to the new short names, so re-importing is not needed (it would make duplicates).
-- Stock and old invoices are not affected (invoices keep the name they were printed with).
--
-- Run ONCE: Supabase Dashboard > SQL Editor > New query > paste > Run. Safe to run again.
-- =============================================================

update public.products p
   set name = v.new_name
  from (values
    ('TAPE CHANYI CY1262 200YD', 'Tape CY1262 200yd'),
    ('STAPLER PIN NEXT # 10', 'Stapler Pin #10'),
    ('BAR FILE 14C COLOR DANDI NEXT A4', 'Bar File 14C Color Dandi A4'),
    ('14C BLACK POCKET', 'Black Pocket 14C'),
    ('BAR FILE CRYSTAL (W) R NEXT', 'Bar File Crystal (W) R'),
    ('CALCULATOR CITIZEN NO CT-912', 'Calculator CT-912'),
    ('CLEAR BAG 14C SIMPLE BLACK', 'Clear Bag 14C Simple Black'),
    ('PENCIL BOX A-1204', 'Pencil Box A-1204'),
    ('PENCIL BOX 768', 'Pencil Box 768'),
    ('NOTE BOOK 18-54', 'Note Book 18-54'),
    ('GLUE 9G', 'Glue 9g'),
    ('GLUE 21G', 'Glue 21g'),
    ('HOT GLUE 0.7*18', 'Hot Glue 0.7x18'),
    ('ERASABLE PEN NO YL212620', 'Erasable Pen YL212620'),
    ('PRODUCT 123', 'Product 123')
  ) as v(old_name, new_name)
 where lower(trim(p.name)) = lower(v.old_name);
