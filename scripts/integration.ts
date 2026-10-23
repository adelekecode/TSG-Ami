import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  getPlatformProxy,
  unstable_splitSqlQuery as splitSqlQuery,
} from "wrangler";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import app from "../src/index";
import { execute, hash, type Env } from "../src/domain";

// Disables remote D1 even though the preserved application config uses remote: true.
// Never read the real service/payment keys or touch existing local/remote D1 state.
process.env.WRANGLER_SEND_METRICS = "false";
const testDirectory = mkdtempSync(join(tmpdir(), "ami-merge-test-"));
const configPath = join(testDirectory, "wrangler.json");
writeFileSync(
  configPath,
  JSON.stringify({
    name: "ami-merge-test",
    compatibility_date: "2026-10-21",
    d1_databases: [
      {
        binding: "DB",
        database_name: "ami-integration",
        database_id: "00000000-0000-0000-0000-000000000000",
        remote: false,
      },
    ],
  }),
);
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath,
  persist: false,
  remoteBindings: false,
  envFiles: [],
});
const db = proxy.env.DB;
const env: Env = {
  DB: db,
  API_KEY: "integration-service-key",
  PAYSTACK_SECRET_KEY: "sk_test_integration_mock_only",
};
const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;
const sql = async (file: string) => {
  const statements = splitSqlQuery(readFileSync(file, "utf8"));
  // One statement per prepare is required for D1; batch supports triggers.
  await db.batch(statements.map((statement) => db.prepare(statement)));
};
const rows = async (query: string) => (await db.prepare(query).all()).results;
const nativeFetch = globalThis.fetch;
let providerCalls = 0;
let providerMode = "success";
let lastInitialization: Record<string, any> = {};
let lastReference = "";
let verifyAmount = 235000;
let verifyCurrency = "NGN";
let verifyDomain = "test";
let verifyReference: string | undefined;
let initializeMode = "ok";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "api.paystack.co") return nativeFetch(input, init);
  providerCalls++;
  assert.equal(
    new Headers(init?.headers).get("authorization"),
    `Bearer ${env.PAYSTACK_SECRET_KEY}`,
  );
  if (initializeMode === "unreachable")
    throw new TypeError("mock network failure");
  if (url.pathname === "/transaction/initialize") {
    lastInitialization = JSON.parse(String(init?.body));
    lastReference = lastInitialization.reference;
    return Response.json({
      status: true,
      data: {
        reference: lastReference,
        authorization_url:
          initializeMode === "bad-url"
            ? "https://attacker.example/pay"
            : "https://checkout.paystack.com/integration-test",
      },
    });
  }
  assert(url.pathname.startsWith("/transaction/verify/"));
  return Response.json({
    status: true,
    data: {
      reference:
        verifyReference ?? decodeURIComponent(url.pathname.split("/").at(-1)!),
      domain: verifyDomain,
      currency: verifyCurrency,
      amount: verifyAmount,
      status: providerMode,
    },
  });
}) as typeof fetch;

