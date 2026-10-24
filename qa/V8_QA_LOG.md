# Ami reliability v8 — actual QA log

Date: 2026-10-24 (Africa/Lagos). Project: `/Users/ice/Desktop/TSG`.

**Backend deployment and direct MCP checks passed. Chord conversation/revision
acceptance is not independently verified.** The user is handling Chord after
answering “nvm that's sorted” to the teammate URL/source question.

## Source and integration

The supplied v8 source appeared in `skills/SKILL.md` during this task. It was
adapted in place and copied to `chord/SKILL.md`; `cmp` confirms equality. The old
local mirror has been replaced, not included as a conflicting second revision.
No claim is made about Chord's included skills or published revision.

Adaptations retain actual complaint payload fields (there is no `confirmed`
parameter), map parking to `other`, retain private token lifetimes, v6 request
schemas and v7 payment recovery/error behavior, and avoid treating a scoped
not-found result as proof that no earlier action occurred.

## Actual command outcomes

| Command/check | Result |
|---|---|
| `npm run lint` | Passed, including final code |
| `npm run typecheck` | Passed, including final code |
| `npm test` | Passed after corrections; isolated D1, real MCP transport, mocked Paystack |
| `npm run build` | Passed after final code change |
| `git diff --check` | Passed |
| `cmp skills/SKILL.md chord/SKILL.md` | Passed |
| Baseline discovery capture | 20 deployed definitions saved before changes |
| `npm run deploy` | Succeeded twice; final version below |
| `npx tsx scripts/check-complaint-reliability.ts` | Final run passed against deployed MCP |
| Remote D1 queries for original references | Both exact complaints found; details in field note |
| Remote D1 request-key aggregate | Two incident rows, two different keys, one description |

New migration: **none**. Existing migrations 0001–0005, v6/v7 implementation,
bindings, secrets and Paystack endpoints were preserved. No seed/reset/restore
was run. Complaint lookup uses existing tables and indexes.

Final deployed Worker:

- URL: https://ami-worker.oluwafemiadeleke13.workers.dev
- Version: `8e2406f8-39cc-4784-a841-32e6bee50f15`.
- Server version: 0.6.0.
- 21 tools total. A full structural comparison confirmed all 20 previous MCP
  definitions unchanged. New registration: **`get_complaint_status`**.

The first deployment was `1d8ad6db-065a-4b18-8745-085663da1ab3`; the second corrected
the observed validation error response. No platform publication is implied by
either Worker deployment.

## Regression coverage actually passed

- Stable-key complaint retries and conflicting owner/payload rejection.
- Concurrent same-key writes yield one reference, exactly one `created:true`,
  and one mirrored request row.
- Simulated lost response after a committed write: read by original request key
  recovers the reference without another write. This is not a manufactured real
  Chord timeout.
- New read-only status lookup by reference or key; neither/both inputs rejected.
- Legacy complaint reference lookup and legacy keyed retry compatibility.
- Wrong account cannot find the reference/key; missing, forged or expired private
  capability cannot authorize a read. A key/reference alone is insufficient.
- Read-only calls leave complaint counts unchanged, no-store REST response, and
  MCP errors have controlled codes without exposing capabilities.
- v5/v6 onboarding, maintenance, legacy REST/MCP flows, v7 exact payment reference,
  context-save failure/reuse, Paystack amount/currency/test-domain validation,
  signed duplicate webhooks, invoice/rent reconciliation and fresh migrations
  still pass in the existing suite. Paystack is mocked there.

## Live direct MCP observations

The harness held capabilities only in memory, selected A204 once for the primary
flow, read the profile and both incident references, created one explicitly
labelled fictional QA parking complaint, recovered it by its original request
key, retried with that key, and read invoices plus complaint status under the
same session. Another account and a forged capability were denied access.
The authenticated no-store REST lookup also passed.

QA complaint: **`CMP-dbc7519a-dac0-4382-9e55-e7dae6746990`**. The first run created
it; every subsequent create call used the same persisted request key and returned
`created:false`. No extra QA complaint was created to conceal the initial failed
acceptance assertion. Safe final result metadata is in
`.wrangler/v8-complaint-qa.json`; the private capabilities are not saved there.

