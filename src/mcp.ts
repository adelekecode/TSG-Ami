import { createDemoResident, startResidentRegistration, getOnboardingStatus, createDemoResidentSchema, startRegistrationSchema, registrationStatusSchema } from "./onboarding";
import {
  findDemoProfiles,
  openDemoProfile,
  findDemoProfilesSchema,
  openDemoProfileSchema,
} from "./onboarding";
import type { Env } from "./domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execute, DomainError } from "./domain";
import {
  createTicket,
  getTicket,
  lookupUnit,
  ApiError,
  createTicketSchema,
} from "./maintenance";
import {
  createComplaint,
  complaintSchema,
  getPaymentStatus,
  myInvoices,
  myProfile,
  startPayment,
  verifyResident,
} from "./concierge";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
const fail = (err: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        error:
          err instanceof ApiError
            ? err.code
            : err instanceof DomainError
              ? "RESIDENT_ERROR"
              : "TOOL_ERROR",
        message:
          err instanceof ApiError || err instanceof DomainError
            ? err.message
            : "The system could not complete the request.",
      }),
    },
  ],
});
export function registerConciergeTools(
  server: McpServer,
  env: Env,
  origin: string,
) {
  server.registerTool(
    "lookup_unit",
    {
      description:
        "Verify a fictional unit is active. This does NOT verify a tenant identity.",
      inputSchema: { unit_id: z.string().min(2) },
    },
    async ({ unit_id }) => {
      try {
        return ok(await lookupUnit(env.DB, unit_id));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "create_maintenance_ticket",
    {
      description:
        "Persist confirmed maintenance. Use session_token with unit_id, description, location, category, priority, hazard and idempotency_key for detailed tickets. Legacy resident_token + description is also supported. An open ticket does not imply dispatch. Ask permission before calling.",
      inputSchema: {
        resident_token: z.string().min(1).optional(),
        session_token: z.string().min(1).optional(),
        unit_id: z.string().min(2).optional(),
        description: z.string().trim().min(5).max(4000),
        location: z.string().min(2).optional(),
        category: z
          .enum(["plumbing", "electrical", "hvac", "structural", "other"])
          .optional(),
        priority: z.enum(["emergency", "urgent", "normal"]).optional(),
        hazard: z
          .enum([
            "none",
            "fire",
            "gas",
            "electrical",
            "severe_flooding",
            "other",
          ])
          .optional(),
        idempotency_key: z.string().min(8).optional(),
      },
    },
    async (params) => {
      try {
        return ok(
          params.session_token
            ? await createTicket(env.DB, createTicketSchema.parse(params))
            : await execute(env, "create_maintenance_ticket", params),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "get_maintenance_ticket",
    {
      description:
        "Look up status of a specific maintenance ticket. No claim of technician dispatch.",
      inputSchema: {
        ticket_id: z.string().min(5),
        session_token: z.string().min(1),
      },
    },
    async ({ ticket_id, session_token }) => {
      try {
        return ok(await getTicket(env.DB, ticket_id, session_token));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "verify_resident",
    {
      description:
        "Verify a fictional demo tenant using unit_id and onboarding code. Name alone is NOT verification. Keep the returned session_token private and use it in later tool calls; NEVER print it in chat.",
      inputSchema: { unit_id: z.string().min(2), demo_code: z.string().min(4) },
    },
    async (params) => {
      try {
        return ok(await verifyResident(env.DB, params));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "get_my_profile",
    {
      description:
        "Get property/tenancy context ONLY using the validated demo session token from verify_resident.",
      inputSchema: { session_token: z.string().min(20) },
    },
    async ({ session_token }) => {
      try {
        return ok(await myProfile(env.DB, session_token));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "get_my_invoices",
    {
      description:
        "Read rent and utility amounts for the verified resident only, scoped by session token. Amounts come from D1.",
      inputSchema: { session_token: z.string().min(20) },
    },
    async ({ session_token }) => {
      try {
        return ok(await myInvoices(env.DB, session_token));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "create_payment_link",
    {
      description:
        "Create/reuse a REAL Paystack TEST checkout URL for a verified resident after explicit confirmation. The response includes checkout_url and WhatsApp-ready chat_message; paste the exact returned link directly in chat. This is not a payment receipt.",
      inputSchema: {
        session_token: z.string().min(20),
        invoice_id: z.string().min(4),
        confirmed: z.literal(true),
      },
    },
    async (params) => {
      try {
        return ok(await startPayment(env, params, origin));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "check_payment_status",
    {
      description:
        "Verify pending Paystack TEST payment on server and report paid ONLY if verified_paid is true. Use the resident-specific invoice ID.",
      inputSchema: {
        session_token: z.string().min(20),
        invoice_id: z.string().min(4),
      },
    },
    async ({ session_token, invoice_id }) => {
      try {
        return ok(await getPaymentStatus(env, session_token, invoice_id));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "create_complaint",
    {
      description:
        "Save a confirmed complaint. Use session_token with category, description and idempotency_key; legacy resident_token + description remains supported. Never promise a human response time or resolution.",
      inputSchema: {
        resident_token: z.string().min(1).optional(),
        session_token: z.string().min(1).optional(),
        category: z
          .enum(["noise", "security", "cleanliness", "management", "other"])
          .optional(),
        description: z.string().trim().min(5).max(4000),
        idempotency_key: z.string().min(8).optional(),
      },
    },
    async (params) => {
      try {
        return ok(
          params.session_token
            ? await createComplaint(env.DB, complaintSchema.parse(params))
            : await execute(env, "create_complaint", params),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "find_demo_profiles",
    {
      description:
        "Discover at most five fictional sample profiles using a display name only as a search hint. Returns safe matches or sample options, never private account data. Ask the tester to choose and confirm a sample before opening it. Requires demo mode and a Paystack test key.",
      inputSchema: findDemoProfilesSchema.shape,
    },
    async (params) => {
      try {
        return ok(await findDemoProfiles(env, params));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "open_demo_profile",
    {
      description:
        "Open a chosen fictional profile ONLY after the tester explicitly confirms it. This is sample selection, not identity verification. Returns a private session_token valid for 30 minutes: NEVER print or log it or store it in conversational memory. Pass it internally to get_my_profile, get_my_invoices and other resident tools in this chat.",
      inputSchema: openDemoProfileSchema.shape,
    },
    async (params) => {
      try {
        return ok(await openDemoProfile(env, params));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool("create_demo_resident", {
    description: "Demo/test only: after explicit permission, atomically persist a fictional resident, apartment, tenancy, rent invoice and electricity invoice. Reuse request_key on retries. The returned 30-minute session_token is private; never show it in chat or store it in memory. This does not establish real residency.",
    inputSchema: createDemoResidentSchema.shape,
  }, async (params) => { try { return ok(await createDemoResident(env,params)); } catch(e) { return fail(e); } });
  server.registerTool("start_resident_registration", {
    description: "Record an unverified pending registration with explicit consent and a request_key reused on retries. Grants NO resident/invoice access and sends NO manager notification. Keep the returned registration_token private.",
    inputSchema: startRegistrationSchema.shape,
  }, async (params) => { try { return ok(await startResidentRegistration(env,params)); } catch(e) { return fail(e); } });
  server.registerTool("get_onboarding_status", {
    description: "Check registration status using its private registration_token. A reference alone grants no lookup or tenancy access. Never print the token in chat.",
    inputSchema: registrationStatusSchema.shape,
  }, async ({registration_token}) => { try { return ok(await getOnboardingStatus(env,registration_token)); } catch(e) { return fail(e); } });
  return server;
}
