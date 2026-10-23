import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const base = process.env.AMI_URL ?? "http://127.0.0.1:8787";
const key =
  process.env.API_KEY ??
  readFileSync(".dev.vars", "utf8").match(/^API_KEY=(.+)$/m)?.[1];
assert(key, "Set API_KEY or create .dev.vars");
async function post(
  path: string,
  body: unknown,
  expected = 200,
  authorization = key,
) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, expected, await res.clone().text());
  return (await res.json()) as any;
}
assert.equal((await fetch(base + "/health")).status, 200);
await post("/v1/rent/summary", {}, 401, "wrong-key");
await post(
  "/v1/residents/verify",
  { unit_id: "A204", onboarding_code: "wrong" },
  401,
);
const unknownUnit = "test-" + Date.now();
for (let i = 0; i < 5; i++)
  await post(
    "/v1/residents/verify",
    { unit_id: unknownUnit, onboarding_code: "invalid" },
    401,
  );
await post(
  "/v1/residents/verify",
  { unit_id: unknownUnit, onboarding_code: "invalid" },
  429,
);
const a = await post("/v1/residents/verify", {
  unit_id: "A204",
  onboarding_code: "AMI-DEMO-204",
});
const b = await post("/v1/residents/verify", {
  unit_id: "B105",
  onboarding_code: "AMI-DEMO-105",
});
const auth = { resident_token: a.resident_token };
assert.equal((await post("/v1/residents/context", auth)).unit_id, "A204");
await post("/v1/residents/context", { resident_token: "forged" }, 401);
await post("/v1/maintenance", { ...auth, description: "x" }, 400);
const ticket = await post("/v1/maintenance", {
  ...auth,
  description: "Bathroom tap is leaking (automated demo test)",
});
assert.equal(
  (await post("/v1/maintenance/status", { ...auth, request_id: ticket.id }))
    .status,
  "open",
);
await post(
  "/v1/maintenance/status",
  { resident_token: b.resident_token, request_id: ticket.id },
  404,
);
const complaint = await post("/v1/complaints", {
  ...auth,
  description: "Noise complaint (automated demo test)",
});
assert(
  (await post("/v1/requests", auth)).some((x: any) => x.id === complaint.id),
);
assert.equal(
  (await post("/v1/rent/summary", auth)).invoices[0].balance_minor,
  150000000,
);
const client = new Client({ name: "ami-smoke", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
    requestInit: { headers: { Authorization: "Bearer " + key } },
  }),
);
const tools = (await client.listTools()).tools.map((tool) => tool.name);
for (const name of [
  "resolve_resident",
  "get_resident_context",
  "create_maintenance_ticket",
  "get_maintenance_status",
  "create_complaint",
  "get_rent_summary",
  "get_resident_requests",
  "lookup_unit",
  "get_maintenance_ticket",
  "verify_resident",
  "get_my_profile",
  "get_my_invoices",
  "create_payment_link",
  "check_payment_status",
])
  assert(tools.includes(name), `Missing MCP tool: ${name}`);
assert.equal(tools.length, 14);
const context = await client.callTool({
  name: "get_resident_context",
  arguments: auth,
});
assert(!context.isError);
assert(JSON.stringify(context).includes("A204"));
const created = await client.callTool({
  name: "create_complaint",
  arguments: { ...auth, description: "MCP transport persistence test" },
});
assert(!created.isError);
const denied = await client.callTool({
  name: "get_resident_context",
  arguments: { resident_token: "forged" },
});
assert.equal(denied.isError, true);
await client.close();
console.log(
  "Passed: REST workflows, persistence, validation, resident isolation, service auth, MCP initialization/list/call/errors.",
);
