# Ami onboarding v6 — implementation and observed results

Completed in `/Users/ice/Desktop/TSG` on 2026-10-24. The existing `ami-worker`, `ami-db`, `DB` binding, service authentication and Paystack secret names were retained. The current v5 deployment was extended; no old scaffold was installed and D1 was not reset.

## Deployed result

Worker: https://ami-worker.oluwafemiadeleke13.workers.dev

Version: `9ee35c6e-0a5d-4a7a-adf3-6c29302658a9`.

Remote migration applied: **`0004_demo_onboarding.sql`**, 13 SQL commands completed successfully. `0003_demo_profiles.sql` was already deployed, so the supplied package's conflicting 0003 filename was renumbered and adapted. No new static seed is required for visitor creation.

The live MCP server lists **19 tools**. All **16 previous definitions** were captured before deployment and compared in full afterward; they are unchanged.

## Files and adaptations

| File | Result |
| --- | --- |
| `src/onboarding.ts` | Adapted the supplied discovery, selection, visitor creation and pending registration services to the real schema. |
| `src/demo.ts` | Retained as a backward-compatible export path for v5 discovery/selection. |
| `migrations/0004_demo_onboarding.sql` | Extends the existing demo allowlist; adds pending registration records and separate lookup sessions. |
| `src/mcp.ts` | Adds three tools; preserves the existing nine concierge tools, five legacy tools, and two v5 tools. |
| `src/index.ts` | Adds three authenticated, demo-gated REST endpoints; retains `/mcp` and payment/webhook routes. |
| `skills/SKILL.md`, `chord/SKILL.md` | Supplied v6 skill, adapted to actual discovery response fields, lifetimes, and the correct existing A204 fallback credentials. Both files match. |
| `scripts/integration.ts`, `scripts/smoke.ts` | Expanded regressions to 19 tools, atomic writes, concurrent retries, registration separation and payment checks. |
| `scripts/check-deployment.ts` | Live MCP compatibility, onboarding, invoices, registration and test checkout checks; never prints tokens/keys. |
| `scripts/check-test-checkout.ts` | Initializes and verifies the fictional visitor's hosted Paystack test checkout. |
| `tests/ACCEPTANCE.md`, `README.md` | Actual schema queries, endpoint contracts and verification limits. |

The supplied implementation expected resident fields and a `resident_sessions` table that this repository does not have. The adaptation reuses `residents.preferred_name`, `tenancies`, and the existing hashed `sessions` capability store. Invoices remain scoped to tenancy IDs, as in the deployed payment code.

The original explicit fictional-profile registry is preserved. The supplied broad enrollment predicate for all example.com email addresses was not used. Existing fictional residents and their balances/credentials remain intact.

## Registered tools

Existing nine concierge tools, unchanged:

`lookup_unit`, `create_maintenance_ticket`, `get_maintenance_ticket`, `verify_resident`, `get_my_profile`, `get_my_invoices`, `create_payment_link`, `check_payment_status`, `create_complaint`.

Five onboarding tools now available:

`find_demo_profiles`, `open_demo_profile`, `create_demo_resident`, `start_resident_registration`, `get_onboarding_status`.

The first two were already deployed in v5. The last three are new in v6.

Five additional legacy tools also remain unchanged:

`resolve_resident`, `get_resident_context`, `get_maintenance_status`, `get_rent_summary`, `get_resident_requests`.

## Runtime behavior

1. Existing fictional account: display-name discovery returns safe choices only. The tester selects and confirms a profile before a resident session is issued.
2. Visitor: after explicit consent, one D1 batch commits the unit, resident, tenancy, allowlist entry, rent invoice, electricity invoice, and first resident session. The established rent trigger supplies the current invoice API as well as the legacy rent API. Default sample amounts are NGN 75,000 rent and NGN 2,350 electricity.
3. Claimed resident not registered: records a pending request and issues a separate private lookup token. It creates no resident, tenancy, invoice, or resident session, and sends no manager notification.

New REST endpoints, all behind existing integration bearer authentication:

- `POST /v1/demo/residents`
- `POST /v1/onboarding/registrations`
- `GET /v1/onboarding/status`, using `X-Registration-Session`

