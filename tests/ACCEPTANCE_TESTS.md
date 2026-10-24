# Ami v8 — Simulator acceptance tests

Run in the existing Chord simulator with fictional data. Capture actual tool results,
Worker events and D1 records. Assistant prose alone is not proof of a write.
The supplied matrix was recovered from the user's open v8 conversation; contract
notes below adapt it to this repository. Actual outcomes belong in
`qa/V8_QA_LOG.md`, including checks not performed.

## A. Full complaint journey

1. User: `Hi Ami. I want to make a complaint.`
2. With no active profile, follow discovery. Pick `1` for Seun's A204 sample account.
3. The numbered choice authorizes opening that fictional profile, without another yes.
4. User: `My neighbours keep parking in my allocated parking spot.`
5. Expect a concise summary and one confirmation question.
6. User: `Yes, save it.`
7. Expect one successful `create_complaint`, returning its actual reference.
8. User: `That's all, thanks.` (also test `Nothing I am good` and `Nothing`).
9. Expect a brief goodbye: no tools, retraction, new complaint or reopened account.
10. Compare exact reference, owner and row count in D1 before and after goodbye.

Actual create payload: `{session_token,category:"other",description,idempotency_key}`.
There is no `confirmed` field on this existing tool. Get consent conversationally.

## B. Same-session continuity

1. `Show my outstanding bills.` Expect `get_my_invoices`, no new profile search.
2. `I want to check the complaint I raised.` Expect `get_complaint_status` with
   the valid session and exactly one `complaint_id` or `request_key`.
3. Compare returned reference/status to D1; checking must not create another row.
4. If the lookup isn't enabled in Chord, state current verification limits without
   declaring the previous reference fake or submitting a new complaint.

## C. No session and new conversation

1. Start a new chat with the same display name.
2. Do not use the name as authentication; explicitly reselect a fictional profile.
3. Inspect stable participant/channel metadata, thread IDs, tool context and memory
   association if available. Do not infer that they work from a greeting.
4. A complaint reference or request key alone must grant no access.

## D. Error and indeterminate write

1. In an isolated development environment, discard a successful create response
   or simulate a timeout after commit. Do not manufacture a provider/platform fault.
2. Expect a short uncertainty response, no invented reference and no new key/write.
3. Read `get_complaint_status({session_token,request_key})` with the original key.
4. A deliberate retry with that same key must return the original reference and
   `created:false`. Concurrent retries must create one complaint and mirror row.
5. Conflicting payload/owner, malformed locators, forged/expired sessions and
   another resident's lookup must not reveal another account's complaint.

## E. Payment regression

1. Read an invoice, confirm a Paystack TEST checkout and receive a real provider URL.
2. Return: `Check my payment.` Expect `check_latest_payment` with the active session.
3. Show only verified status. Redirects are not proof of payment.
4. Retain v7 exact-reference, amount/currency/test-domain, idempotency and webhook checks.

## Evidence to collect

- Chord published/included revision, competing included skills, per-reply revision
  (`skill_execution_id` if shown), tool invocation/result and stable thread/participant.
- Sanitized Worker audit invocation/completion IDs and exact complaint reference.
- D1 `complaints`, mirrored `requests`, owner, status and count. In this schema
  `complaints.resident_id` refers to `tenancies.id`.
- Paystack TEST transaction reference and verified outcome for any new checkout.
- For a repeated contradiction, preserve the actual reply, trace, revision and DB result.

There is no secure Chord participant binding established in this repository.
`get_active_resident_context` is not deployed. Existing `get_my_profile` already
reads authorized context when a valid private capability is available; it cannot
recover a lost capability from a display name or untrusted sender ID.
