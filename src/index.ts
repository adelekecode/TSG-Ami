import { checkLatestPayment } from "./payment-continuity";
import { findDemoProfiles, openDemoProfile, createDemoResident, startResidentRegistration, getOnboardingStatus } from "./onboarding";
import { Hono } from "hono";
import { z } from "zod";
import { registerConciergeTools } from "./mcp";
import { ApiError, lookupUnit, createTicket, getTicket, ticketEvents, updateTicketStatus, createTicketSchema, updateStatusSchema } from "./maintenance";
import { verifyResident, myProfile, myInvoices, startPayment, getPaymentStatus, createComplaint, applySuccessfulWebhook, validatePaystackWebhook, complaintSchema } from "./concierge";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  execute,
  schemas,
  hash,
  DomainError,
  type Env,
  type ToolName,
} from "./domain";
const app = new Hono<{ Bindings: Env }>();
app.get("/health", (c) => c.json({ ok: true, service: "ami-worker" }));
// Payment redirects convey no payment status; webhooks use the provider signature.
app.get("/payments/return", (c) => c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ami payment</title><body style="font-family:system-ui;max-width:30rem;margin:3rem auto;padding:1rem"><h2>Return to Ami 🏡</h2><p>Payment is <strong>not confirmed here</strong>. Return to Ami and say “Check my payment” so your invoice can be verified.</p><p>This is a test-mode demonstration.</p></body></html>`));
app.post("/webhooks/paystack", async (c) => {
  const raw = await c.req.text();
  if (!await validatePaystackWebhook(raw, c.req.header("x-paystack-signature") ?? null, c.env.PAYSTACK_SECRET_KEY))
    return c.json({ error: "INVALID_SIGNATURE" }, 401);
  const payload = JSON.parse(raw) as { event?: string; data?: { reference?: string } };
  if (payload?.event === "charge.success" && typeof payload.data?.reference === "string")
    await applySuccessfulWebhook(c.env, payload.data.reference);
  return c.json({ received: true });
});
app.use("*", async (c, next) => {
  const serviceKey = c.env.API_KEY || c.env.DEMO_API_TOKEN;
  if (!serviceKey) return c.json({ error: "Service key is not configured" }, 503);
  const supplied = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if ((await hash(supplied)) !== (await hash(serviceKey)))
    return c.json({ error: "Unauthorized" }, 401);
  await next();
});
app.onError((err, c) => {
  if (err instanceof z.ZodError)
    return c.json(
      {
        error: "Invalid input",
        issues: err.issues.map((x) => ({ path: x.path, message: x.message })),
      },
      400,
    );
  if (err instanceof ApiError)
    return c.json({ error: err.code, message: err.message }, err.status as 400);
  if (err instanceof DomainError)
    return c.json({ error: err.message }, err.status as 400);
  if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
  console.error("Unhandled request error", err.name);
  return c.json({ error: "Internal server error" }, 500);
});
const routes: Record<string, ToolName> = {
  "/v1/residents/context": "get_resident_context",
  "/v1/maintenance": "create_maintenance_ticket",
  "/v1/maintenance/status": "get_maintenance_status",
  "/v1/rent/summary": "get_rent_summary",
  "/v1/requests": "get_resident_requests",
};
for (const [path, name] of Object.entries(routes))
  app.post(path, async (c) =>
    c.json(await execute(c.env, name, await c.req.json())),
  );
// Both verification/complaint payloads remain supported.
app.post("/v1/residents/verify", async (c) => {
  const input = await c.req.json();
  return c.json(input && typeof input === "object" && "demo_code" in input
    ? await verifyResident(c.env.DB, input)
    : await execute(c.env, "resolve_resident", input));
});
app.post("/v1/complaints", async (c) => {
  const input = await c.req.json();
  return c.json(input && typeof input === "object" && "session_token" in input
    ? await createComplaint(c.env.DB, complaintSchema.parse(input))
    : await execute(c.env, "create_complaint", input));
});
const residentSession = (c: { req: { header(name: string): string | undefined } }) => c.req.header("x-demo-session") ?? "";
app.get("/v1/demo/profiles", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await findDemoProfiles(c.env, { name: c.req.query("name") }));
});
app.post("/v1/demo/sessions", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await openDemoProfile(c.env, await c.req.json()));
});
app.post("/v1/demo/residents", async (c) => {
  c.header("Cache-Control", "no-store");
  const result = await createDemoResident(c.env, await c.req.json());
  return c.json(result, result.created ? 201 : 200);
});
app.post("/v1/onboarding/registrations", async (c) => {
  c.header("Cache-Control", "no-store");
  const result = await startResidentRegistration(c.env, await c.req.json());
  return c.json(result, result.created ? 201 : 200);
});
app.get("/v1/onboarding/status", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await getOnboardingStatus(c.env, c.req.header("x-registration-session") ?? ""));
});
app.get("/v1/me", async (c) => c.json(await myProfile(c.env.DB, residentSession(c))));
app.get("/v1/invoices", async (c) => c.json(await myInvoices(c.env.DB, residentSession(c))));
app.post("/v1/payments/initialize", async (c) => c.json(await startPayment(c.env, await c.req.json(), new URL(c.req.url).origin)));
app.get("/v1/payments/latest", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await checkLatestPayment(c.env,{session_token:residentSession(c)}));
});
app.get("/v1/payments/:invoiceId", async (c) => c.json(await getPaymentStatus(c.env, residentSession(c), c.req.param("invoiceId"))));
app.get("/v1/units/:id", async (c) => c.json({ unit: await lookupUnit(c.env.DB, c.req.param("id")) }));
app.post("/v1/tickets", async (c) => {
  const result = await createTicket(c.env.DB, createTicketSchema.parse(await c.req.json()));
  return c.json(result, result.created ? 201 : 200);
});
app.get("/v1/tickets/:id", async (c) => c.json({ ticket: await getTicket(c.env.DB, c.req.param("id"), residentSession(c)) }));
app.get("/v1/tickets/:id/events", async (c) => c.json({ events: await ticketEvents(c.env.DB, c.req.param("id"), residentSession(c)) }));
// Service-only administration: intentionally not exposed as a resident MCP tool.
app.patch("/v1/tickets/:id/status", async (c) => c.json({ ticket: await updateTicketStatus(c.env.DB, c.req.param("id"), updateStatusSchema.parse(await c.req.json())) }));
app.all("/mcp", async (c) => {
  const server = new McpServer({
    name: "ami-tenant-concierge",
    version: "0.5.0",
  });
  for (const name of Object.keys(schemas) as ToolName[]) {
    if (name === "create_maintenance_ticket" || name === "create_complaint") continue;
    server.registerTool(
      name,
      {
        description:
          name === "resolve_resident"
            ? "Verify fictional tenant credentials and return a scoped bearer capability. Keep the token private."
            : name.replaceAll("_", " ") + " for the verified resident only.",
        inputSchema: schemas[name].shape,
      },
      async (args: Record<string, unknown>) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await execute(c.env, name, args)),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  err instanceof DomainError
                    ? err.message
                    : err instanceof z.ZodError
                      ? "Invalid tool arguments"
                      : "Unable to complete operation",
              },
            ],
          };
        }
      },
    );
  }
  registerConciergeTools(server, c.env, new URL(c.req.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close();
  }
});
export default app;
