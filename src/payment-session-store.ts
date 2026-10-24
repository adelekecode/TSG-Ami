import { hash } from "./domain";
import { ApiError } from "./maintenance";

export interface ResidentSession {
  tenancy_id: string;
  token_hash: string;
}
export async function validSession(
  db: D1Database,
  rawToken: string,
): Promise<ResidentSession> {
  if (
    typeof rawToken !== "string" ||
    rawToken.length < 20 ||
    rawToken.length > 256
  )
    throw new ApiError(
      401,
      "VERIFICATION_REQUIRED",
      "Please open your demo resident account first.",
    );
  const digest = await hash(rawToken);
  const session = await db
    .prepare(
      `SELECT s.tenancy_id,s.token_hash FROM sessions s
    JOIN tenancies t ON t.id=s.tenancy_id
    WHERE s.token_hash=? AND s.expires_at>? AND t.active=1 LIMIT 1`,
    )
    .bind(digest, Math.floor(Date.now() / 1000))
    .first<ResidentSession>();
  if (!session)
    throw new ApiError(
      401,
      "SESSION_EXPIRED",
      "Your account session has expired. Please reopen the selected demo account.",
    );
  return session;
}
/** Call only after the real provider URL has been persisted. Never store raw tokens. */
export async function rememberPaymentForSession(
  db: D1Database,
  sessionToken: string,
  tenancyId: string,
  invoiceId: string,
  reference: string,
): Promise<void> {
  const session = await validSession(db, sessionToken);
  if (session.tenancy_id !== tenancyId)
    throw new ApiError(
      403,
      "RESIDENT_MISMATCH",
      "Payment does not belong to the active resident.",
    );
  // Repeat active-session and ownership checks in the write itself, preventing
  // expiry/deactivation races and associations with another tenant's invoice.
  const result = await db
    .prepare(
      `INSERT INTO payment_session_context(token_hash,tenancy_id,invoice_id,payment_reference,updated_at)
    SELECT s.token_hash,s.tenancy_id,a.invoice_id,a.reference,? FROM sessions s
    JOIN tenancies t ON t.id=s.tenancy_id
    JOIN payment_attempts a ON a.resident_id=s.tenancy_id
    JOIN invoices i ON i.id=a.invoice_id AND i.resident_id=s.tenancy_id
    WHERE s.token_hash=? AND s.tenancy_id=? AND s.expires_at>? AND t.active=1
      AND a.invoice_id=? AND a.reference=? AND a.status IN ('pending','success')
      AND a.checkout_url IS NOT NULL AND a.checkout_url<>''
    ON CONFLICT(token_hash) DO UPDATE SET tenancy_id=excluded.tenancy_id,
      invoice_id=excluded.invoice_id,payment_reference=excluded.payment_reference,updated_at=excluded.updated_at`,
    )
    .bind(
      new Date().toISOString(),
      session.token_hash,
      tenancyId,
      Math.floor(Date.now() / 1000),
      invoiceId,
      reference,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new ApiError(
      409,
      "PAYMENT_NOT_READY",
      "The checkout reference has not been initialized for this account, or the session is no longer active.",
    );
}
