-- Fictional demo bills for every existing tenancy in ami-db.
-- Run after the other seeds; rerun to cover accounts created later.
-- Amounts are in kobo (100 kobo = NGN 1). Stable IDs preserve payments on reruns.
WITH bill_templates(code, description, amount_kobo, due_date) AS (
 VALUES
  ('ELEC-NOV26', 'November electricity', 750000, '2026-11-30'),
  ('WATER-NOV26', 'November water', 500000, '2026-11-15'),
  ('WASTE-OCT26', 'October waste collection', 650000, '2026-10-20'),
  ('COMMON-NOV26', 'November common-area service charge', 1000000, '2026-11-01')
)
INSERT INTO invoices(id, resident_id, kind, description, amount_kobo, currency, due_date, status)
 SELECT 'DEMO-BILL-' || t.id || '-' || b.code,
        t.id, 'utility', b.description, b.amount_kobo, 'NGN', b.due_date, 'unpaid'
 FROM tenancies t CROSS JOIN bill_templates b
 WHERE 1
 ON CONFLICT(id) DO NOTHING;
