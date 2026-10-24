# Ami v6 Acceptance Matrix — Chord Simulator + Worker + D1

Use fictional names and test-mode data only. Record Chord reply, invoked tool, raw result (redact tokens), and the actual D1/Paystack side effect.

| # | Simulator interaction | Expected calls | What to verify |
|---|---|---|---|
| 1 | "Hello" / "What can you do?" | none | Short professional intro; no emojis or invented functionality |
| 2 | Name `Seun`: "Show my tenancy" | `find_demo_profiles` | Returns multiple fictional profiles; asks which account rather than guessing |
| 3 | Select one Seun fixture | `open_demo_profile`, `get_my_profile` | Correct D1 property/unit; `session_token` not shown |
| 4 | Name not found: "I'm just testing" | `find_demo_profiles`, `create_demo_resident`, `get_my_profile` | New D1 unit, resident, demo_profiles row, 2 invoices; no made-up data |
| 5 | After selection: "Show my bills" | `get_my_invoices` | Correct scoped rent/electricity invoices; no repeat onboarding |
| 6 | "Please give me a payment link for electricity" | `create_payment_link` after consent | Real returned Paystack `checkout_url`, accurate amount, explicit test label |
| 7 | Checkout abandoned, then "Check payment" | `check_payment_status` | No false paid status; D1 remains unpaid |
| 8 | Complete test checkout and ask status | `check_payment_status` | Paystack test reference/amount/currency match; invoice paid only after verification |
| 9 | Name not found: "I live here but I'm not registered" | `start_resident_registration` after confirmation | D1 pending request reference; no access to someone else's invoices |
| 10 | Check registration status in same chat | `get_onboarding_status` | Pending/unverified, private lookup token not shown |
| 11 | Start new chat with same display name | `find_demo_profiles` | No claim of automatic secure authentication without trusted sender binding |
| 12 | Set `DEMO_MODE=false`, or inject `sk_live_*` in local controlled env | demo tool blocked | 404 DEMO_DISABLED for a disabled flag; 503 TEST_KEY_REQUIRED for a missing/live key (existing v5 contract); existing backend behavior unaffected |
| 13 | Invalid `demo_profile_id` | `open_demo_profile` fails | No token, account or fabricated match |
| 14 | Repeat `create_demo_resident` with same request_key | same sample record | No duplicate resident/unit/invoices |

## D1 spot-checks (adapt table/column names to current schema)

```sql
SELECT COUNT(*) AS n FROM demo_profiles WHERE profile_type='generated';
SELECT r.preferred_name, t.unit_id, u.property_name
  FROM demo_profiles dp JOIN tenancies t ON dp.tenancy_id=t.id
  JOIN residents r ON t.resident_id=r.id JOIN units u ON u.id=t.unit_id
  WHERE dp.profile_type='generated' ORDER BY dp.created_at DESC LIMIT 5;
SELECT i.kind, i.amount_kobo, i.currency, i.status
  FROM invoices i JOIN demo_profiles dp ON dp.tenancy_id=i.resident_id
  WHERE dp.profile_type='generated' ORDER BY i.id DESC LIMIT 10;
SELECT id,status,created_at FROM onboarding_registrations ORDER BY created_at DESC LIMIT 5;
```

## Deployment field notes
For each real issue, record: timestamp, attempted request, error/result, how you diagnosed it, root cause, exact code/config fix, outcome, and actionable feedback for Chord/Cloudflare.


## Observed results

See `ONBOARDING_V6.md` for backend test/deployment outcomes. Automated local tests
exercise the REST API and real MCP transport with isolated D1 and mocked Paystack.
The Chord conversational rows above remain a manual matrix: the user is handling
Chord, and this session did not invoke a connected Chord simulator. No simulator
conversation or token-display behavior is claimed tested here.
