-- Fictional extra fixtures; run after seed.sql. Never replaces existing data.
INSERT OR IGNORE INTO units(id,property_name,building,active) VALUES
 ('B101','Cedar Court (Demo)','Block B',1),('C302','Palm Heights (Demo)','Block C',1),('Z999','Palm Heights (Demo)','Inactive Block',0);
INSERT OR IGNORE INTO residents(id,preferred_name,email) VALUES
 ('res_seun_b','Seun','seun.b@example.com'),('res_ada','Ada','ada@example.com');
INSERT OR IGNORE INTO tenancies(id,resident_id,unit_id,onboarding_hash) VALUES
 ('ten_seun_b','res_seun_b','B101','5fa1e4110fc372294a547cc8a9a75ffe857e4ddd9526729d69b76f37c75af9b9'),
 ('ten_ada','res_ada','C302','f90d1a6309e808492f43fb2b4ac0e671330b9c5bb67393148774e1eb1a9d1ea8');
-- A204 retains its existing rent balance and AMI-DEMO-204 code.
UPDATE residents SET email='seun.a@example.com' WHERE id='res_001' AND email IS NULL;
INSERT OR IGNORE INTO invoices(id,resident_id,kind,description,amount_kobo,currency,due_date,status) VALUES
 ('ELEC-A204-OCT','ten_001','utility','October electricity',235000,'NGN','2026-10-31','unpaid'),
 ('RENT-B101-NOV','ten_seun_b','rent','November rent',6400000,'NGN','2026-11-01','unpaid'),
 ('WATER-B101-OCT','ten_seun_b','utility','October water',89000,'NGN','2026-10-31','unpaid'),
 ('RENT-C302-NOV','ten_ada','rent','November rent',8100000,'NGN','2026-11-01','unpaid');
