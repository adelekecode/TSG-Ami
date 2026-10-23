# Ami — tenant concierge Worker

TypeScript + Hono on Cloudflare Workers, D1 persistence, REST and MCP Streamable HTTP. All included residents and billing records are fictional.

## Local start

Requires Node.js 22+ and npm. From this folder:

```sh
npm ci
cp .dev.vars.example .dev.vars
# Replace API_KEY in .dev.vars with a long random secret.
npm run db:migrate
npm run db:seed
npm run dev
```

The initial setup created `.dev.vars` with a random local service key. Keep that file private. Wrangler serves http://127.0.0.1:8787. The D1 binding is configured with `remote: true`, so local Worker code connects to Cloudflare D1; local D1 commands still use Wrangler's local database. `/health` is public; other endpoints require `Authorization: Bearer <API_KEY>`. Do not put the service key in a public frontend.

```sh
npm run typecheck
npm run build   # deployment dry run only
npm test       # requires running local Worker; creates fictional test requests
```

The smoke test checks service authentication, invalid credentials, validation, persisted requests, cross-resident isolation, rent data, and real MCP client initialization/list/call/error flows. It reads the local key from `.dev.vars`, or accepts `API_KEY` and `AMI_URL` environment variables. Verification is limited to five attempts per unit per 15 minutes, including successful attempts; repeatedly running tests can hit this limit.

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

The seed includes 10 fictional residents across two properties, duplicate first names, 12 invoices with paid, partial, and unpaid examples, and maintenance and complaint requests across open, in-progress, and resolved statuses. `npm run db:seed` loads these fixtures into local D1. To load them into Cloudflare D1, run `npx wrangler d1 execute ami-db --remote --file seed.sql`. The seed is safe to rerun and adds missing fixtures without overwriting existing records.

Amounts are integers in minor currency units: 150000000 kobo = NGN 1,500,000. Writes to requests and their activity history are atomic D1 batches. Descriptions must contain 5–4000 characters. Creation calls are not idempotent: check the request list after an uncertain response before retrying.

## Chord / MCP

Connect the custom MCP server to `https://<worker-host>/mcp` using Streamable HTTP and the service Authorization header. The official MCP SDK handles transport and protocol negotiation. Seven tools expose the same domain operations as REST:

- `resolve_resident`
- `get_resident_context`
- `create_maintenance_ticket`
- `get_maintenance_status`
- `create_complaint`
- `get_rent_summary`
- `get_resident_requests`

Use `chord/SKILL.md` for Ami's behavior. This project has no Chord API credentials and has not changed an existing teammate. Confirm Chord supports the custom Authorization header and private per-resident token handling before connecting real data. There is no legacy HTTP+SSE endpoint.

## Deployment

```sh
npx wrangler login
npx wrangler d1 create ami-db
```

Replace the placeholder `database_id` in `wrangler.jsonc` with the UUID returned by Cloudflare. Then:

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

Utilities, payment processing, ticket status administration, escalation delivery, and Chord memory configuration are not implemented. Ticket statuses start as `open`; Ami must never claim an assignment, payment, fix, or escalation occurred without a successful supporting backend operation.

References: [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
