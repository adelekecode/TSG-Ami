import { z } from "zod";
import { validSession } from "./payment-session-store";

export const complaintStatusSchema = z
  .object({
    session_token: z.string().min(20).max(256),
    complaint_id: z
      .string()
      .regex(/^CMP-[a-f0-9-]{36}$/)
      .optional(),
    request_key: z.string().min(8).max(128).optional(),
  })
  .strict()
  .refine(
    (input) => Boolean(input.complaint_id) !== Boolean(input.request_key),
    {
      message: "Provide exactly one complaint_id or request_key.",
    },
  );

/** References and request keys locate records; only the resident capability authorizes them. */
export async function getComplaintStatus(db: D1Database, input: unknown) {
  const data = complaintStatusSchema.parse(input);
  const session = await validSession(db, data.session_token);
  const record = data.request_key
    ? await db
        .prepare(
          `SELECT id AS complaint_id,unit_id,category,description,status,created_at
        FROM complaints WHERE resident_id=? AND idempotency_key=? LIMIT 1`,
        )
        .bind(session.tenancy_id, data.request_key)
        .first()
    : await db
        .prepare(
          `SELECT c.id AS complaint_id,c.unit_id,c.category,c.description,c.status,c.created_at
        FROM complaints c WHERE c.resident_id=? AND c.id=?
        UNION ALL
        SELECT r.id AS complaint_id,t.unit_id,NULL AS category,r.description,r.status,r.created_at
        FROM requests r JOIN tenancies t ON t.id=r.tenancy_id
        WHERE r.tenancy_id=? AND r.id=? AND r.kind='complaint'
          AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.id=r.id)
        LIMIT 1`,
        )
        .bind(
          session.tenancy_id,
          data.complaint_id,
          session.tenancy_id,
          data.complaint_id,
        )
        .first();
  if (!record)
    return {
      found: false as const,
      message:
        "No matching complaint was found in this authorized account. This does not establish whether a previous tool call ran.",
    };
  return { found: true as const, ...record };
}
