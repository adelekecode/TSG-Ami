-- v7: 0004 is already occupied by resident onboarding. Payment ownership in this
-- app is tenancy-scoped (payment_attempts.resident_id references tenancies.id).
CREATE TABLE payment_session_context (
  token_hash TEXT PRIMARY KEY NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  tenancy_id TEXT NOT NULL REFERENCES tenancies(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  payment_reference TEXT NOT NULL REFERENCES payment_attempts(reference),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_payment_session_tenancy ON payment_session_context(tenancy_id,updated_at DESC);
CREATE INDEX idx_payment_attempts_owner_created ON payment_attempts(resident_id,created_at DESC);