async function request(
  path: string,
  body?: unknown,
  expected = 200,
  options: {
    method?: string;
    token?: string;
    key?: string;
    headers?: Record<string, string>;
    raw?: string;
  } = {},
) {
  const headers = new Headers({
    Authorization: `Bearer ${options.key ?? env.API_KEY}`,
    ...options.headers,
  });
  if (options.token) headers.set("X-Demo-Session", options.token);
  if (body !== undefined || options.raw !== undefined)
    headers.set("Content-Type", "application/json");
  const response = await app.fetch(
    new Request(`https://ami.example${path}`, {
      method:
        options.method ??
        (body !== undefined || options.raw !== undefined ? "POST" : "GET"),
      headers,
      body:
        options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    env,
    ctx,
  );
  assert.equal(response.status, expected, await response.clone().text());
  return response;
}
const json = async (...args: Parameters<typeof request>) =>
  (await (await request(...args)).json()) as any;
async function sign(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PAYSTACK_SECRET_KEY!),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  ).toString("hex");
}
let bridge: ReturnType<typeof createServer> | undefined;
try {
  await sql("migrations/0001_initial.sql");
  await sql("seed.sql");
  const oldSession = (await execute(env, "resolve_resident", {
    unit_id: "A204",
    onboarding_code: "AMI-DEMO-204",
  })) as any;
  const tables = [
    "residents",
    "units",
    "tenancies",
    "sessions",
    "verification_attempts",
    "requests",
    "activity_events",
    "rent_invoices",
  ];
  const before = new Map<string, any[]>();
  for (const table of tables)
    before.set(table, await rows(`SELECT * FROM ${table} ORDER BY 1`));
  await sql("migrations/0002_concierge_payments.sql");
  for (const table of tables) {
    const columns = Object.keys(before.get(table)![0]);
    assert.deepEqual(
      await rows(`SELECT ${columns.join(",")} FROM ${table} ORDER BY 1`),
      before.get(table),
      `Upgrade changed existing ${table}`,
    );
  }
  assert.equal(
    (
      (await execute(env, "get_resident_context", {
        resident_token: oldSession.resident_token,
      })) as any
    ).unit_id,
    "A204",
  );
  assert.equal((await rows("SELECT * FROM invoices")).length, 12);
  assert.equal(
    (await rows("SELECT amount_kobo FROM invoices WHERE id='inv_002'"))[0]
      .amount_kobo,
    100000000,
  );
  assert.equal(
    (await rows("SELECT status FROM invoices WHERE id='inv_003'"))[0].status,
    "paid",
  );
  await sql("seed.sql");
  await sql("seed-concierge.sql");
  const seededInvoices = await rows("SELECT * FROM invoices ORDER BY id");
  await sql("seed-concierge.sql");
  assert.deepEqual(
    await rows("SELECT * FROM invoices ORDER BY id"),
    seededInvoices,
  );
  assert.equal(
    (await rows("SELECT amount_minor FROM rent_invoices WHERE id='inv_001'"))[0]
      .amount_minor,
    150000000,
  );
  console.log(
    "Passed: additive populated-database upgrade, all original records/sessions, balances and repeatable seeds.",
  );

  await request("/health");
  await request("/payments/return");
  await request("/v1/me", undefined, 401, { key: "wrong" });
  await request("/mcp", {}, 401, { key: "wrong" });
  await request("/v1/complaints", undefined, 400, { raw: "{" });
  await request(
    "/v1/residents/verify",
    { unit_id: "A204", demo_code: "wrong-code" },
    401,
  );
  const a = await json("/v1/residents/verify", {
    unit_id: "A204",
    demo_code: "AMI-DEMO-204",
  });
  const b = await json("/v1/residents/verify", {
    unit_id: "B101",
    demo_code: "AMI-B101-DEMO",
  });
  const auth = { token: a.session_token };
  assert.equal((await json("/v1/me", undefined, 200, auth)).unit_id, "A204");
  await request("/v1/me", undefined, 401);
  await request("/v1/me", undefined, 401, {
    token: "forged-token-long-enough",
  });
  assert(
    (await json("/v1/invoices", undefined, 200, auth)).invoices.some(
      (i: any) => i.invoice_id === "ELEC-A204-OCT",
    ),
  );
  assert(
    !(
      await json("/v1/invoices", undefined, 200, { token: b.session_token })
    ).invoices.some((i: any) => i.invoice_id === "ELEC-A204-OCT"),
  );
  const expired = "expired-token-for-integration";
  await db
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .bind(await hash(expired), "ten_001", 1)
    .run();
  await request("/v1/me", undefined, 401, { token: expired });
  for (let i = 0; i < 5; i++)
    await request(
      "/v1/residents/verify",
      { unit_id: "UNKNOWN", demo_code: "wrong-code" },
      401,
    );
  await request(
    "/v1/residents/verify",
    { unit_id: "UNKNOWN", demo_code: "wrong-code" },
    429,
  );

  const ticketInput = {
    session_token: a.session_token,
    unit_id: "A204",
    description: "An exposed electrical wire in the kitchen",
    location: "Kitchen",
    category: "electrical",
    priority: "normal",
    hazard: "electrical",
    idempotency_key: "integration-maintenance-1",
  };
  const ticket = await json("/v1/tickets", ticketInput, 201);
  assert.equal(ticket.ticket.priority, "emergency");
  assert.equal((await json("/v1/tickets", ticketInput)).created, false);
  await request("/v1/tickets", { ...ticketInput, category: "other" }, 409);
  await request(
    "/v1/tickets",
    { ...ticketInput, session_token: b.session_token },
    404,
  );
  await request(`/v1/tickets/${ticket.ticket.id}`, undefined, 404, {
    token: b.session_token,
  });
  await request(`/v1/tickets/${ticket.ticket.id}`, undefined, 200, auth);
  await request(`/v1/tickets/${ticket.ticket.id}/events`, undefined, 404, {
    token: b.session_token,
  });
  await request(
    `/v1/tickets/${ticket.ticket.id}/status`,
    { status: "resolved", actor: "test-admin" },
    409,
    { method: "PATCH" },
  );
  for (const status of ["triaged", "assigned", "in_progress", "resolved"]) {
    await request(
      `/v1/tickets/${ticket.ticket.id}/status`,
      {
        status,
        actor: "test-admin",
        ...(status === "assigned" ? { assigned_to: "Demo technician" } : {}),
      },
      200,
      { method: "PATCH" },
    );
  }
  assert.equal(
    (await json(`/v1/tickets/${ticket.ticket.id}/events`, undefined, 200, auth))
      .events.length,
    5,
  );
  assert.equal(
    (
      await json("/v1/maintenance/status", {
        resident_token: a.session_token,
        request_id: ticket.ticket.id,
      })
    ).status,
    "resolved",
  );
  const complaintInput = {
    session_token: a.session_token,
    category: "noise",
    description: "Persistent late-night renovation noise",
    idempotency_key: "integration-complaint-1",
  };
  const complaint = await json("/v1/complaints", complaintInput);
  assert.equal((await json("/v1/complaints", complaintInput)).created, false);
  await request(
    "/v1/complaints",
    { ...complaintInput, session_token: b.session_token },
    409,
  );
  assert(
    (await json("/v1/requests", { resident_token: a.session_token })).some(
      (r: any) => r.id === complaint.complaint_id,
    ),
  );
  console.log(
    "Passed: both identity APIs, isolation, expiry, rate limits, detailed tickets/status/history, idempotent complaints and original request visibility.",
  );

  const paymentInput = {
    session_token: a.session_token,
    invoice_id: "ELEC-A204-OCT",
    confirmed: true,
  };
  await request(
    "/v1/payments/initialize",
    { ...paymentInput, confirmed: false },
    400,
  );
  await request(
    "/v1/payments/initialize",
    { ...paymentInput, session_token: b.session_token },
    404,
  );
  const savedKey = env.PAYSTACK_SECRET_KEY;
  const callsBefore = providerCalls;
  for (const key of [undefined, "sk_live_BLOCKED"]) {
    env.PAYSTACK_SECRET_KEY = key;
    assert.equal(
      (await json("/v1/payments/initialize", paymentInput, 503)).error,
      "TEST_KEY_REQUIRED",
    );
  }
  assert.equal(providerCalls, callsBefore);
  env.PAYSTACK_SECRET_KEY = savedKey;
  initializeMode = "bad-url";
  await request("/v1/payments/initialize", paymentInput, 502);
  initializeMode = "unreachable";
  await request("/v1/payments/initialize", paymentInput, 502);
  initializeMode = "ok";
  const payment = await json("/v1/payments/initialize", {
    ...paymentInput,
    amount: 1,
  });
  assert.equal(lastInitialization.amount, "235000");
  assert.equal(
    lastInitialization.callback_url,
    "https://ami.example/payments/return",
  );
  assert.equal(payment.environment, "test");
  assert(payment.chat_message.includes(payment.checkout_url));
  assert(payment.chat_message.includes(payment.reference));
  const callsAfter = providerCalls;
  assert.equal(
    (await json("/v1/payments/initialize", paymentInput)).reused,
    true,
  );
  assert.equal(providerCalls, callsAfter);
  await request("/v1/payments/ELEC-A204-OCT", undefined, 404, {
    token: b.session_token,
  });
  providerMode = "pending";
  assert.equal(
    (await json("/v1/payments/ELEC-A204-OCT", undefined, 200, auth))
      .verified_paid,
    false,
  );
  for (const mismatch of ["amount", "currency", "domain", "reference"]) {
    verifyAmount = mismatch === "amount" ? 1 : 235000;
    verifyCurrency = mismatch === "currency" ? "USD" : "NGN";
    verifyDomain = mismatch === "domain" ? "live" : "test";
    verifyReference = mismatch === "reference" ? "forged-reference" : undefined;
    assert.equal(
      (await json("/v1/payments/ELEC-A204-OCT", undefined, 409, auth)).error,
      "PAYMENT_MISMATCH",
    );
    assert.equal(
      (await rows("SELECT status FROM invoices WHERE id='ELEC-A204-OCT'"))[0]
        .status,
      "unpaid",
    );
  }
  verifyAmount = 235000;
  verifyCurrency = "NGN";
  verifyDomain = "test";
  verifyReference = undefined;
  providerMode = "success";
  const webhook = JSON.stringify({
    event: "charge.success",
    data: { reference: lastReference },
  });
  await request("/webhooks/paystack", undefined, 401, {
    raw: webhook,
    headers: { "x-paystack-signature": "0".repeat(128) },
  });
  const signature = await sign(webhook);
  for (let i = 0; i < 2; i++)
    await request("/webhooks/paystack", undefined, 200, {
      raw: webhook,
      headers: { "x-paystack-signature": signature },
    });
  assert.equal(
    (await json("/v1/payments/ELEC-A204-OCT", undefined, 200, auth))
      .verified_paid,
    true,
  );
  assert.equal(
    (await json("/v1/payments/initialize", paymentInput)).status,
    "already_paid",
  );
  assert.equal(
    (
      await rows("SELECT paid_reference FROM invoices WHERE id='ELEC-A204-OCT'")
    )[0].paid_reference,
    payment.reference,
  );

  // Paying a legacy rent invoice updates the original rent summary atomically.
  await json("/v1/payments/initialize", {
    ...paymentInput,
    invoice_id: "inv_001",
  });
  verifyAmount = 150000000;
  assert.equal(
    (await json("/v1/payments/inv_001", undefined, 200, auth)).verified_paid,
    true,
  );
  assert.equal(
    (await json("/v1/rent/summary", { resident_token: a.session_token }))
      .invoices[0].balance_minor,
    0,
  );
  // Partial payments retain the pre-existing credit; only the outstanding balance is charged.
  const partial = await json("/v1/residents/verify", {
    unit_id: "B105",
    demo_code: "AMI-DEMO-105",
  });
  await db
    .prepare(
      "UPDATE residents SET email='partial@example.com' WHERE id='res_002'",
    )
    .run();
  await json("/v1/payments/initialize", {
    session_token: partial.session_token,
    invoice_id: "inv_002",
    confirmed: true,
  });
  assert.equal(lastInitialization.amount, "100000000");
  verifyAmount = 100000000;
  providerMode = "failed";
  assert.equal(
    (
      await json("/v1/payments/inv_002", undefined, 200, {
        token: partial.session_token,
      })
    ).verified_paid,
    false,
  );
  assert.equal(
    (await rows("SELECT paid_minor FROM rent_invoices WHERE id='inv_002'"))[0]
      .paid_minor,
    20000000,
  );
  console.log(
    "Passed: mocked Paystack initialization/reuse, server amounts, live-key rejection, failures/mismatches, signed duplicate webhooks and rent reconciliation.",
  );

  // Exercise the real MCP client and HTTP transport, plus the original REST smoke suite.
  // Reset test-only rates/balances so original fixtures have their expected state.
  await db.prepare("DELETE FROM verification_attempts").run();
  await db
    .prepare("UPDATE rent_invoices SET paid_minor=0 WHERE id='inv_001'")
    .run();
  bridge = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const response = await app.fetch(
        new Request(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: ["GET", "HEAD"].includes(req.method!) ? undefined : body,
        }),
        env,
        ctx,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end("Test bridge failed");
    }
  });
  await new Promise<void>((resolve) => bridge!.listen(0, "127.0.0.1", resolve));
  const address = bridge.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => {
    const smoke = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/smoke.ts"],
      {
        stdio: "inherit",
        env: { ...process.env, API_KEY: env.API_KEY!, AMI_URL: base },
      },
    );
    smoke.on("error", reject);
    smoke.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Original smoke suite exited ${code}`)),
    );
  });
  const client = new Client({
    name: "ami-merge-integration",
    version: "1.0.0",
  });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${env.API_KEY}` } },
      }),
    );
    const call = async (
      name: string,
      args: Record<string, unknown>,
      isError = false,
    ) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(Boolean(result.isError), isError, JSON.stringify(result));
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const verified = await call("verify_resident", {
      unit_id: "C302",
      demo_code: "AMI-C302-DEMO",
    });
    const session = { session_token: verified.session_token };
    assert.equal((await call("get_my_profile", session)).unit_id, "C302");
    assert.equal(
      (await call("get_my_invoices", session)).invoices[0].invoice_id,
      "RENT-C302-NOV",
    );
    await call("lookup_unit", { unit_id: "C302" });
    const mcpTicket = await call("create_maintenance_ticket", {
      ...ticketInput,
      ...session,
      unit_id: "C302",
      idempotency_key: "integration-mcp-ticket",
    });
    assert.equal(
      (
        await call("get_maintenance_ticket", {
          ...session,
          ticket_id: mcpTicket.ticket.id,
        })
      ).id,
      mcpTicket.ticket.id,
    );
    await call(
      "get_maintenance_ticket",
      { session_token: a.session_token, ticket_id: mcpTicket.ticket.id },
      true,
    );
    await call("create_complaint", {
      ...complaintInput,
      ...session,
      idempotency_key: "integration-mcp-complaint",
    });
    const link = await call("create_payment_link", {
      ...session,
      invoice_id: "RENT-C302-NOV",
      confirmed: true,
    });
    assert(link.checkout_url.startsWith("https://checkout.paystack.com/"));
    verifyAmount = 8100000;
    providerMode = "pending";
    assert.equal(
      (
        await call("check_payment_status", {
          ...session,
          invoice_id: "RENT-C302-NOV",
        })
      ).verified_paid,
      false,
    );
  } finally {
    await client.close();
  }
  console.log(
    "Passed: all 14 MCP tools discovered, original REST/MCP regression suite and new MCP workflows over real Streamable HTTP.",
  );

  // A second empty database proves that fresh installs also work in migration order.
  const fresh = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  try {
    for (const file of [
      "migrations/0001_initial.sql",
      "migrations/0002_concierge_payments.sql",
      "seed.sql",
      "seed-concierge.sql",
    ])
      await fresh.env.DB.batch(
        splitSqlQuery(readFileSync(file, "utf8")).map((statement) =>
          fresh.env.DB.prepare(statement),
        ),
      );
    assert.equal(
      (await fresh.env.DB.prepare("SELECT count(*) AS n FROM invoices").first<{
        n: number;
      }>())!.n,
      16,
    );
    assert.equal(
      (await fresh.env.DB.prepare("PRAGMA foreign_key_check").all()).results
        .length,
      0,
    );
  } finally {
    await fresh.dispose();
  }
  assert.equal((await rows("PRAGMA foreign_key_check")).length, 0);
  console.log(
    "Passed: fresh database migration/seed order and foreign-key integrity. No external provider or remote database was contacted.",
  );
} finally {
  globalThis.fetch = nativeFetch;
  if (bridge)
    await new Promise<void>((resolve, reject) =>
      bridge!.close((err) => (err ? reject(err) : resolve())),
    );
  await proxy.dispose();
  rmSync(testDirectory, { recursive: true, force: true });
}
