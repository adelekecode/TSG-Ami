import { z } from "zod";
import { tenancy } from "./domain";

export const categorySchema = z.enum([
  "plumbing",
  "electrical",
  "hvac",
  "structural",
  "other",
]);
export const prioritySchema = z.enum(["emergency", "urgent", "normal"]);
export const hazardSchema = z.enum([
  "none",
  "fire",
  "gas",
  "electrical",
  "severe_flooding",
  "other",
]);
export const statusSchema = z.enum([
  "open",
  "triaged",
  "assigned",
  "in_progress",
  "resolved",
]);

export const createTicketSchema = z.object({
  session_token: z.string().min(1),
  unit_id: z.string().trim().min(2).max(32),
  description: z.string().trim().min(10).max(1000),
  location: z.string().trim().min(2).max(120),
  category: categorySchema,
  priority: prioritySchema,
  hazard: hazardSchema,
  idempotency_key: z.string().trim().min(8).max(128),
});

export const updateStatusSchema = z.object({
  status: statusSchema,
  actor: z.string().trim().min(2).max(100),
  assigned_to: z.string().trim().min(2).max(100).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export interface UnitRow {
  id: string;
  property_name: string;
  building: string;
  active: number;
}
export interface TicketRow {
  id: string;
  unit_id: string;
  tenancy_id: string;
  description: string;
  location: string;
  category: string;
  priority: string;
  hazard: string;
  status: string;
  assigned_to: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function readableTicket(ticket: TicketRow) {
  const { idempotency_key, ...safe } = ticket;
  return safe;
}

export async function lookupUnit(db: D1Database, rawId: string) {
  const id = rawId.trim().toUpperCase();
  const unit = await db
    .prepare("SELECT * FROM units WHERE id = ?")
    .bind(id)
    .first<UnitRow>();
  if (!unit || !unit.active)
    throw new ApiError(
      404,
      "UNIT_NOT_FOUND",
      "Unit not found or inactive. Verify the unit ID with management.",
    );
  return {
    id: unit.id,
    property_name: unit.property_name,
    building: unit.building,
  };
}

export async function getTicket(db: D1Database, id: string, token?: string) {
  const owner =
    token === undefined ? undefined : await tenancy({ DB: db }, token);
  const ticket = await db
    .prepare("SELECT * FROM maintenance_tickets WHERE id = ?")
    .bind(id)
    .first<TicketRow>();
  if (!ticket || (owner && ticket.tenancy_id !== owner.id))
    throw new ApiError(
      404,
      "TICKET_NOT_FOUND",
      "Maintenance ticket not found.",
    );
  return readableTicket(ticket);
}

export async function createTicket(db: D1Database, input: CreateTicketInput) {
  const data = createTicketSchema.parse(input);
  const owner = await tenancy({ DB: db }, data.session_token);
  if (owner.unit_id !== data.unit_id.trim().toUpperCase())
    throw new ApiError(
      404,
      "UNIT_NOT_FOUND",
      "No unit found for this verified resident.",
    );
  const unit = await lookupUnit(db, data.unit_id);
  // The backend enforces emergency classification for specified serious hazards.
  const priority = ["fire", "gas", "electrical", "severe_flooding"].includes(
    data.hazard,
  )
    ? "emergency"
    : data.priority;
  const existing = await db
    .prepare("SELECT * FROM maintenance_tickets WHERE idempotency_key = ?")
    .bind(data.idempotency_key)
    .first<TicketRow>();
  if (existing) {
    if (
      existing.tenancy_id !== owner.id ||
      existing.category !== data.category ||
      existing.priority !== priority ||
      existing.hazard !== data.hazard ||
      existing.unit_id !== unit.id ||
      existing.description !== data.description ||
      existing.location !== data.location
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request key has already been used for a different issue.",
      );
    }
    return { ticket: readableTicket(existing), created: false };
  }

  const id = `MNT-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO maintenance_tickets
      (id,unit_id,tenancy_id,description,location,category,priority,hazard,status,assigned_to,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        unit.id,
        owner.id,
        data.description,
        data.location,
        data.category,
        priority,
        data.hazard,
        "open",
        null,
        data.idempotency_key,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO ticket_events (ticket_id,event_type,actor,details,created_at)
      SELECT ?, 'created', 'Ami', ?, ? WHERE EXISTS (SELECT 1 FROM maintenance_tickets WHERE id = ?)`,
      )
      .bind(
        id,
        JSON.stringify({
          priority,
          category: data.category,
          hazard: data.hazard,
        }),
        now,
        id,
      ),
  ]);
  const saved = await db
    .prepare("SELECT * FROM maintenance_tickets WHERE idempotency_key = ?")
    .bind(data.idempotency_key)
    .first<TicketRow>();
  if (!saved)
    throw new ApiError(
      500,
      "PERSISTENCE_ERROR",
      "Could not confirm ticket persistence.",
    );
  if (
    saved.tenancy_id !== owner.id ||
    saved.category !== data.category ||
    saved.priority !== priority ||
    saved.hazard !== data.hazard ||
    saved.unit_id !== unit.id ||
    saved.description !== data.description ||
    saved.location !== data.location
  ) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This request key has already been used for a different issue.",
    );
  }
  return { ticket: readableTicket(saved), created: saved.id === id };
}

const nextStates: Record<string, string[]> = {
  open: ["triaged"],
  triaged: ["assigned"],
  assigned: ["in_progress"],
  in_progress: ["resolved"],
  resolved: [],
};

export async function updateTicketStatus(
  db: D1Database,
  id: string,
  input: UpdateStatusInput,
) {
  const data = updateStatusSchema.parse(input);
  const current = await db
    .prepare("SELECT * FROM maintenance_tickets WHERE id = ?")
    .bind(id)
    .first<TicketRow>();
  if (!current)
    throw new ApiError(
      404,
      "TICKET_NOT_FOUND",
      "Maintenance ticket not found.",
    );
  if (!nextStates[current.status]?.includes(data.status)) {
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `Cannot move ticket from ${current.status} to ${data.status}.`,
    );
  }
  if (data.status === "assigned" && !data.assigned_to) {
    throw new ApiError(
      400,
      "ASSIGNEE_REQUIRED",
      "assigned_to is required when assigning a ticket.",
    );
  }
  const now = new Date().toISOString();
  const assignee = data.assigned_to ?? current.assigned_to;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE maintenance_tickets SET status = ?, assigned_to = ?, updated_at = ?
      WHERE id = ? AND status = ?`,
      )
      .bind(data.status, assignee, now, id, current.status),
    db
      .prepare(
        `INSERT INTO ticket_events (ticket_id, event_type, actor, details, created_at)
      SELECT ?, ?, ?, ?, ? WHERE changes() > 0 AND EXISTS (SELECT 1 FROM maintenance_tickets WHERE id = ? AND status = ? AND updated_at = ?)`,
      )
      .bind(
        id,
        data.status,
        data.actor,
        JSON.stringify({
          from: current.status,
          to: data.status,
          assigned_to: assignee,
        }),
        now,
        id,
        data.status,
        now,
      ),
  ]);
  if (results[0].meta.changes < 1) {
    throw new ApiError(
      409,
      "CONCURRENT_UPDATE",
      "Ticket was modified by another request. Fetch the latest status.",
    );
  }
  return getTicket(db, id);
}

export async function ticketEvents(db: D1Database, id: string, token: string) {
  await getTicket(db, id, token);
  const { results } = await db
    .prepare("SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY id ASC")
    .bind(id)
    .all();
  return results;
}
