-- Fictional demonstration data only. Safe to run again.
-- Demo onboarding codes are public examples, never production credentials.
INSERT OR IGNORE INTO residents (id, preferred_name) VALUES
  ('res_001','Seun'), ('res_002','Seun'), ('res_003','Amaka'), ('res_004','Tunde'),
  ('res_005','Zainab'), ('res_006','Chidi'), ('res_007','Amaka'), ('res_008','Feyi'),
  ('res_009','Ibrahim'), ('res_010','Nneka');
INSERT OR IGNORE INTO units (id, property_name) VALUES
  ('A204','Demo Residence'), ('B105','Demo Residence'), ('A101','Demo Residence'),
  ('A305','Demo Residence'), ('B202','Demo Residence'), ('C011','Garden Court'),
  ('C208','Garden Court'), ('D104','Garden Court'), ('D310','Garden Court'), ('E002','Garden Court');
INSERT OR IGNORE INTO tenancies (id, resident_id, unit_id, onboarding_hash, active) VALUES
  ('ten_001','res_001','A204','26dc0686ecd73b4199c84216f3c354ae447c0cfb11e9efabf6e2fda7db6cd12d',1),
  ('ten_002','res_002','B105','45089b80a0a4911dba82f0352f4e077a578114591ac0b2c00d2e32b04d2118a9',1),
  ('ten_003','res_003','A101','446cab66d2b36d5eb17b3b2bb56eac70766805d6d5206c1fcb0901eddc8d3eed',1),
  ('ten_004','res_004','A305','354fc3b2563081b262b043a1f55911b6942f8d471ba779a1df0dce091d7717d6',1),
  ('ten_005','res_005','B202','5f00f62b888f06c828870f021045f793f104e705bb8b7125da4d7f1853984877',1),
  ('ten_006','res_006','C011','6404b2d3475e5f32b56121609527ca03b4f5a10b5f1dc6884b220ea9116a954a',1),
  ('ten_007','res_007','C208','0aaebb34da365a85645cba2774fb41224f04a4f060f7e1ce4436e37a87131df2',1),
  ('ten_008','res_008','D104','753d4d414154598b320ddb58fb082b540367e2a20bd11e03f64947066b01806b',1),
  ('ten_009','res_009','D310','4ddeb2b6a12c6e69cdb398d7bd15be13838580eb8c95c6358a9837f0f9f709c3',1),
  ('ten_010','res_010','E002','01867088f3dfa30a2bfc7828fca4e338c6afad5c8d08d8f8d6844108535e00e3',1);
INSERT OR IGNORE INTO rent_invoices (id, tenancy_id, amount_minor, paid_minor, currency, due_date) VALUES
  ('inv_001','ten_001',150000000,0,'NGN','2026-11-01'),
  ('inv_002','ten_002',120000000,20000000,'NGN','2026-12-01'),
  ('inv_003','ten_003',135000000,135000000,'NGN','2026-10-01'),
  ('inv_004','ten_003',135000000,0,'NGN','2027-01-01'),
  ('inv_005','ten_004',175000000,50000000,'NGN','2026-11-15'),
  ('inv_006','ten_005',110000000,110000000,'NGN','2026-10-15'),
  ('inv_007','ten_006',145000000,0,'NGN','2026-12-01'),
  ('inv_008','ten_007',125000000,25000000,'NGN','2026-11-01'),
  ('inv_009','ten_008',160000000,160000000,'NGN','2026-10-01'),
  ('inv_010','ten_008',160000000,0,'NGN','2027-01-01'),
  ('inv_011','ten_009',130000000,0,'NGN','2026-11-01'),
  ('inv_012','ten_010',155000000,75000000,'NGN','2026-12-15');
INSERT OR IGNORE INTO requests (id, tenancy_id, kind, description, status, created_at) VALUES
  ('MNT-DEMO-1001','ten_001','maintenance','Bathroom water leak under the sink','in_progress','2026-10-19 09:30:00'),
  ('CMP-DEMO-1002','ten_001','complaint','Noise from renovation outside permitted hours','open','2026-10-20 18:20:00'),
  ('MNT-DEMO-1003','ten_002','maintenance','Bedroom light switch is not working','open','2026-10-18 11:10:00'),
  ('CMP-DEMO-1004','ten_003','complaint','Repeated elevator interruptions this week','in_progress','2026-10-16 08:45:00'),
  ('MNT-DEMO-1005','ten_004','maintenance','Kitchen tap has been repaired','resolved','2026-10-12 14:00:00'),
  ('MNT-DEMO-1006','ten_005','maintenance','Air conditioner is making a loud rattling sound','open','2026-10-21 07:55:00'),
  ('CMP-DEMO-1007','ten_006','complaint','Water supply was unavailable this morning','open','2026-10-20 10:05:00'),
  ('MNT-DEMO-1008','ten_007','maintenance','Main door lock is difficult to turn','in_progress','2026-10-17 16:40:00'),
  ('CMP-DEMO-1009','ten_008','complaint','Waste collection was missed on the scheduled day','resolved','2026-10-14 12:15:00'),
  ('MNT-DEMO-1010','ten_009','maintenance','Small ceiling stain appeared after rain','open','2026-10-22 06:50:00'),
  ('CMP-DEMO-1011','ten_010','complaint','Parking bay was occupied by an unknown vehicle','open','2026-10-19 20:25:00');
INSERT OR IGNORE INTO activity_events (id, tenancy_id, request_id, event, created_at) VALUES
  ('evt_demo_1001','ten_001','MNT-DEMO-1001','created','2026-10-19 09:30:00'),
  ('evt_demo_1002','ten_001','CMP-DEMO-1002','created','2026-10-20 18:20:00'),
  ('evt_demo_1003','ten_002','MNT-DEMO-1003','created','2026-10-18 11:10:00'),
  ('evt_demo_1004','ten_003','CMP-DEMO-1004','created','2026-10-16 08:45:00'),
  ('evt_demo_1005','ten_004','MNT-DEMO-1005','created','2026-10-12 14:00:00'),
  ('evt_demo_1006','ten_005','MNT-DEMO-1006','created','2026-10-21 07:55:00'),
  ('evt_demo_1007','ten_006','CMP-DEMO-1007','created','2026-10-20 10:05:00'),
  ('evt_demo_1008','ten_007','MNT-DEMO-1008','created','2026-10-17 16:40:00'),
  ('evt_demo_1009','ten_008','CMP-DEMO-1009','created','2026-10-14 12:15:00'),
  ('evt_demo_1010','ten_009','MNT-DEMO-1010','created','2026-10-22 06:50:00'),
  ('evt_demo_1011','ten_010','CMP-DEMO-1011','created','2026-10-19 20:25:00');
