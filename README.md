# Ami — tenant concierge Worker

TypeScript + Hono on Cloudflare Workers, D1 persistence, REST and MCP Streamable HTTP. All included residents and billing records are fictional.

## Local start

Requires Node.js 22+ and npm. From this folder:

```sh
npm ci
test -e .dev.vars || cp .dev.vars.example .dev.vars
# Replace API_KEY in .dev.vars with a long random secret.
npm run db:migrate
npm run db:seed:local
npm run dev
```

The initial setup created `.dev.vars` with a random local service key. Keep that file private. Wrangler serves http://127.0.0.1:8787. The D1 binding is configured with `remote: true`, so local Worker code connects to Cloudflare D1; local D1 commands still use Wrangler's local database. `/health` is public; other endpoints require `Authorization: Bearer <API_KEY>`. Do not put the service key in a public frontend.

```sh
npm run lint  # TypeScript unused-declaration checks
npm run typecheck
npm run build   # deployment dry run only
npm test       # isolated local D1 + mocked Paystack; no running Worker or secrets needed
npm run test:smoke # checks an explicitly selected running Worker; writes fictional requests
```

The integration suite checks fresh installs, populated-database upgrades, detailed maintenance, idempotent complaints, Paystack test-mode enforcement, signed webhooks and rent reconciliation. It also runs the original REST/MCP smoke suite against an isolated server. It never contacts remote D1 or Paystack.

The standalone smoke test checks service authentication, invalid credentials, validation, persisted requests, cross-resident isolation, rent data, and real MCP client initialization/list/call/error flows. It reads the local key from `.dev.vars`, or accepts `API_KEY` and `AMI_URL` environment variables. Verification is limited to five attempts per unit per 15 minutes, including successful attempts; repeatedly running tests can hit this limit.

## Demo residents

| Preferred name | Unit | Demo onboarding code |
| --- | --- | --- |
| Seun | A204 | AMI-DEMO-204 |
| Seun | B105 | AMI-DEMO-105 |
| Amaka | A101 | AMI-DEMO-101 |
| Tunde | A305 | AMI-DEMO-305 |
| Zainab | B202 | AMI-DEMO-202 |
| Chidi | C011 | AMI-DEMO-011 |
| Amaka | C208 | AMI-DEMO-208 |
| Feyi | D104 | AMI-DEMO-104 |
| Ibrahim | D310 | AMI-DEMO-310 |
| Nneka | E002 | AMI-DEMO-002 |

`POST /v1/residents/verify` with `{"unit_id":"A204","onboarding_code":"AMI-DEMO-204"}` returns a `resident_token` valid for 24 hours. Store this capability privately and send it with subsequent operations. Only its SHA-256 hash is stored in D1. Names and arbitrary resident IDs cannot authorize access. A returning client can reuse its unexpired token; there is no automatic Chord sender/session binding yet.

## REST endpoints

All use POST and JSON bodies with the shared service Authorization header.

| Path | Body fields | Result |
| --- | --- | --- |
| `/v1/residents/verify` | `unit_id`, `onboarding_code` | Resident token and expiry |
| `/v1/residents/context` | `resident_token` | Preferred name and unit |
| `/v1/maintenance` | `resident_token`, `description` | Persisted maintenance ticket |
| `/v1/maintenance/status` | `resident_token`, `request_id` | Authorized ticket status |
| `/v1/complaints` | `resident_token`, `description` | Persisted complaint |
| `/v1/rent/summary` | `resident_token` | Invoices, balances and due dates |
| `/v1/requests` | `resident_token` | Latest 100 requests |

The seed includes 10 fictional residents across two properties, duplicate first names, 12 invoices with paid, partial, and unpaid examples, and maintenance and complaint requests across open, in-progress, and resolved statuses. `npm run db:seed` applies local migrations automatically before loading base fixtures; `npm run db:seed:concierge` applies migrations and loads both base and concierge fixtures into local D1. To load them into Cloudflare D1, run `npx wrangler d1 execute ami-db --remote --file seed.sql`. The seed is safe to rerun and adds missing fixtures without overwriting existing records.

Amounts are integers in minor currency units: 150000000 kobo = NGN 1,500,000. Writes to requests and their activity history are atomic D1 batches. Descriptions must contain 5–4000 characters. Creation calls are not idempotent: check the request list after an uncertain response before retrying.

## Chord / MCP

Connect the custom MCP server to `https://<worker-host>/mcp` using Streamable HTTP and the service Authorization header. The official MCP SDK handles transport and protocol negotiation. Fourteen tools expose the same domain operations as REST. The original seven remain available:

- `resolve_resident`
- `get_resident_context`
- `create_maintenance_ticket`
- `get_maintenance_status`
- `create_complaint`
- `get_rent_summary`
- `get_resident_requests`

