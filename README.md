# Ami — resident support backend

A TypeScript Worker running on Cloudflare Workers with D1, REST endpoints, and
21 MCP tools for Chord. It handles demo resident onboarding, maintenance,
complaints, bills, and Paystack **test** payments. This repository is a backend;
it does not include a web frontend.

## Run the existing project

You need **Node.js 22+**, npm, and access to the Cloudflare account that owns
`ami-db`.

```sh
cd ~/Desktop/TSG
npm ci
# Create local settings only if they do not already exist:
test -e .dev.vars || cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and set these values. Keep any existing working credentials:

| Variable | Value |
| --- | --- |
| `API_KEY` | A long, private integration secret for requests to your local Worker |
| `PAYSTACK_SECRET_KEY` | Your actual Paystack test secret, starting with `sk_test_` |
| `DEMO_MODE` | `true` to enable fictional onboarding |

The example file contains placeholders. Demo onboarding and payment flows need a
real Paystack test key. `.dev.vars` is ignored by Git and is not uploaded on deploy.

Then start the Worker:

```sh
npx wrangler login  # First time, or when your Cloudflare login expires
npm run dev
```

Leave that terminal running. In another terminal, check:

```sh
curl http://127.0.0.1:8787/health
# Expected: {"ok":true,"service":"ami-worker"}
```

Stop with **Ctrl+C**. On later runs, just `cd ~/Desktop/TSG && npm run dev`.

**Database behavior:** the committed `wrangler.jsonc` sets `DB.remote` to `true`.
Your code runs locally, but reads and writes use the existing **remote `ami-db`**.
Local development can therefore change the same data used by deployed Ami.
Running the Worker does not deploy code or automatically seed data.

### Use a separate local database instead

Set `remote` to `false` on the D1 binding in your local `wrangler.jsonc`, then run:

```sh
npm run db:seed:local  # Applies all migrations and loads all demo fixtures locally
npm run dev
```

Restart the dev server after switching databases. Local D1 data lives in
`.wrangler/state/`. Restore `remote: true` when you want local code to use remote
D1 again. The seeding commands below always select their target explicitly.

## Add demo data

The existing remote demo database is already populated. Use these commands only
when you need to add fixtures or initialize another development database.

| What you need | Local D1 | Remote D1 |
| --- | --- | --- |
| Apply pending migrations | `npm run db:migrate:local` | `npm run db:migrate:remote` |
| All demo residents and bills, including migrations | `npm run db:seed:local` | `npm run db:seed:demo:remote` |
| Only the four extra bills for existing accounts | `npm run db:seed:bills` | `npm run db:seed:bills:remote` |

The extra bills are November electricity **NGN 7,500**, November water **NGN 5,000**,
October waste collection **NGN 6,500**, and November common-area service charge
**NGN 10,000**. Each existing tenancy gets four unpaid bills. They are fixed
October/November 2026 demo examples, not recurring billing.

Seeds are additive and safe to rerun: they preserve existing invoices and payment
statuses. Rerun the bill seed to cover accounts created later. All fixtures are
fictional; use them in demonstration databases only. Amounts in D1 are stored in
kobo: **NGN 7,500 = 750000 kobo**.

For manual account verification, use `A204` / `AMI-DEMO-204` for Seun, or `B105` /
`AMI-DEMO-105` for the other base Seun fixture. Chord's name search uses a separate
fictional profile allowlist, including Seun at A204 and B101, Ada at C302, and Leke
at L410. A display name is a search hint, not authentication.

## Check changes and deploy

Run these checks before deploying code:

```sh
npm run lint
npm run typecheck
npm test
npm run build  # Dry run; does not deploy
```

`npm test` uses isolated D1 and mocked Paystack calls. It needs no running Worker
or real payment key and does not contact remote D1 or Paystack. The optional
`npm run test:smoke` targets the running Worker at `http://127.0.0.1:8787` by default;
it **writes test requests to whichever database that Worker uses**.

For this existing deployment, keep the configured Worker name, database ID, and
`DB` binding. There is no need to create another D1 database.

```sh
npx wrangler login
npm run db:migrate:remote
# First deployment, or when changing a secret:
npx wrangler secret put API_KEY
npx wrangler secret put PAYSTACK_SECRET_KEY
npm run deploy
```

If the deployed secrets are already correct, skip the two `secret put` commands.
Cloudflare secrets are separate from `.dev.vars`. Seeding data does not require
a Worker deployment.

Deployed Worker: <https://ami-worker.oluwafemiadeleke13.workers.dev>

## Connect Chord or another client

Use **Streamable HTTP** at `https://<worker-host>/mcp`, with the integration header:

```http
Authorization: Bearer <deployed API_KEY>
```

For local clients, use `http://127.0.0.1:8787/mcp` with the key in `.dev.vars`.
REST endpoints use the same service authentication. Resident-specific operations
also require a private resident session; the integration key alone does not grant
access to an account. Keep both credentials out of public frontends and chat.

`skills/SKILL.md` is the canonical Ami skill; `chord/SKILL.md` is its publication
mirror. After changing tools, refresh Chord's MCP tool list. After changing the
skill, publish the revision and confirm it is included. Deploying the Worker does
not publish a Chord skill or guarantee conversation/session continuity.

Paystack accepts test keys only. Configure its test webhook as
`https://<worker-host>/webhooks/paystack`. Checkout links and `/payments/return`
do not mark bills paid; server-side Paystack verification is required.

## Where to look next

| File or folder | Purpose |
| --- | --- |
| [src/index.ts](src/index.ts) | REST routes, authentication, and MCP transport |
| [src/mcp.ts](src/mcp.ts) | Resident MCP tools and their inputs |
| [wrangler.jsonc](wrangler.jsonc) | Worker name, D1 binding, and demo flag |
| [migrations/](migrations/) | Additive database schema changes |
| [seed-bills.sql](seed-bills.sql) | Four extra utility bills per existing account |
| [skills/SKILL.md](skills/SKILL.md) | Canonical Chord behavior instructions |
| [tests/ACCEPTANCE_TESTS.md](tests/ACCEPTANCE_TESTS.md) | Manual acceptance checks |
| [qa/](qa/) | Recorded test outcomes |

This is a demo backend. Trusted production identity, manager notifications, and
persistent Chord participant-to-resident binding are not implemented. Pending
registration does not activate a tenancy or grant access to invoices.
