-- An explicit allowlist for fictional fixtures. Existing residents are not enrolled
-- automatically, and no existing records or sessions are modified.
CREATE TABLE demo_profiles (
  demo_profile_id TEXT PRIMARY KEY,
  tenancy_id TEXT NOT NULL UNIQUE REFERENCES tenancies(id)
);
