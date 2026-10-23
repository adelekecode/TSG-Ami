-- Additive upgrade of the main app schema; never replay the source's incompatible 0001.
ALTER TABLE units ADD COLUMN building TEXT NOT NULL DEFAULT '';
ALTER TABLE units ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE residents ADD COLUMN email TEXT;
CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id),
  tenancy_id TEXT NOT NULL REFERENCES tenancies(id),
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('plumbing','electrical','hvac','structural','other')),
  priority TEXT NOT NULL CHECK (priority IN ('emergency','urgent','normal')),
  hazard TEXT NOT NULL CHECK (hazard IN ('none','fire','gas','electrical','severe_flooding','other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaged','assigned','in_progress','resolved')),
  assigned_to TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_unit_created ON maintenance_tickets(unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON maintenance_tickets(status);

CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id, id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  resident_id TEXT NOT NULL REFERENCES tenancies(id),
  kind TEXT NOT NULL CHECK (kind IN ('rent','utility')),
  description TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid')),
  paid_at TEXT,
  legacy_rent_id TEXT UNIQUE REFERENCES rent_invoices(id),
  paid_reference TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_invoices_resident ON invoices(resident_id, due_date);

CREATE TABLE IF NOT EXISTS payment_attempts (
  reference TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  resident_id TEXT NOT NULL REFERENCES tenancies(id),
  status TEXT NOT NULL CHECK (status IN ('initializing','pending','success','failed','abandoned','error')),
  checkout_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Prevent simultaneous open links for the same invoice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_open_invoice
  ON payment_attempts(invoice_id) WHERE status IN ('initializing','pending');
CREATE INDEX IF NOT EXISTS idx_attempts_invoice ON payment_attempts(invoice_id, created_at DESC);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  resident_id TEXT NOT NULL REFERENCES tenancies(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  category TEXT NOT NULL CHECK (category IN ('noise','security','cleanliness','management','other')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Mirror legacy balances without replacing invoices, tenancy IDs or onboarding codes.
INSERT INTO invoices(id,resident_id,kind,description,amount_kobo,currency,due_date,status,legacy_rent_id)
SELECT id,tenancy_id,'rent','Rent due ' || due_date,amount_minor-paid_minor,currency,due_date,
 CASE WHEN paid_minor=amount_minor THEN 'paid' ELSE 'unpaid' END,id FROM rent_invoices;
CREATE TRIGGER rent_invoice_insert AFTER INSERT ON rent_invoices BEGIN
 INSERT INTO invoices(id,resident_id,kind,description,amount_kobo,currency,due_date,status,legacy_rent_id)
 VALUES(NEW.id,NEW.tenancy_id,'rent','Rent due ' || NEW.due_date,NEW.amount_minor-NEW.paid_minor,NEW.currency,NEW.due_date,
 CASE WHEN NEW.paid_minor=NEW.amount_minor THEN 'paid' ELSE 'unpaid' END,NEW.id);
END;
CREATE TRIGGER rent_invoice_update AFTER UPDATE ON rent_invoices BEGIN
 UPDATE invoices SET
 amount_kobo=CASE WHEN NEW.paid_minor=NEW.amount_minor THEN amount_kobo ELSE NEW.amount_minor-NEW.paid_minor END,
 status=CASE WHEN NEW.paid_minor=NEW.amount_minor THEN 'paid' ELSE 'unpaid' END,
 currency=NEW.currency,due_date=NEW.due_date WHERE legacy_rent_id=NEW.id;
END;
CREATE TRIGGER invoice_payment_credit AFTER UPDATE OF status ON invoices
WHEN NEW.status='paid' AND OLD.status='unpaid' AND NEW.legacy_rent_id IS NOT NULL BEGIN
 UPDATE rent_invoices SET paid_minor=amount_minor WHERE id=NEW.legacy_rent_id;
END;
-- New tickets and complaints also appear through the original request APIs.
CREATE TRIGGER maintenance_request_insert AFTER INSERT ON maintenance_tickets BEGIN
 INSERT INTO requests(id,tenancy_id,kind,description,status,created_at)
 VALUES(NEW.id,NEW.tenancy_id,'maintenance',NEW.description,NEW.status,NEW.created_at);
 INSERT INTO activity_events(id,tenancy_id,request_id,event,created_at)
 VALUES('created-' || NEW.id,NEW.tenancy_id,NEW.id,'created',NEW.created_at);
END;
CREATE TRIGGER maintenance_request_update AFTER UPDATE OF status ON maintenance_tickets BEGIN
 UPDATE requests SET status=NEW.status WHERE id=NEW.id;
 INSERT INTO activity_events(id,tenancy_id,request_id,event,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.tenancy_id,NEW.id,NEW.status,NEW.updated_at);
END;
CREATE TRIGGER complaint_request_insert AFTER INSERT ON complaints BEGIN
 INSERT INTO requests(id,tenancy_id,kind,description,status,created_at)
 VALUES(NEW.id,NEW.resident_id,'complaint',NEW.description,NEW.status,NEW.created_at);
 INSERT INTO activity_events(id,tenancy_id,request_id,event,created_at)
 VALUES('created-' || NEW.id,NEW.resident_id,NEW.id,'created',NEW.created_at);
END;
