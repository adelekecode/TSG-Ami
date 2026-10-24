import { z } from "zod";
export type Env = {
  DB: D1Database;
  API_KEY?: string;
  DEMO_API_TOKEN?: string;
  PAYSTACK_SECRET_KEY?: string;
  DEMO_MODE?: string;
};
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const schemas = {
  resolve_resident: z.object({
    unit_id: z.string().min(1).max(32),
    onboarding_code: z.string().min(1).max(128),
  }),
  get_resident_context: z.object({ resident_token: z.string().min(1) }),
  create_maintenance_ticket: z.object({
    resident_token: z.string().min(1),
    description: z.string().trim().min(5).max(4000),
  }),
  get_maintenance_status: z.object({
    resident_token: z.string().min(1),
    request_id: z.string().min(1),
  }),
  create_complaint: z.object({
    resident_token: z.string().min(1),
    description: z.string().trim().min(5).max(4000),
    idempotency_key: z.string().min(8).max(128).optional(),
  }),
  get_rent_summary: z.object({ resident_token: z.string().min(1) }),
  get_resident_requests: z.object({ resident_token: z.string().min(1) }),
};
export type ToolName = keyof typeof schemas;
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function tenancy(env: Env, token: string) {
  const row = await env.DB.prepare(
    "SELECT t.id, t.unit_id, r.preferred_name FROM sessions s JOIN tenancies t ON t.id=s.tenancy_id JOIN residents r ON r.id=t.resident_id WHERE s.token_hash=? AND s.expires_at>? AND t.active=1",
  )
    .bind(await hash(token), Math.floor(Date.now() / 1000))
    .first<{ id: string; unit_id: string; preferred_name: string }>();
  if (!row)
    throw new DomainError(
      "Resident verification required or session expired",
      401,
    );
  return row;
}
export async function execute(
  env: Env,
  name: ToolName,
  input: unknown,
): Promise<unknown> {
  const a = schemas[name].parse(input) as Record<string, string>;
  if (name === "resolve_resident") {
    const now = Math.floor(Date.now() / 1000);
    // Count before checking credentials, including unknown units. D1 serializes this upsert.
    const attempt = await env.DB.prepare(
      "INSERT INTO verification_attempts VALUES (?,1,?) ON CONFLICT(unit_id) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts",
    )
      .bind(a.unit_id, now + 900, now, now)
      .first<{ attempts: number }>();
    if (!attempt || attempt.attempts > 5)
      throw new DomainError(
        "Too many verification attempts; try again in 15 minutes",
        429,
      );
    const row = await env.DB.prepare(
      "SELECT id FROM tenancies WHERE unit_id=? AND onboarding_hash=? AND active=1",
    )
      .bind(a.unit_id, await hash(a.onboarding_code))
      .first<{ id: string }>();
    if (!row) throw new DomainError("Unable to verify these credentials", 401);
    const token = crypto.randomUUID() + crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      env.DB.prepare("INSERT INTO sessions VALUES (?,?,?)").bind(
        await hash(token),
        row.id,
        now + 86400,
      ),
    ]);
    return { verified: true, resident_token: token, expires_in: 86400 };
  }
  const t = await tenancy(env, a.resident_token);
  // The legacy MCP definition already accepts this key. Previously it was
  // stripped by this schema, so retries created a fresh row despite supplying it.
  if (name === "create_complaint" && a.idempotency_key) {
    const id = `CMP-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO complaints
      (id,resident_id,unit_id,category,description,status,idempotency_key,created_at)
      VALUES (?,?,?,'other',?,'open',?,?)`,
    )
      .bind(
        id,
        t.id,
        t.unit_id,
        a.description,
        a.idempotency_key,
        new Date().toISOString(),
      )
      .run();
    const saved = await env.DB.prepare(
      "SELECT id,resident_id,description,category,status FROM complaints WHERE idempotency_key=?",
    )
      .bind(a.idempotency_key)
      .first<{
        id: string;
        resident_id: string;
        description: string;
        category: string;
        status: string;
      }>();
    if (
      !saved ||
      saved.resident_id !== t.id ||
      saved.description !== a.description ||
      saved.category !== "other"
    )
      throw new DomainError(
        "This complaint request key was already used.",
        409,
      );
    return {
      id: saved.id,
      kind: "complaint",
      status: saved.status,
      description: saved.description,
      created: saved.id === id,
    };
  }
  if (name === "get_resident_context")
    return { preferred_name: t.preferred_name, unit_id: t.unit_id, demo: true };
  if (name === "get_rent_summary") {
    const result = await env.DB.prepare(
      "SELECT id, amount_minor, paid_minor, amount_minor-paid_minor AS balance_minor, currency, due_date FROM rent_invoices WHERE tenancy_id=? ORDER BY due_date",
    )
      .bind(t.id)
      .all();
    return {
      invoices: result.results,
      amount_unit: "minor currency units (kobo for NGN)",
      demo: true,
    };
  }
  if (name === "get_resident_requests")
    return (
      await env.DB.prepare(
        "SELECT id,kind,description,status,created_at FROM requests WHERE tenancy_id=? ORDER BY created_at DESC LIMIT 100",
      )
        .bind(t.id)
        .all()
    ).results;
  if (name === "get_maintenance_status") {
    const row = await env.DB.prepare(
      "SELECT id,description,status,created_at FROM requests WHERE id=? AND tenancy_id=? AND kind='maintenance'",
    )
      .bind(a.request_id, t.id)
      .first();
    if (!row) throw new DomainError("Maintenance request not found", 404);
    return row;
  }
  const kind = name === "create_complaint" ? "complaint" : "maintenance";
  const id = (kind === "complaint" ? "CMP-" : "MNT-") + crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO requests (id,tenancy_id,kind,description) VALUES (?,?,?,?)",
    ).bind(id, t.id, kind, a.description),
    env.DB.prepare(
      "INSERT INTO activity_events (id,tenancy_id,request_id,event) VALUES (?,?,?,?)",
    ).bind(crypto.randomUUID(), t.id, id, "created"),
  ]);
  return { id, kind, status: "open", description: a.description };
}