New tools are `lookup_unit`, `get_maintenance_ticket`, `verify_resident`, `get_my_profile`, `get_my_invoices`, `create_payment_link`, and `check_payment_status`. The existing `create_maintenance_ticket` and `create_complaint` also accept the updated, session-scoped payloads. Use `session_token` plus all ticket details (unit, location, category, priority, hazard, idempotency key) for detailed maintenance, and category/idempotency key for complaints. Original `resident_token` payloads still work.

Use `chord/SKILL.md` for Ami's behavior. This project has no Chord API credentials and has not changed an existing teammate. Confirm Chord supports the custom Authorization header and private per-resident token handling before connecting real data. There is no legacy HTTP+SSE endpoint.

## Deployment

```sh
npx wrangler login
npx wrangler d1 create ami-db
```

For this existing app, keep the configured `ami-worker` name and `ami-db` database ID. Create a new database only for a separate installation. Apply migration `0002` to the same database before running the updated Worker. Then:

```sh
npx wrangler d1 migrations apply ami-db --remote
npx wrangler secret put API_KEY
npm run deploy
```

For a dedicated demonstration database only, optionally load fictional data:

```sh
npx wrangler d1 execute ami-db --remote --file seed.sql
```

Do not seed real tenancy systems with demo records. `.dev.vars` is local only; deployment needs the Cloudflare secret separately. Nothing is provisioned or deployed by local setup.

## Scope and next steps

This is a working demo backend. Production identity needs OTP or another trusted account verification flow, a trusted channel identity/session integration, salted password-grade hashing if reusable human secrets remain, session revocation, edge rate limits, and a private token store outside model-visible chat. Static published demo codes are deliberately not production credentials. The shared service key authenticates the integration; possession of the separate resident token grants access to that resident's records. Do not share resident tokens between users or store them in conversational memory.

Rent/utility invoices, Paystack TEST checkout and signed webhooks, detailed maintenance, ticket status administration, and idempotent complaints are implemented. Escalation delivery and Chord memory configuration remain unavailable. Ticket statuses start as `open`; Ami must never claim an assignment, payment, fix, or escalation occurred without a successful supporting backend operation.

