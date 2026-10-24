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
  expected: number | readonly number[] = 200,
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
  assert((typeof expected === "number" ? [expected] : expected).includes(response.status), `Expected ${expected}, got ${response.status}: ${await response.clone().text()}`);
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

  // v5 demo onboarding reuses the current hashed session store and all private APIs.
  await sql("migrations/0003_demo_profiles.sql");
  await sql("seed-demo.sql");
  const demoSeed = await rows("SELECT * FROM demo_profiles ORDER BY demo_profile_id");
  const demoInvoices = await rows("SELECT * FROM invoices ORDER BY id");
  await sql("seed-demo.sql");
  assert.deepEqual(await rows("SELECT * FROM demo_profiles ORDER BY demo_profile_id"), demoSeed);
  assert.deepEqual(await rows("SELECT * FROM invoices ORDER BY id"), demoInvoices);
  assert.equal(demoSeed.length, 4);
  const sessionCount = (await rows("SELECT count(*) AS n FROM sessions"))[0].n;
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    env.DEMO_MODE = flag;
    await request("/v1/demo/profiles?name=Leke", undefined, 404);
    await request("/v1/demo/sessions", { demo_profile_id: "demo_leke_l410", confirmed: true }, 404);
  }
  env.DEMO_MODE = "true";
  for (const key of [undefined, "sk_live_BLOCKED", "sk_test_"]) {
    env.PAYSTACK_SECRET_KEY = key;
    await request("/v1/demo/profiles?name=Leke", undefined, 503);
    await request("/v1/demo/sessions", { demo_profile_id: "demo_leke_l410", confirmed: true }, 503);
  }
  env.PAYSTACK_SECRET_KEY = savedKey;
  assert.equal((await rows("SELECT count(*) AS n FROM sessions"))[0].n, sessionCount);
  await request("/v1/demo/profiles?name=Leke", undefined, 401, { key: "wrong" });
  await request("/v1/demo/sessions", { demo_profile_id: "demo_leke_l410", confirmed: true }, 401, { key: "wrong" });
  const leke = await json("/v1/demo/profiles?name=%20LEKE%20");
  assert.equal(leke.profiles.length, 1);
  assert.equal(leke.profiles[0].display_name, "Leke");
  assert.deepEqual(leke.sample_profiles, []);
  assert.equal((await request("/v1/demo/profiles")).headers.get("cache-control"), "no-store");
  const seuns = await json("/v1/demo/profiles?name=seun");
  assert.equal(seuns.profiles.length, 2);
  assert.notEqual(seuns.profiles[0].building_label, seuns.profiles[1].building_label);
  for (const query of ["Someone%20New", "Nneka", "%25", "'%20OR%201=1--"]) {
    const absent = await json("/v1/demo/profiles?name="+query);
    assert.deepEqual(absent.profiles, []);
    assert(absent.sample_profiles.length > 0 && absent.sample_profiles.length <= 5);
  }
  for (const profile of [...leke.profiles, ...seuns.profiles, ...(await json("/v1/demo/profiles")).sample_profiles])
    assert.deepEqual(Object.keys(profile).sort(), ["building_label", "demo_profile_id", "display_name", "property_name"]);
  // More than five eligible records must still return at most five options.
  for (let i=0;i<6;i++) await db.batch([
    db.prepare("INSERT INTO residents(id,preferred_name) VALUES (?, 'Bounded')").bind(`test_r_${i}`),
    db.prepare("INSERT INTO units(id,property_name) VALUES (?, 'Fictional limit fixture')").bind(`TEST${i}`),
    db.prepare("INSERT INTO tenancies VALUES (?,?,?,?,1)").bind(`test_t_${i}`,`test_r_${i}`,`TEST${i}`,"test-only-hash"),
    db.prepare("INSERT INTO demo_profiles VALUES (?,?)").bind(`demo_test_${i}`,`test_t_${i}`),
  ]);
  assert.equal((await json("/v1/demo/profiles?name=bounded")).profiles.length, 5);
  assert.equal((await json("/v1/demo/profiles?name=Someone%20New")).sample_profiles.length, 5);
  await db.prepare("DELETE FROM demo_profiles WHERE demo_profile_id LIKE 'demo_test_%'").run();
  await request("/v1/demo/profiles?name="+"x".repeat(81), undefined, 400);
  for (const body of [
    { demo_profile_id: "demo_leke_l410" },
    { demo_profile_id: "demo_leke_l410", confirmed: false },
    { demo_profile_id: "ten_001", confirmed: true },
    { demo_profile_id: "demo_leke_l410", confirmed: true, sender_id: "untrusted" },
  ]) await request("/v1/demo/sessions", body, 400);
  await request("/v1/demo/sessions", { demo_profile_id: "demo_unknown", confirmed: true }, 404);
  await db.prepare("UPDATE units SET active=0 WHERE id='L410'").run();
  assert.equal((await json("/v1/demo/profiles?name=Leke")).profiles.length, 0);
  await request("/v1/demo/sessions", { demo_profile_id: "demo_leke_l410", confirmed: true }, 404);
  await db.prepare("UPDATE units SET active=1 WHERE id='L410'").run();
  const opened = await json("/v1/demo/sessions", { demo_profile_id: leke.profiles[0].demo_profile_id, confirmed: true });
  assert.equal(opened.mode, "demo");
  assert.equal(opened.expires_in_seconds, 1800);
  const capability = (await db.prepare("SELECT * FROM sessions WHERE token_hash=?").bind(await hash(opened.session_token)).first()) as any;
  assert(capability.expires_at - Math.floor(Date.now()/1000) <= 1800);
  assert(capability.expires_at - Math.floor(Date.now()/1000) >= 1795);
  assert.notEqual(capability.token_hash, opened.session_token);
  const lekeAuth = { token: opened.session_token };
  const lekeProfile = await json("/v1/me", undefined, 200, lekeAuth);
  assert.equal(lekeProfile.name, "Leke");
  assert.equal(lekeProfile.unit_id, "L410");
  assert(!JSON.stringify(lekeProfile).includes(opened.session_token));
  const bills = (await json("/v1/invoices", undefined, 200, lekeAuth)).invoices;
  assert.equal(bills.length, 2);
  assert(bills.some((i: any) => i.type === "rent" && i.status === "unpaid"));
  assert(bills.some((i: any) => i.type === "utility" && i.amount_kobo === 315000));
  await request("/v1/payments/ELEC-A204-OCT", undefined, 404, lekeAuth);
  const lekePayment = { session_token: opened.session_token, invoice_id: "ELEC-L410-OCT", confirmed: true };
  await request("/v1/payments/initialize", { ...lekePayment, confirmed: false }, 400);
  await request("/v1/payments/initialize", { ...lekePayment, invoice_id: "ELEC-A204-OCT" }, 404);
  const lekeLink = await json("/v1/payments/initialize", { ...lekePayment, amount: 1 });
  assert.equal(lastInitialization.amount, "315000");
  assert.equal(lekeLink.checkout_url, "https://checkout.paystack.com/integration-test");
  assert.equal(lekeLink.environment, "test");
  env.PAYSTACK_SECRET_KEY = "sk_live_BLOCKED";
  await request("/v1/payments/initialize", lekePayment, 503); // Even reuse is blocked.
  env.PAYSTACK_SECRET_KEY = savedKey;
  verifyAmount = 315000;
  providerMode = "pending";
  assert.equal((await json("/v1/payments/ELEC-L410-OCT", undefined, 200, lekeAuth)).verified_paid, false);
  assert.equal((await rows("SELECT status FROM invoices WHERE id='ELEC-L410-OCT'"))[0].status, "unpaid");
  providerMode = "success";
  assert.equal((await json("/v1/payments/ELEC-L410-OCT", undefined, 200, lekeAuth)).verified_paid, true);
  await json("/v1/complaints", { ...complaintInput, session_token: opened.session_token, idempotency_key: "demo-leke-complaint" });
  await json("/v1/tickets", { ...ticketInput, session_token: opened.session_token, unit_id: "L410", idempotency_key: "demo-leke-ticket" }, 201);
  await db.prepare("UPDATE sessions SET expires_at=1 WHERE token_hash=?").bind(await hash(opened.session_token)).run();
  await request("/v1/me", undefined, 401, lekeAuth);
  console.log("Passed: v5 fictional allowlist, bounded/case-insensitive discovery, safe no-match samples, duplicate names, explicit selection, flag/live-key gates, hashed 30-minute sessions, private ownership and mocked test checkout.");

  // v6 visitor and pending-registration paths, adapted to the existing tenancy schema.
  const preV6Profiles = await rows("SELECT demo_profile_id,tenancy_id FROM demo_profiles ORDER BY 1");
  await sql("migrations/0004_demo_onboarding.sql");
  assert.deepEqual(await rows("SELECT demo_profile_id,tenancy_id FROM demo_profiles ORDER BY 1"), preV6Profiles);
  const count = async (table: string) => Number((await rows(`SELECT count(*) AS n FROM ${table}`))[0].n);
  const businessCounts = async () => Promise.all(["units","residents","tenancies","invoices","rent_invoices","demo_profiles","sessions"].map(count));
  const visitorInput = { display_name:"Demo Visitor", confirmed:true, request_key:"v6-visitor-request-0001" };
  const registrationInput = { display_name:"Pending Demo Applicant",property_hint:"Fictional residence",unit_hint:"Example A204",notes:"Fictional registration test",confirmed:true,request_key:"v6-registration-request-0001" };
  for (const bad of [
    {...visitorInput,confirmed:false}, {...visitorInput,display_name:"x"}, {...visitorInput,display_name:"<script>"},
    {...visitorInput,request_key:"short"}, {...visitorInput,property:"unknown"}, {...visitorInput,sender_id:"untrusted"},
    {confirmed:true,request_key:"v6-invalid-no-name-0001"},
  ]) await request("/v1/demo/residents",bad,400);
  await request("/v1/demo/residents",visitorInput,401,{key:"wrong"});
  const beforeVisitor = await businessCounts();
  const visitor = await json("/v1/demo/residents",visitorInput,201);
  assert.equal(visitor.created,true);
  assert.equal(visitor.mode,"demo");
  assert.deepEqual(await businessCounts(),beforeVisitor.map((n,i)=>n+(i===3?2:1)));
  const visitorAuth = {token:visitor.session_token};
  const visitorProfile = await json("/v1/me",undefined,200,visitorAuth);
  assert.equal(visitorProfile.name,"Demo Visitor");
  assert(visitorProfile.unit_id.startsWith("DM-"));
  const visitorBills = (await json("/v1/invoices",undefined,200,visitorAuth)).invoices;
  assert.equal(visitorBills.length,2);
  assert(visitorBills.some((i:any)=>i.type==="rent" && i.amount_kobo===7500000));
  const visitorUtility=visitorBills.find((i:any)=>i.type==="utility");
  assert.equal(visitorUtility.amount_kobo,235000);
  const stableBusinessCounts=(await businessCounts()).slice(0,6);
  const again=await json("/v1/demo/residents",visitorInput);
  assert.equal(again.created,false);
  assert.equal(again.profile.demo_profile_id,visitor.profile.demo_profile_id);
  assert.deepEqual((await businessCounts()).slice(0,6),stableBusinessCounts);
  for(const change of [{display_name:"Different Visitor"},{property:"palm_heights"}])
    await request("/v1/demo/residents",{...visitorInput,...change},409);
  assert.equal((await json("/v1/demo/profiles?name=Demo%20Visitor")).profiles[0].demo_profile_id,visitor.profile.demo_profile_id);
  const reopenedVisitor=await json("/v1/demo/sessions",{demo_profile_id:visitor.profile.demo_profile_id,confirmed:true});
  assert.equal((await json("/v1/me",undefined,200,{token:reopenedVisitor.session_token})).unit_id,visitorProfile.unit_id);
  // Concurrent identical retries create one business account; conflicting retries cannot switch property.
  const raceInput={...visitorInput,request_key:"v6-visitor-concurrent-0001"};
  const raced=await Promise.all([json("/v1/demo/residents",raceInput,[200,201]),json("/v1/demo/residents",raceInput,[200,201])]);
  assert.deepEqual(raced.map(x=>x.created).sort(),[false,true]);
  assert.equal(raced[0].profile.demo_profile_id,raced[1].profile.demo_profile_id);
  assert.equal((await rows("SELECT * FROM demo_profiles WHERE creation_key='v6-visitor-concurrent-0001'")).length,1);
  const conflictKey="v6-visitor-conflicting-0001";
  const conflictResults=await Promise.all([
    request("/v1/demo/residents",{...visitorInput,request_key:conflictKey},[201,409]),
    request("/v1/demo/residents",{...visitorInput,property:"palm_heights",request_key:conflictKey},[201,409]),
  ]);
  assert.deepEqual(conflictResults.map(x=>x.status).sort(),[201,409]);
  assert.equal((await rows("SELECT * FROM demo_profiles WHERE creation_key='v6-visitor-conflicting-0001'")).length,1);
  // A failure on the second invoice must roll back units, resident, tenancy, registry,
  // first invoice and session together, rather than leaving half an account.
  await db.prepare("CREATE TRIGGER test_abort_utility BEFORE INSERT ON invoices WHEN NEW.description='Sample electricity bill' BEGIN SELECT RAISE(ABORT,'injected-test-failure'); END").run();
  const beforeFailure=await businessCounts();
  const originalError=console.error;
  const logs:string[]=[];
  console.error=(...args:unknown[])=>{logs.push(args.map(String).join(" "));};
  try { await request("/v1/demo/residents",{...visitorInput,request_key:"v6-atomic-failure-0001"},500); }
  finally { console.error=originalError; }
  assert.deepEqual(await businessCounts(),beforeFailure);
  assert(logs.every(line=>!line.includes(visitor.session_token)));
  await db.prepare("DROP TRIGGER test_abort_utility").run();
  await request("/v1/payments/ELEC-A204-OCT",undefined,404,visitorAuth);
  await json("/v1/complaints",{...complaintInput,session_token:visitor.session_token,idempotency_key:"v6-visitor-complaint"});
  await json("/v1/tickets",{...ticketInput,session_token:visitor.session_token,unit_id:visitorProfile.unit_id,idempotency_key:"v6-visitor-ticket"},201);
  const visitorPayment=await json("/v1/payments/initialize",{session_token:visitor.session_token,invoice_id:visitorUtility.invoice_id,confirmed:true});
  assert.equal(visitorPayment.checkout_url,"https://checkout.paystack.com/integration-test");
  assert.equal(lastInitialization.amount,"235000");
  verifyAmount=235000;
  providerMode="pending";
  assert.equal((await json(`/v1/payments/${visitorUtility.invoice_id}`,undefined,200,visitorAuth)).verified_paid,false);
  assert.equal((await rows(`SELECT status FROM invoices WHERE id='${visitorUtility.invoice_id}'`))[0].status,"unpaid");
  providerMode="success";
  assert.equal((await json(`/v1/payments/${visitorUtility.invoice_id}`,undefined,200,visitorAuth)).verified_paid,true);
  for(const bad of [{...registrationInput,confirmed:false},{...registrationInput,notes:"x".repeat(501)},{...registrationInput,display_name:"<bad>"}])
    await request("/v1/onboarding/registrations",bad,400);
  const beforeRegistration=await businessCounts();
  const registration=await json("/v1/onboarding/registrations",registrationInput,201);
  assert.equal(registration.status,"pending");
  assert.equal(registration.access_granted,false);
  assert(!("session_token" in registration));
  assert.deepEqual(await businessCounts(),beforeRegistration);
  const statusAuth={headers:{"x-registration-session":registration.registration_token}};
  assert.equal((await json("/v1/onboarding/status",undefined,200,statusAuth)).registration_id,registration.registration_id);
  await request("/v1/me",undefined,401,{token:registration.registration_token});
  await request("/v1/invoices",undefined,401,{token:registration.registration_token});
  await request("/v1/onboarding/status",undefined,400,{headers:{"x-registration-session":registration.registration_id}});
  await request("/v1/onboarding/status",undefined,404,{headers:{"x-registration-session":visitor.session_token}});
  const registrationAgain=await json("/v1/onboarding/registrations",registrationInput);
  assert.equal(registrationAgain.created,false);
  assert.equal(registrationAgain.registration_id,registration.registration_id);
  assert.equal((await json("/v1/onboarding/status",undefined,200,statusAuth)).status,"pending"); // Prior lookup token stays valid.
  for(const change of [{display_name:"Another Applicant"},{property_hint:"Another property"},{notes:"Different notes"}])
    await request("/v1/onboarding/registrations",{...registrationInput,...change},409);
  assert.equal((await rows("SELECT * FROM onboarding_registrations WHERE request_key='v6-registration-request-0001'")).length,1);
  const registrationRaceInput={...registrationInput,request_key:"v6-registration-concurrent-0001"};
  const registrationRace=await Promise.all([json("/v1/onboarding/registrations",registrationRaceInput,[200,201]),json("/v1/onboarding/registrations",registrationRaceInput,[200,201])]);
  assert.deepEqual(registrationRace.map(x=>x.created).sort(),[false,true]);
  assert.equal(registrationRace[0].registration_id,registrationRace[1].registration_id);
  for(const result of registrationRace)
    assert.equal((await json("/v1/onboarding/status",undefined,200,{headers:{"x-registration-session":result.registration_token}})).status,"pending");
  await db.prepare("UPDATE onboarding_registration_sessions SET expires_at=1 WHERE token_hash=?").bind(await hash(registration.registration_token)).run();
  await request("/v1/onboarding/status",undefined,404,statusAuth);
  const demoRoutes:[string,unknown][]=[
    ["/v1/demo/residents",visitorInput], ["/v1/onboarding/registrations",registrationInput], ["/v1/onboarding/status",undefined],
  ];
  for(const [flag,key,expected] of [["false",savedKey,404],["true","sk_live_BLOCKED",503],["true",undefined,503]] as const) {
    env.DEMO_MODE=flag; env.PAYSTACK_SECRET_KEY=key;
    for(const [path,body] of demoRoutes) await request(path,body,expected,statusAuth);
  }
  env.DEMO_MODE="true"; env.PAYSTACK_SECRET_KEY=savedKey;
  console.log("Passed: v6 visitor atomic creation/rollback, retry/conflict isolation, generated account invoices/maintenance/complaints/test checkout, pending registration separation, private lookup expiry, and demo/live-key gates.");

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
    const allTools = (await client.listTools()).tools;
    assert.equal(allTools.length, 19);
    const discovery = await call("find_demo_profiles", { name: "Leke" });
    assert.equal(discovery.profiles.length, 1);
    const demo = await call("open_demo_profile", { demo_profile_id: discovery.profiles[0].demo_profile_id, confirmed: true });
    assert.equal((await call("get_my_profile", { session_token: demo.session_token })).name, "Leke");
    assert.equal((await call("get_my_invoices", { session_token: demo.session_token })).invoices.length, 2);
    env.DEMO_MODE = "false";
    await call("find_demo_profiles", {}, true);
    await call("open_demo_profile", { demo_profile_id: "demo_leke_l410", confirmed: true }, true);
    env.DEMO_MODE = "true";
    const newVisitor=await call("create_demo_resident",{display_name:"MCP Demo Visitor",confirmed:true,request_key:"v6-mcp-new-visitor-0001"});
    assert.equal((await call("get_my_profile",{session_token:newVisitor.session_token})).name,"MCP Demo Visitor");
    assert.equal((await call("get_my_invoices",{session_token:newVisitor.session_token})).invoices.length,2);
    const applicant=await call("start_resident_registration",{display_name:"MCP Demo Applicant",confirmed:true,request_key:"v6-mcp-registration-0001"});
    assert.equal((await call("get_onboarding_status",{registration_token:applicant.registration_token})).access_granted,false);
    await call("get_my_profile",{session_token:applicant.registration_token},true);
    for(const name of ["create_demo_resident","start_resident_registration","get_onboarding_status"]) {
      const bad=await client.callTool({name,arguments:{}});
      assert.equal(bad.isError,true);
    }
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
    "Passed: all 19 MCP tools discovered, original REST/MCP regression suite and new MCP workflows over real Streamable HTTP.",
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
      "migrations/0003_demo_profiles.sql",
      "migrations/0004_demo_onboarding.sql",
      "seed.sql",
      "seed-concierge.sql",
      "seed-demo.sql",
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
      18,
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