The two original references remain open and intact. A separate SQL count/check
after the final run passed: all three exact references remain open at A204,
each has exactly one mirrored request row, and the QA request key has exactly
one complaint row despite the retries.

## Worker evidence

Command: `AMI_AUDIT_OUTPUT=.wrangler/v8-complaint-audit.ndjson npx tsx scripts/tail-payment-audit.ts`.
It writes only allowlisted events, tool name, correlation ID, outcome/code,
complaint reference, created/reused boolean and controlled status. Raw Cloudflare
envelopes, headers, descriptions, request keys and private capabilities are not saved.

Observed direct-client correlation examples:

- Original reference read: `ae3c1104-2c56-4f4d-a979-48bb734da34e` found the first
  exact incident reference, open.
- Second reference read: `f099691d-8c95-4f6e-b416-c82145f4ccc8` found the second,
  open.
- QA create: `e25ccd4c-037e-4ace-b2df-b5ddda64c422` returned that QA reference,
  `created:true`.
- First reuse: `9a4e4e04-0bfc-4a08-937e-727b76dc5ef7`, same reference,
  `created:false`.
- Final deployment reuse: `c557f556-2070-4de9-be41-a74fc031570d`, same reference,
  `created:false`.

The completed capture saved **36 sanitized events (18 invocation/completion pairs)**.
The tail captured successful calls that agree with direct MCP responses and D1.
Not every direct call appeared in the captured tail; completeness is not claimed.
The reason was not established. Local tests separately verify error event codes
and that tokens/secrets are absent. These are **not Chord simulator invocations**.

## Acceptance matrix execution boundary

| Supplied matrix | Actual result |
|---|---|
| A: complaint conversation, one confirmation and farewell | Backend write/retry/read and D1 evidence passed. Actual model replies, numeric consent and no-call farewell not run in Chord. |
| B: same-session bills and complaint lookup | Passed through direct MCP with one retained capability. Chord token retention not inspected. |
| C: new conversation, stable sender/thread association | Authorization isolation passed locally/live. Chord identity/history delivery unverified. No insecure recovery binding added. |
| D: uncertain write recovery | Controlled local lost-response/read recovery and live keyed retry passed. Actual platform timeout/reply behavior not induced. |
| E: payment regression | Existing local provider/webhook/continuity suite passed. No new v8 hosted checkout, simulator payment journey or dashboard inspection performed. Prior live v7 evidence remains separate. |
| Published revision / included / Why this reply | User-handled; not independently checked. |

## Errors actually encountered and corrected

1. The first new local test expected HTTP 401 for a missing capability. Input
   validation correctly returned HTTP 400 instead. Corrected that assertion;
   forged/expired capability cases remain 401 and passed.
2. First live acceptance stopped after observing a real API error-classification
   bug: an invalid locator was logged as `INVALID_INPUT` but returned `TOOL_ERROR`.
   The MCP `fail` helper lacked its Zod branch. Added a safe `INVALID_INPUT`
   response/message, added the missing assertion, reran checks and redeployed.
3. The interrupted live run had already saved its QA case. Its original key was
   recovered via authorized SQL; the harness now saves the non-authorizing request
   key before writing and reuses it after interruption. The final rerun passed
   against the same QA case.

These observed backend defects are not asserted to be the cause of the original
model retractions. The original complaints use distinct keys, and the affected
Chord traces/revision remain uninspected.

## Reproduction commands

```sh
AMI_BASELINE_FILE=.wrangler/v8-baseline-tools.json npx tsx scripts/check-deployment.ts --capture-tools
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
cmp skills/SKILL.md chord/SKILL.md
npm run deploy
AMI_AUDIT_OUTPUT=.wrangler/v8-complaint-audit.ndjson npx tsx scripts/tail-payment-audit.ts
npx tsx scripts/check-complaint-reliability.ts
```

Remote read-only SQL was run with `npx wrangler d1 execute ami-db --remote --command`
for both exact references, owner/status/timestamp, distinct-key/description count,
and the QA row/mirror count. Table/column names were checked against the existing
migrations before those queries. No private token was included in SQL or output.
