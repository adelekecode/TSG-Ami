-- v6, adapted to the existing 0003 demo allowlist and tenancy/session schema.
-- No existing resident, invoice or payment records are reclassified or reset.
ALTER TABLE demo_profiles ADD COLUMN profile_type TEXT NOT NULL DEFAULT 'seeded'
  CHECK(profile_type IN ('seeded','generated'));
ALTER TABLE demo_profiles ADD COLUMN creation_key TEXT;
ALTER TABLE demo_profiles ADD COLUMN request_fingerprint TEXT;
ALTER TABLE demo_profiles ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE demo_profiles SET created_at=CURRENT_TIMESTAMP WHERE created_at='';
CREATE UNIQUE INDEX idx_demo_profiles_creation_key ON demo_profiles(creation_key);
CREATE INDEX idx_demo_profiles_created ON demo_profiles(created_at);
-- Enforce capacity inside the transaction, including simultaneous requests.
CREATE TRIGGER demo_profile_capacity BEFORE INSERT ON demo_profiles
WHEN NEW.profile_type='generated' AND (SELECT COUNT(*) FROM demo_profiles WHERE profile_type='generated')>=500
BEGIN SELECT RAISE(ABORT,'DEMO_CAPACITY_REACHED'); END;

CREATE TABLE onboarding_registrations (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  property_hint TEXT,
  unit_hint TEXT,
  notes TEXT,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','under_review','verified','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_onboarding_registrations_status ON onboarding_registrations(status,created_at);
-- A registration lookup capability is separate from resident access. Retrying a
-- registration does not invalidate tokens already issued for the same request.
CREATE TABLE onboarding_registration_sessions (
  token_hash TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES onboarding_registrations(id),
  expires_at INTEGER NOT NULL
);
CREATE TRIGGER onboarding_registration_capacity BEFORE INSERT ON onboarding_registrations
WHEN (SELECT COUNT(*) FROM onboarding_registrations)>=500
BEGIN SELECT RAISE(ABORT,'REGISTRATION_CAPACITY_REACHED'); END;
