# Low-cost demo bills — 26 October 2026

Applied `seed-bills.sql` to remote `ami-db`, database ID
`f38e2b56-7dea-41ab-b442-d4e2f83193fd`. Added 56 unpaid utility invoices across
all 14 existing tenancies, including all three Seun accounts. Total invoices:
20 before, 76 after. Each account received November electricity (NGN 7,500),
November water (NGN 5,000), October waste collection (NGN 6,500), and November
common-area service charge (NGN 10,000).

Actual checks:

- PASS: isolated SQLite application of migrations 0001–0005, base/concierge/demo
  seeds, then the new seed: 52 new invoices across 13 static fixture accounts.
- PASS: four invoices per tenancy, amounts within NGN 5,000–10,000, valid foreign
  keys and invoice ID lengths compatible with payment inputs.
- PASS: isolated rerun preserves a seeded invoice marked paid, including its paid
  timestamp and reference; no duplicate invoices.
- PASS: `npm test` (existing integration suite; provider calls mocked, isolated D1).
- PASS: remote before/after comparison preserves every field of all 20 original
  invoices and all nine existing payment attempt records.
- PASS: remote seed rerun leaves all invoice and payment attempt records unchanged;
  remote `PRAGMA foreign_key_check` returns no rows.
- PASS: authenticated requests to the deployed `/v1/demo/sessions` and
  `/v1/invoices` for `demo_seun_a204` and `demo_seun_b101` each return six bills,
  including all four additions and unpaid November electricity at 750000 kobo.
- PASS: `git diff --check`.

Remote mutation command (executed twice to check rerun safety):

```sh
npx wrangler d1 execute ami-db --remote --json --file seed-bills.sql
```

Before/after snapshots and summary are stored locally under
`.wrangler/qa/low-cost-bills-20261026T202446Z/` (ignored by Git). Integration keys
and private resident session tokens were not printed or stored in the QA report.

Verification tooling issues: Wrangler's successful file-execution output was not
pure JSON, so the initial wrapper failed while parsing its output after the seed
had applied. Separate remote queries verified the write before any rerun. The
first Python HTTPS API check failed because its local certificate store could
not validate the server; Node fetch completed the same checks with TLS validation
enabled. No Chord simulator or new Paystack checkout was exercised.

Added dedicated local/remote npm bill seed commands and included the new SQL in
the full demo seed commands. No schema migration, Worker/skill change or deployment
was required. Existing edits to `qa/V8_QA_LOG.md` were left untouched.