References: [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Updated concierge features

The merge retains the existing configuration, `API_KEY`, resident identities, onboarding codes, rent balances, sessions, and original routes. `DEMO_API_TOKEN` is accepted only as a fallback when `API_KEY` is absent. The existing SDK and lockfile are retained; the incoming `agents` and alternate MCP package are unnecessary.

```sh
npm run db:migrate:local       # local database only
npm run db:seed                # applies local migrations, then loads base fixtures
npm run db:seed:concierge      # applies migrations and loads base + concierge fixtures
# For the configured remote binding, apply the migration remotely before use:
npm run db:migrate:remote
# Optional payment secret; local values go in the existing .dev.vars without replacing API_KEY.
npx wrangler secret put PAYSTACK_SECRET_KEY
```

Only `sk_test_` payment keys are accepted. Configure the provider TEST webhook at `https://<existing-worker-host>/webhooks/paystack`. `/payments/return` is informational and cannot confirm payment. No deployment, remote migration, remote seed, or secret change was performed by the merge.

The additional fixtures retain A204's `AMI-DEMO-204` code and existing rent amount; they add its ₦2,350 electricity invoice without adding the source's conflicting ₦75,000 rent invoice. B101 uses `AMI-B101-DEMO`; C302 uses `AMI-C302-DEMO`. Optional seeding sets a fictional billing email for the original A204 demo resident only if none exists. Existing residents without a billing email receive `PAYMENT_EMAIL_REQUIRED` until an appropriate email is configured. Both token field names refer to the existing 24-hour sessions.

| Updated REST endpoint | Authorization / body |
| --- | --- |
| `GET /v1/units/:id` | Service bearer key; unit lookup is not identity verification |
| `POST /v1/residents/verify` | `{unit_id,demo_code}` returns `session_token`; original `{unit_id,onboarding_code}` still works |
| `GET /v1/me`, `GET /v1/invoices` | Service bearer key + `X-Demo-Session` |
| `POST /v1/tickets` | Service bearer key; `{session_token,unit_id,description,location,category,priority,hazard,idempotency_key}` |
| `GET /v1/tickets/:id`, `GET /v1/tickets/:id/events` | Service bearer key + owning resident's `X-Demo-Session` |
| `PATCH /v1/tickets/:id/status` | Service administration only; `{status,actor,assigned_to?}`; not exposed as a resident MCP tool |
| `POST /v1/complaints` | `{session_token,category,description,idempotency_key}`; original payload still works |
| `POST /v1/payments/initialize` | `{session_token,invoice_id,confirmed:true}`; amounts come from D1 |
| `GET /v1/payments/:invoiceId` | Service bearer key + owning resident's `X-Demo-Session` |
| `POST /webhooks/paystack` | Provider HMAC-SHA512 signature; no service bearer header |

New tickets and complaints appear in the original request list. Paying a migrated rent invoice also updates the original rent summary, retaining prior partial payments. New tenant operations require a resident session; the service administration endpoint must remain restricted to trusted integrations.

See [payment chat flow](docs/paystack-chat-flow.md) and [merge verification](docs/merge-verification.md) for the feature mapping and verification limits. Hosted Paystack checkout and Chord simulator integration still require end-to-end testing. Production payment concurrency, reconciliation, refunds and identity integration remain outside this demo's scope.


## Demo profile discovery — v5

Ami can now use `find_demo_profiles({name?})` to offer fictional sample accounts,
then `open_demo_profile({demo_profile_id,confirmed:true})` after the tester chooses one.
The nine concierge tools and five legacy tools remain available (16 total tools).
Names are search hints. A selected sample is not proof of identity.

Both operations require integration bearer authentication, `DEMO_MODE="true"`, and
an existing `PAYSTACK_SECRET_KEY` starting with `sk_test_`. A missing or live key
blocks both operations. The flag is enabled in this demo Worker's Wrangler vars;
turn it off before using a deployment with real tenancy data. Existing normal
verification routes remain unchanged. New selection sessions use the existing
`sessions` table and hashed bearer capabilities, expiring after 30 minutes; original
verification sessions retain their existing lifetime. Already issued capabilities
remain valid until expiry; disabling discovery does not revoke sessions.

REST equivalents (same gates and authorization):

- `GET /v1/demo/profiles?name=Leke`
- `POST /v1/demo/sessions` with `{"demo_profile_id":"demo_leke_l410","confirmed":true}`

Discovery returns `profiles` and, if no match was found, `sample_profiles`. The total
is bounded to five. Each candidate contains only `demo_profile_id`, `display_name`,
`property_name`, and `building_label`. The registry enrolls four known fictional
fixtures: Leke at L410, the existing Seuns at A204 and B101, and Ada at C302. Other
residents are not implicitly enrolled. Only the separate seed can enroll records;
there is no public enrollment API. No names automatically open accounts.

Migration `0003_demo_profiles.sql` adds only the demo allowlist. `seed-demo.sql`
adds Leke with a distinct unit, a fictional billing email, a NGN 96,000 rent invoice,
and a NGN 3,150 electricity invoice, then enrolls known fixture IDs and credentials.
All inserts are repeatable and preserve prior data and balances. Leke's optional
legacy demo pair is `L410` / `AMI-L410-DEMO`; the selection flow doesn't require it.

```sh
npm run db:seed:demo        # local migrations + base, concierge and discovery seeds
npm run db:seed:demo:remote # explicitly applies the same sequence to Cloudflare D1
npm run deploy
```

Capabilities are returned internally to the integration/model so it can call the
existing resident tools. Backend logs never print them, and demo REST responses
are not cacheable. The Chord skill instructs Ami never to print or memorize tokens;
this behavior still depends on the host/model honoring those instructions. No
trusted per-resident Chord sender metadata has been verified. Continuity is scoped
to the active conversation and token lifetime; caller-supplied `sender_id` is not
used for authorization. The Chord page/tool refresh was reported handled by the
user and was not independently inspected here.


## Resident onboarding v6

The existing demo discovery and selection tools now work alongside
`create_demo_resident`, `start_resident_registration` and `get_onboarding_status`.
There are 19 MCP tools in total: all 16 previously deployed definitions are retained
and three are added. `skills/SKILL.md` is the v6 Chord skill, also mirrored at
`chord/SKILL.md` for the existing workflow.

- Existing fictional account: search a name hint, confirm a returned profile, open
  it, then use its private resident session for tenancy, invoices and service tools.
- Visitor: with permission and a stable `request_key`, atomically create a fictional
  unit, resident, tenancy, rent invoice, electricity invoice, demo allowlist entry,
  and a 30-minute resident session. Repeating the same request reuses the account;
  changing its name or property with that key is a 409 conflict. Default sample
  bills are NGN 75,000 rent and NGN 2,350 electricity. No real lease is created.
- Claimed resident not registered: with consent, record a pending request and return
  a reference plus a private 24-hour lookup token. The token can only check that
  registration's status; it cannot access resident records or invoices. No manager
  notification or real account activation is implemented. Retries preserve existing
  valid lookup tokens and detect changes to all supplied details.

All five onboarding tools and their REST routes require the existing integration
credential, `DEMO_MODE="true"` and a nonempty Paystack test key. Existing flag-off
responses remain 404 `DEMO_DISABLED`; missing/live keys return 503 `TEST_KEY_REQUIRED`.
Generated demo profiles and pending registrations each have a transactional cap of
500 records to bound this exercise. Expired session capabilities do not authenticate
new chats, and no sender identity mapping is introduced.

Additional REST routes:

| Route | Input |
| --- | --- |
| `POST /v1/demo/residents` | `{display_name,property?,confirmed:true,request_key}` |
| `POST /v1/onboarding/registrations` | `{display_name,property_hint?,unit_hint?,notes?,confirmed:true,request_key}` |
| `GET /v1/onboarding/status` | Private `X-Registration-Session` header |

Use `cedar_court` or `palm_heights` for the optional property; it defaults to
`cedar_court`. First creation returns 201; an identical retry returns 200. Never
log or print `session_token` or `registration_token`. The supplied module was
adapted to the actual `preferred_name`, `tenancies`, `sessions` and existing
`demo_profiles` schema. Migration `0004_demo_onboarding.sql` extends 0003, which
was already deployed; it does not recreate or reset the schema or enroll arbitrary
residents with example.com addresses.

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before
`npm run db:migrate:remote` and `npm run deploy`. No new static seed is required for
v6 visitor creation. Detailed observed outcomes and exact commands are recorded in
[ONBOARDING_V6.md](ONBOARDING_V6.md). The user is handling Chord; simulator checks
and publication must not be inferred from successful backend tests.


## Payment continuity v7

`check_latest_payment({session_token})` verifies the exact payment associated with
an active resident session, or falls back to the latest recorded attempt owned by
that same tenancy in a new verified session. It needs no invoice ID. The existing
`check_payment_status` and all 19 older MCP definitions remain available unchanged;
the deployed server exposes 20 tools.

Migration `0005_payment_session_context.sql` adds only a hashed-session/tenancy/
invoice/reference association. Expired session deletion cascades safely. Real
new and reused pending Paystack links are remembered only after their provider URL
has been saved; a context-save failure surfaces a specific recoverable error while
leaving that checkout pending and reusable. Payment success still requires the
existing server-side test-domain/reference/amount/currency verification.

`GET /v1/payments/latest` is integration-authenticated and requires the private
`X-Demo-Session` header. It is registered before the invoice-ID route. Tool audit
logs contain controlled names/outcomes/error codes, not tokens or credentials.
The payment chat message is plain text and keeps the exact returned provider URL.

See [v7 diagnosis, exact commands and observed evidence](PAYMENT_CONTINUITY_V7.md)
and [manual simulator acceptance](tests/SIMULATOR_ACCEPTANCE.md). Chord publication,
activation and conversation sign-off are user-handled and not implied by backend
checks. `scripts/tail-payment-audit.ts` filters raw Cloudflare tail envelopes before
saving logs, and `scripts/backup-payment-db.ts` redacts temporary export URLs.


## Complaint reliability v8

`skills/SKILL.md` is canonical; `chord/SKILL.md` is an identical publication mirror.
The v8 revision uses one confirmation and a stable complaint key, treats lost
execution evidence as uncertainty, and closes farewells without more tool calls.
Publish/include one canonical revision in Chord and inspect the revision used on
each tested reply; the local mirror does not verify that platform state.

The deployed `get_complaint_status` accepts a valid private `session_token` and
exactly one `complaint_id` or `request_key` (the original creation idempotency key).
It reads only the authorized tenancy, including legacy references, and never
creates a case. REST callers use integration authentication plus `X-Demo-Session`
with `GET /v1/complaints/:complaintId`; responses are not cached. The 20 existing
MCP definitions remain unchanged, for 21 tools total. No new migration is required.

Legacy `resident_token` complaint calls now honor a supplied `idempotency_key`
while preserving response fields. Original calls without a key remain compatible
and cannot distinguish retries from new requests. Prefer keyed session-based
creation. Neither display names nor complaint references authorize a status read.
No participant identity mapping or lost-token recovery was added without a trusted
Chord identity contract.

See [observed incident evidence](field-notes/CHORD_ISSUE.md),
[acceptance matrix](tests/ACCEPTANCE_TESTS.md) and [actual QA results](qa/V8_QA_LOG.md).
The two original contradictory complaint references were both found in D1; Chord
trace/revision/history delivery remains unverified here and is user-handled.

## Low-cost demo bills

`seed-bills.sql` adds four unpaid utility bills to every existing tenancy:
November electricity (NGN 7,500), November water (NGN 5,000), October waste
collection (NGN 6,500, overdue), and November common-area service charge
(NGN 10,000). These are fictional October/November 2026 fixtures, not recurring
billing. The full demo seed commands include them.

For an already populated database, run `npm run db:seed:bills` locally or
`npm run db:seed:bills:remote` against deployed D1. Apply the existing migrations
first on a fresh database. Stable invoice IDs make reruns safe: existing bills,
payment statuses and references are preserved. Rerun after creating more demo
accounts to add these four bills to those accounts too. No Worker deployment or
Chord tool refresh is required.
