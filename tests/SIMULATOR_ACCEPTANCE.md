# Ami v7 — WhatsApp simulator acceptance tests

## Before testing
- Confirm latest SKILL.md is PUBLISHED in Chord, not merely uploaded.
- Refresh Chord's connection to `/mcp` and ensure tool `check_latest_payment` appears. A REST health check does not prove Chord tool calls work.
- Confirm D1 migration for `payment_session_context` applied to both local and remote `ami-db`.
- Confirm Worker uses a `sk_test_...` Paystack key. Never use real tenant data or live payments.
- Start `npx wrangler tail ami-worker` and open Paystack TEST transactions.
- Create a fresh simulator chat with the sample name Seun. Do not reuse earlier chats when comparing behavior.

## Happy-path script
| Step | Message to Ami | Required action / pass condition |
|---|---|---|
| 1 | `Hi Ami.` | Concise greeting, no unnecessary emojis. |
| 2 | `Can you show me my tenancy details?` | Calls `find_demo_profiles` if no valid session; never fabricates a match. |
| 3 | `1` (only after choices returned) | Calls `open_demo_profile` exactly once, then `get_my_profile`. Reports tool-confirmed unit. |
| 4 | `Show my pending bills.` | Calls `get_my_invoices` with SAME valid session token. **Does not search Seun again.** |
| 5 | `I want to pay the October electricity bill.` | Selects tool-returned invoice and asks for explicit confirmation. |
| 6 | `Yes, generate the test checkout.` | Calls `create_payment_link`. Returns exact HTTPS Paystack URL and reference. |
| 7 | Open URL, complete a **test-mode** checkout. | Paystack TEST dashboard shows the same reference and expected amount. Checkout's return page alone is NOT confirmation. |
| 8 | `Check my payment.` | Calls `check_latest_payment` with active `session_token`. Responds with actual Paystack status, invoice and reference. **Does not ask for invoice ID or restart profile selection.** |
| 9 | `Show my pending bills again.` | If verified paid, retrieves D1 invoice state and shows that invoice paid. If not confirmed, still unpaid. |

## Negative tests
1. **Unfinished checkout:** Generate a fresh link, do not complete checkout, say `Check my payment.` Agent must never say paid. Status may be pending, ongoing or abandoned.
2. **Wrong account:** Open another *fictional* demo profile in a different chat. Checking latest payment must not return Seun's payment.
3. **Missing token:** Start a fresh chat and say `Check my payment.` Agent should help open a sample resident profile first; never authorize via name alone.
4. **Repeat request:** Say `Check my payment` twice. The tool must be safe to call repeatedly; no duplicate paid invoice updates.
5. **Already paid:** Ask to pay the paid invoice again. API should refuse a new checkout with `already_paid`.
6. **Provider error:** Temporarily simulate Paystack API failure in a safe *local test* (don't intentionally break production). Agent should say verification cannot be completed right now and should not claim success.
7. **Same resident, new demo session:** Reselect the same fictional demo resident; `check_latest_payment` can fall back to payment attempts owned by that verified resident, without requiring a reference.

## Verify independently in D1
Use the actual remote database name and inspect just non-sensitive metadata. Do not print raw resident session tokens or API secrets.

```bash
npx wrangler d1 execute ami-db --remote --command "SELECT reference, invoice_id, resident_id, status, created_at FROM payment_attempts ORDER BY created_at DESC LIMIT 5"
npx wrangler d1 execute ami-db --remote --command "SELECT invoice_id, payment_reference, updated_at FROM payment_session_context ORDER BY updated_at DESC LIMIT 5"
npx wrangler d1 execute ami-db --remote --command "SELECT id, description, status, paid_reference FROM invoices ORDER BY due_date DESC LIMIT 10"
```

A pass requires the Chord tool invocation, corresponding D1 records and Paystack test transaction to agree. Do not infer payment success solely from redirect or assistant prose.

## Capture TSG Labs field notes
For each failure, log: simulator message, tool requested, actual tool response/error, Cloudflare log evidence, D1/Paystack evidence, root cause, fix, and one actionable improvement to Chord. Specifically document any model claim that a tool was called when no tool call appears in logs.


## Actual repository adaptation and evidence boundary

Migration is `0005_payment_session_context.sql`, because 0004 was already deployed.
The current capability store is `sessions`, using epoch-second expiry and tenancy
ownership. Context uses `tenancy_id`; `payment_attempts.resident_id` also denotes a
tenancy ID in this app. Expired session cleanup cascades through the context FK.

Replace `resident_id` with `tenancy_id` when inspecting `payment_session_context`.
The user is handling Chord and the Paystack dashboard. Direct MCP clients and
Cloudflare/D1/Paystack API evidence do not by themselves mark these simulator rows
passed. See `PAYMENT_CONTINUITY_V7.md` for exactly what was observed and what was not.