The existing `/v1/demo/profiles` and `/v1/demo/sessions` routes remain available.

All five onboarding operations require `DEMO_MODE="true"` and a nonempty `sk_test_` Paystack key. Existing v5 status contracts are retained: flag disabled returns 404 `DEMO_DISABLED`; missing/live keys return 503 `TEST_KEY_REQUIRED`. The supplied matrix's 403 expectation was adjusted to this actual contract.

Resident demo sessions expire after **30 minutes**, preserving v5's shorter lifetime rather than the supplied module's three hours. Registration lookup tokens expire after **24 hours** and are stored hashed in a separate table. They cannot be used as resident session tokens. Repeating a registration request issues a new lookup token without invalidating a prior unexpired one.

Idempotency compares complete request fingerprints. A changed display name/property for visitor creation, or changed name/hints/notes for registration, conflicts with a reused key. Unique indexes and atomic D1 batches handle concurrent retries. Transactional triggers cap generated demo profiles and registration records at 500 each.

Display names and caller-provided sender IDs do not authenticate residents. No sender mapping was added. A later conversation may deliberately reselect a generated sample profile; this does not establish persistent verified identity. Disabling demo onboarding prevents new selection/creation but does not revoke previously issued capabilities before their expiry.

## Tests actually observed

**Passed:** lint (TypeScript unused-symbol checks), typecheck, build dry run, full isolated integration suite, and MCP HTTP regression suite.

Coverage observed:

- Existing names, duplicate Seuns, bounded sanitized results and unmatched sample options.
- Missing/invalid inputs and explicit confirmation requirements, in REST and MCP.
- Visitor creates exactly one unit/resident/tenancy and two invoices.
- Identical retries and simultaneous retries create one business account.
- Simultaneous conflicting property requests return one creation and one conflict.
- An injected failure on the second invoice rolls back every business record and the session. The expected 500 is a deliberate negative test, not an unresolved failure.
- Generated sessions work with invoices, maintenance, complaints and Paystack test checkout; foreign invoices are inaccessible.
- Pending registration creates no resident business records or resident session. Its token is rejected by profile/invoice endpoints.
- Registration retries preserve lookup access, full-detail conflicts are rejected, concurrent retries are idempotent, and expired/foreign/reference-only lookups fail.
- Disabled demo mode and missing/live keys block all five onboarding operations.
- Existing payment amount/currency/reference/domain verification, signed/duplicate webhooks, unpaid/pending/failure behavior and successful D1 reconciliation pass with mocked Paystack responses.
- Fresh-install and populated-upgrade paths pass, with foreign-key integrity.
- All 19 MCP tools are discovered over the real transport.

Automated suite databases are temporary and isolated; Paystack is mocked there. External deployment checks below are separate.

## Live deployment checks actually observed

- Health returned 200.
- All 16 original tool definitions were unchanged; total tool count is 19.
- Leke returned one match; Seun returned two safe choices; Someone New returned selectable samples.
- Existing profile selection opened L410 and returned its two D1 invoices.
- The new visitor was persisted through MCP and could be reopened by profile selection. An identical creation retry returned `created:false`.
- A direct remote D1 query confirmed one visitor resident, one unit, one tenancy, and exactly two invoices for the fixed regression request key.
- Registration `REG-92169D2844DD46` is pending. Its lookup worked and its token was denied resident invoice access.
- Actual Paystack test initialization returned provider checkout URLs with server-controlled D1 amounts. Abandoned checkout checks left invoices unpaid.

### Successful hosted Paystack test checkout

A new actual checkout was initialized for the visitor's NGN 2,350 electricity invoice. The hosted Paystack page visibly showed **TEST**, its amount was NGN 2,350, and its built-in **Success** test option was selected. After submitting that sandbox flow, Paystack returned to Ami. No real payment details were entered.

The informational return page correctly did not claim payment confirmation. The backend was then asked to verify the transaction against Paystack. Observed response:

```json
{
  "verified_paid": true,
  "invoice_status": "paid",
  "invoice_id": "ELEC-dbee7630c85e44e48e6dbce4bdc63eda",
  "reference": "AMI-934df945-525c-4a03-9f76-6afbbd4bf015",
  "amount_kobo": 235000
}
```

A separate D1 query confirmed the utility invoice is paid with a verification reference, while the rent invoice remains unpaid. A subsequent MCP check also returned the successful payment. This was Paystack's test flow, not a live payment; see [Paystack's test-mode explanation](https://support.paystack.com/en/articles/2129922).

[Checkout return-page evidence](/Users/ice/Desktop/TSG/.wrangler/v6-payment-return-detail.png).

## Commands run for checks and deployment

These were run from the existing Desktop/TSG project. Check commands were repeated when new concurrency tests or verification scripts were added.

```sh
npm run typecheck
npm run lint
npm test
npm run build
AMI_BASELINE_FILE=.wrangler/v6-baseline-tools.json npx tsx scripts/check-deployment.ts --capture-tools
npm run db:migrate:remote
npm run deploy
AMI_BASELINE_FILE=.wrangler/v6-baseline-tools.json npx tsx scripts/check-deployment.ts
npx tsx scripts/check-test-checkout.ts --initialize
npx tsx scripts/check-test-checkout.ts --verify
npx wrangler d1 execute ami-db --remote --file .wrangler/v6-spot-check.sql
git diff --check
```

The SELECT file imported successfully but Wrangler's bulk-file path returned execution counts rather than result rows. The actual spot-check rows were then read with:

```sh
npx wrangler d1 execute ami-db --remote --command "SELECT COUNT(DISTINCT r.id) AS visitor_residents, COUNT(DISTINCT u.id) AS visitor_units, COUNT(DISTINCT t.id) AS visitor_tenancies, COUNT(i.id) AS visitor_invoices FROM demo_profiles d JOIN tenancies t ON t.id=d.tenancy_id JOIN residents r ON r.id=t.resident_id JOIN units u ON u.id=t.unit_id JOIN invoices i ON i.resident_id=t.id WHERE d.creation_key='v6-remote-visitor-20261024'; SELECT i.kind,i.amount_kobo,i.status,(i.paid_reference IS NOT NULL) AS verified_reference_recorded FROM invoices i JOIN demo_profiles d ON d.tenancy_id=i.resident_id WHERE d.creation_key='v6-remote-visitor-20261024' ORDER BY i.kind; SELECT id,status FROM onboarding_registrations WHERE request_key='v6-remote-registration-20261024';"
```

The existing `.wrangler` directory holds temporary comparison/result evidence. Tokens and keys were not written into this report or printed by the check scripts.

## Real field notes and limits

- **Inspected schema mismatch:** the supplied module would use `resident_sessions`, `residents.display_name` and resident-owned invoices; this app uses tenancy-owned invoices and `sessions`. The patch was adapted before execution, so this is an inspection finding, not an invented runtime error.
- **Inspected migration collision:** 0003 was already live. Extending it through 0004 avoided recreating the allowlist or broadening discovery to arbitrary records.
- **Idempotency review:** the supplied retry paths did not compare every field and its race recovery could reuse a winner without checking it. Complete fingerprints and strict concurrent tests now cover these cases. Registration retry tokens also no longer invalidate each other.
- **Observed CLI friction:** D1 `--file` treated the SELECT file as a bulk import and displayed counts rather than rows. `--command` returned the actual spot-check data.
- **Observed checkout boundary:** Paystack returned to an informational page; confirmation came from the existing server verification path, not callback query parameters.
- **Chord scope:** the user explicitly said they handled the Chord tool refresh/skill work. This session did not invoke a connected Chord simulator or publish changes through its UI. No Chord conversational acceptance test, token-display behavior, or trusted sender metadata is claimed observed. The provided skill is ready locally at `skills/SKILL.md`, with the existing `chord/SKILL.md` mirror.
- **Token handling limit:** capabilities must reach the integration/model for later calls. Backend logs omit them and the skill forbids printing or memorizing them; this does not prove that a hosted assistant will always follow that instruction. Cross-session production authentication is not implemented.
