import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
// Explicitly exercises only the deployed fictional demo: creates a short session
// and, without collecting money, initializes a Paystack TEST checkout.
const origin = "https://ami-worker.oluwafemiadeleke13.workers.dev";
const rawKey =
  process.env.API_KEY ??
  readFileSync(".dev.vars", "utf8").match(/^API_KEY=(.+)$/m)?.[1];
const key = rawKey?.trim().replace(/^(["'])(.*)\1$/, "$2");
assert(key, "Provide the integration key in .dev.vars or API_KEY");
const baselinePath =
  process.env.AMI_BASELINE_FILE ?? ".wrangler/v5-baseline-tools.json";
const client = new Client({
  name: "ami-v5-deployment-check",
  version: "1.0.0",
});
try {
  const auth = await fetch(origin + "/v1/units/A204", {
    headers: { Authorization: `Bearer ${key}` },
  });
  assert.equal(
    auth.status,
    200,
    "The local integration key does not authorize this deployment; no credentials were printed.",
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  const tools = (await client.listTools()).tools;
  if (process.argv.includes("--capture-tools")) {
    writeFileSync(baselinePath, JSON.stringify(tools));
    console.log(
      `Captured ${tools.length} deployed tool definitions for compatibility comparison.`,
    );
  } else {
    const baseline = JSON.parse(
      readFileSync(baselinePath, "utf8"),
    ) as typeof tools;
    for (const previous of baseline)
      assert.deepEqual(
        tools.find((t) => t.name === previous.name),
        previous,
        `Existing tool changed: ${previous.name}`,
      );
    assert.equal(tools.length, 20);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert(!result.isError, `Deployed tool failed: ${name}`);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const leke = await call("find_demo_profiles", { name: "LEKE" });
    assert.equal(leke.profiles.length, 1);
    assert.equal(leke.profiles[0].display_name, "Leke");
    const seuns = await call("find_demo_profiles", { name: "Seun" });
    assert.equal(seuns.profiles.length, 2);
    const missing = await call("find_demo_profiles", { name: "Someone New" });
    assert.equal(missing.profiles.length, 0);
    assert(
      missing.sample_profiles.length > 0 && missing.sample_profiles.length <= 5,
    );
    const selected = await call("open_demo_profile", {
      demo_profile_id: leke.profiles[0].demo_profile_id,
      confirmed: true,
    });
    const session = { session_token: selected.session_token };
    assert.equal((await call("get_my_profile", session)).unit_id, "L410");
    const invoices = (await call("get_my_invoices", session)).invoices;
    assert(invoices.some((i: any) => i.invoice_id === "RENT-L410-NOV"));
    const electricity = invoices.find(
      (i: any) => i.invoice_id === "ELEC-L410-OCT",
    );
    assert(
      electricity &&
        electricity.status === "unpaid" &&
        electricity.amount_kobo === 315000,
    );
    const unconfirmed = await fetch(origin + "/v1/demo/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        demo_profile_id: "demo_leke_l410",
        confirmed: false,
      }),
    });
    assert.equal(unconfirmed.status, 400);
    const anonymous = await fetch(origin + "/v1/demo/profiles?name=Leke");
    assert.equal(anonymous.status, 401);
    const payment = await call("create_payment_link", {
      ...session,
      invoice_id: electricity.invoice_id,
      confirmed: true,
    });
    assert.equal(payment.environment, "test");
    assert.equal(payment.invoice.amount_kobo, 315000);
    assert.equal(
      new URL(payment.checkout_url).hostname,
      "checkout.paystack.com",
    );
    assert.equal(new URL(payment.checkout_url).protocol, "https:");
    const status = await call("check_payment_status", {
      ...session,
      invoice_id: electricity.invoice_id,
    });
    assert.equal(status.verified_paid, false);
    assert.equal(status.invoice.status, "unpaid");
    const visitorInput = {
      display_name: "V6 Remote Demo Visitor",
      property: "palm_heights",
      confirmed: true,
      request_key: "v6-remote-visitor-20261024",
    };
    const visitor = await call("create_demo_resident", visitorInput);
    const retry = await call("create_demo_resident", visitorInput);
    assert.equal(retry.created, false);
    assert.equal(
      retry.profile.demo_profile_id,
      visitor.profile.demo_profile_id,
    );
    const visitorAuth = { session_token: visitor.session_token };
    const visitorProfile = await call("get_my_profile", visitorAuth);
    assert(visitorProfile.unit_id.startsWith("DM-"));
    const visitorBills = (await call("get_my_invoices", visitorAuth)).invoices;
    assert.equal(visitorBills.length, 2);
    const bill = visitorBills.find((i: any) => i.type === "utility");
    assert.equal(bill.amount_kobo, 235000);
    if (bill.status !== "paid") {
      const checkout = await call("create_payment_link", {
        ...visitorAuth,
        invoice_id: bill.invoice_id,
        confirmed: true,
      });
      assert.equal(checkout.environment, "test");
      assert.equal(checkout.invoice.amount_kobo, 235000);
      assert.equal(
        new URL(checkout.checkout_url).hostname,
        "checkout.paystack.com",
      );
    }
    const visitorPayment = await call("check_payment_status", {
      ...visitorAuth,
      invoice_id: bill.invoice_id,
    });
    assert.equal(visitorPayment.verified_paid, bill.status === "paid");
    assert.equal(visitorPayment.invoice.status, bill.status);
    const pending = await call("start_resident_registration", {
      display_name: "V6 Fictional Applicant",
      property_hint: "Demo property",
      unit_hint: "Fictional unit",
      notes: "Remote regression example, no real occupant",
      confirmed: true,
      request_key: "v6-remote-registration-20261024",
    });
    const pendingStatus = await call("get_onboarding_status", {
      registration_token: pending.registration_token,
    });
    assert.equal(pendingStatus.status, "pending");
    assert.equal(pendingStatus.access_granted, false);
    const denied = await client.callTool({
      name: "get_my_invoices",
      arguments: { session_token: pending.registration_token },
    });
    assert.equal(denied.isError, true);
    console.log(
      JSON.stringify({
        v6_visitor: "persisted and reselectable",
        repeat_created: retry.created,
        visitor_invoices: visitorBills.length,
        visitor_test_checkout: visitorPayment.payment_status,
        registration_status: pendingStatus.status,
        registration_account_access: pendingStatus.access_granted,
      }),
    );
    // Token values, billing email, keys and response bodies are never logged.
    console.log(
      JSON.stringify({
        health: (await fetch(origin + "/health")).status,
        tools: tools.length,
        unchanged_existing_tools: baseline.length,
        leke_matches: leke.profiles.length,
        seun_matches: seuns.profiles.length,
        no_match_samples: missing.sample_profiles.length,
        profile_unit: "L410",
        invoice_count: invoices.length,
        test_checkout: "initialized with actual D1 amount and provider URL",
        verified_paid: status.verified_paid,
        payment_status: status.payment_status,
      }),
    );
  }
} finally {
  await client.close();
}
