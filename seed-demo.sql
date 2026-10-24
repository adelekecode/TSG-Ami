-- Public fictional fixtures for demo profile selection. Run after base + concierge seeds.
-- Explicit enrollment requires known fixture identity, unit, and demo-code hash.
INSERT OR IGNORE INTO units(id,property_name,building,active) VALUES
 ('L410','Cedar Court (Demo)','Block L',1);
INSERT OR IGNORE INTO residents(id,preferred_name,email) VALUES
 ('res_demo_leke_v5','Leke','leke@example.com');
INSERT OR IGNORE INTO tenancies(id,resident_id,unit_id,onboarding_hash) VALUES
 ('ten_demo_leke_v5','res_demo_leke_v5','L410','254a9047a3ff6eeeb25edb8386297593a1b6591ecbbb03729365136deb187e5f');
-- The existing rent trigger mirrors this invoice into the current invoice API.
INSERT OR IGNORE INTO rent_invoices(id,tenancy_id,amount_minor,paid_minor,currency,due_date) VALUES
 ('RENT-L410-NOV','ten_demo_leke_v5',9600000,0,'NGN','2026-11-01');
INSERT OR IGNORE INTO invoices(id,resident_id,kind,description,amount_kobo,currency,due_date,status) VALUES
 ('ELEC-L410-OCT','ten_demo_leke_v5','utility','October electricity',315000,'NGN','2026-10-31','unpaid');
INSERT OR IGNORE INTO demo_profiles(demo_profile_id,tenancy_id)
 SELECT 'demo_leke_l410',t.id FROM tenancies t JOIN residents r ON r.id=t.resident_id
 WHERE t.id='ten_demo_leke_v5' AND r.id='res_demo_leke_v5' AND r.preferred_name='Leke'
 AND r.email='leke@example.com' AND t.unit_id='L410' AND t.onboarding_hash='254a9047a3ff6eeeb25edb8386297593a1b6591ecbbb03729365136deb187e5f';
INSERT OR IGNORE INTO demo_profiles(demo_profile_id,tenancy_id)
 SELECT 'demo_seun_a204',t.id FROM tenancies t JOIN residents r ON r.id=t.resident_id
 WHERE t.id='ten_001' AND r.id='res_001' AND r.preferred_name='Seun'
 AND r.email='seun.a@example.com' AND t.unit_id='A204'
 AND t.onboarding_hash='26dc0686ecd73b4199c84216f3c354ae447c0cfb11e9efabf6e2fda7db6cd12d';
INSERT OR IGNORE INTO demo_profiles(demo_profile_id,tenancy_id)
 SELECT 'demo_seun_b101',t.id FROM tenancies t JOIN residents r ON r.id=t.resident_id
 WHERE t.id='ten_seun_b' AND r.id='res_seun_b' AND r.preferred_name='Seun'
 AND r.email='seun.b@example.com' AND t.unit_id='B101'
 AND t.onboarding_hash='5fa1e4110fc372294a547cc8a9a75ffe857e4ddd9526729d69b76f37c75af9b9';
INSERT OR IGNORE INTO demo_profiles(demo_profile_id,tenancy_id)
 SELECT 'demo_ada_c302',t.id FROM tenancies t JOIN residents r ON r.id=t.resident_id
 WHERE t.id='ten_ada' AND r.id='res_ada' AND r.preferred_name='Ada'
 AND r.email='ada@example.com' AND t.unit_id='C302'
 AND t.onboarding_hash='f90d1a6309e808492f43fb2b4ac0e671330b9c5bb67393148774e1eb1a9d1ea8';
