# Chapa TEST readiness — 28 October 2026

The saved migration credential was verified against the same Supabase project as the application's restricted staging runtime login and a different project from production. Migration credentials remain separate from runtime credentials.

The existing migration checksums differed from this checkout. A read-only catalog comparison confirmed that common table columns, checks, foreign keys, triggers, indexes and normalized financial function definitions matched the verified production baseline. A differing RLS helper was left unchanged; Chapa's new tables explicitly enable RLS, revoke browser grants and define server policies. Historical migration checksums were preserved.

Backups and a reviewed manifest were saved privately under ignored `.local/chapa-staging/`. Applied only the Chapa storage migration and three Master Guide Admin migrations. Existing protected users, staff rows, sessions, wallet and financial records passed before/after row-hash checks. Obsolete authentication-table rows were backed up before their tables were removed.

Verified through the restricted runtime login:

- Chapa checkout/webhook tables and the new admin fields exist.
- Runtime can read/insert/update checkout state and read/insert webhook events, without schema ownership, CREATE, role creation or superuser privileges.
- Receipt reconciliation reports zero drift.
- The TEST private key authenticates against Chapa's read-only payment-methods endpoint.
- The public test origin serves the new admin signup page.
- A synthetic signed event for an unknown TEST checkout returns 200; duplicate delivery returns 200 and stores one event. Invalid or modified signatures return 401. Checkout, journal, posting and wallet totals remain unchanged.

`CHAPA_MODE=test`, test checkout and recovery are enabled locally. Live Chapa, legacy live funding and wallet-spending switches remain off. This is the current staging configuration; production payment configuration was not changed.

The webhook probe was generated locally, so it does not prove delivery from Chapa's dashboard. No merchant checkout, payment or wallet credit was created during preparation. Complete a real merchant TEST checkout and Telegram return check next. For background recovery during that test, run the existing `npm.cmd run worker:chapa` with the same reviewed test configuration. On this workstation, provider diagnostics used `NODE_USE_ENV_PROXY=1` for its configured network proxy.

## Dashboard setup follow-up

The operator reported saving the Chapa dashboard webhook on 28 October. The public endpoint was reachable, and another synthetic signature/duplicate test passed: valid and duplicate requests returned 200, invalid/tampered requests returned 401, one event was retained and protected financial totals were unchanged. This still does not prove a delivery from Chapa.

Read-only verification of the two existing TEST top-up attempts returned HTTP 403 / `INVALID_VALUE`, specifically “API key environment does not match business environment.” Both attempts lacked checkout URLs and wallet credits. The local key/configuration is TEST. The dashboard business must be in the matching Test environment before continuing; its current setting has been requested from the operator. The guarded TEST recovery worker was started, verified, then stopped to avoid repeated rejected calls while this is unresolved. No new checkout or payment was submitted. Existing attempt references and idempotency keys must be reused once the mismatch is corrected.

The operator subsequently selected **Test**. Read-only verification then returned 404 / `NOT_FOUND`, confirming that the environment rejection was resolved and those attempts had not initialized at Chapa. Retrying the same saved intent revealed a phone validation rejection for its verified Ethiopian 07 contact, with both `+251` and digits-only international representations. No substitute phone was used.

Hosted initialization now sends the persisted request without automatically injecting the Telegram contact as Chapa customer prefill. Payers enter payment contact details on Chapa; Lowwin's verified-contact authorization and original wallet ownership remain unchanged. Mocked provider checks and isolated database tests cover the exact persisted retry body, private-contact omission, uncredited initialization and exactly-once verified accounting.

The merchant TEST API returned HTTP 500 / `PROCESSING_FAILED` / “Internal server error” for requests without optional customer prefill, including an empty customer object. Checkout creation and actual Chapa webhook delivery remain unverified. No second Lowwin checkout, payment submission or wallet credit was created during these retries. The TEST worker remains stopped while initialization is unresolved; these responses must not be presented as a completed payment.

