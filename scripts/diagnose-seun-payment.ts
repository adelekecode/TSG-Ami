import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const base = "https://ami-worker.oluwafemiadeleke13.workers.dev";
const key = (
  process.env.API_KEY ??
  readFileSync(".dev.vars", "utf8").match(/^API_KEY=(.+)$/m)?.[1]
)
  ?.trim()
  .replace(/^(["'])(.*)\1$/, "$2");
assert(key, "Private integration key required");
const client = new Client({ name: "ami-seun-diagnostic", version: "1.0.0" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, `Diagnostic tool failed: ${name}`);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  const opened = await call("open_demo_profile", {
    demo_profile_id: "demo_seun_a204",
    confirmed: true,
  });
  const session = { session_token: opened.session_token };
  const invoices = (await call("get_my_invoices", session)).invoices;
  const invoice = invoices.find((i: any) => i.invoice_id === "ELEC-A204-OCT");
  assert(invoice, "Fictional Seun invoice unavailable");
  const result = await call("check_payment_status", {
    ...session,
    invoice_id: invoice.invoice_id,
  });
  const evidence = {
    source: "direct diagnostic MCP client, not Chord",
    checked_at: new Date().toISOString(),
    invoice_id: invoice.invoice_id,
    invoice_status_before: invoice.status,
    reference: result.reference,
    payment_status: result.payment_status,
    verified_paid: result.verified_paid,
    invoice_status_after: result.invoice.status,
  };
  writeFileSync(
    ".wrangler/v7-seun-diagnosis.json",
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await client.close();
}