The operator's dashboard screenshot subsequently confirmed **Test** selected, **CHAPA_SIGNATURE / PAYMENT**, **Active**, and the exact configured public webhook URL. This verifies dashboard configuration, not delivery. A final initialization retry without the optional external logo also returned HTTP 500. The provider request ID and a support draft excluding keys, secrets and phone numbers are saved privately under `.local/chapa-staging/`. The phone-entry change passed 34 provider/API/client checks, all 20 isolated checkout database tests and an optimized production build.

## Review of the supplied official v2 references

Reviewed the hosted checkout, webhook and migration references plus the official Node SDK source. The published SDK uses the legacy initialization contract and is not a replacement for the v2 adapter. The v2 hosted contract explicitly makes customer details and method preferences optional. Lowwin's wire request is covered by a regression test confirming neither is added when omitted.

A staging diagnostic at **2026-10-28T19:50:42Z** returned HTTP 200 and a valid Chapa TEST checkout URL using only integer-cent amount, ETB currency and the existing merchant reference. That URL was saved on its existing Lowwin attempt. Checkout count and journal/posting counts were unchanged; no payment was submitted by the diagnostic. Requests retaining the configured return/callback URLs still returned HTTP 500, including one without metadata and customization. These trials used existing intent keys, so the provider's documented response replay behavior prevents treating them as conclusive isolation of the failing field. No production payload fallback or change to frozen intent keys was introduced. Automatic return, payer form behavior and a verified payment remain unconfirmed.

Webhook hints now schedule authoritative verification without replacing the checkout's existing status. Recovery includes queued terminal checkouts, allowing delayed events to be checked without presenting an old event as the latest financial state. Forty mocked provider/API/client checks and all 20 isolated database checkout checks passed in this follow-up.

The final TypeScript check and optimized webpack production build passed. The owned loopback test database was stopped after validation. Browser automation was unavailable in this session, so the hosted payer form was not visually verified. A read-only merchant verification of the initialized TEST checkout returned `PENDING`, with null Chapa/processor references; it was not valid final credit evidence and no credit was made. The TEST recovery worker remains stopped.

## Completed TEST payment and simplified checkout follow-up

The operator subsequently completed the 100 ETB TEST checkout. Merchant verification returned `SUCCESS` and matched the stored merchant reference, amount and currency. Two compatibility issues caused the old review state: the optional processor reference was an empty string, and the TEST URL's session token differed from the final payment reference. Both are now handled without relaxing successful-payment identity or amount checks.

The guarded compatibility migration was applied only to staging. Its previous function was backed up, its prior body matched the reviewed baseline, and protected checkout/financial row hashes were identical before and after the function update. The completed payment was then processed through normal merchant verification and ledger code: **one 100 ETB TEST credit, one balanced journal, one receipt, zero Chapa reconciliation issues**. A repeated verification created no second receipt.

The customer flow now uses one visible Pay button and automatically opens hosted checkout. Amount entry, preset amounts and Chapa selection remain on one compact sheet. Credit updates on foreground return or background recovery; no payer phone or payment method is prefilled. The hosted request uses the documented minimal fields, resolving the optional-field initialization failures without switching accounts or API versions.

The guarded TEST recovery worker was restarted for automatic verification. Live payments remain disabled and production has not been deployed. Isolated provider/client/navigation checks, checkout accounting tests and schema/permission tests cover the fixes; bilingual mobile browser fixtures verify the visible action, automatic handoff, no optimistic credit and foreground balance refresh.

Final verification passed 46 provider/API/client/navigation tests, 22 isolated accounting tests and nine schema/permission tests (77 total), plus TypeScript and the optimized webpack production build. The unchanged minimal adapter also initialized the remaining saved TEST intent with HTTP 200 and a checkout URL, reusing its original idempotency key without creating another intent or changing financial rows.

Mobile browser fixtures passed in English and Amharic at 360px and 430px. One final 360px run timed out at cold development startup before reaching checkout; its focused rerun passed. Screenshots confirmed that the Pay action remains in the viewport. These are isolated browser fixtures with mocked mutation responses, not physical-device or live-payment acceptance. Development compilation remains slow; no launch-speed improvement is claimed from these checkout checks.
