# Retained database review

This is a point-in-time, read-only review from the operator's local workstation. No production deployment, migration, permission change, bot message, provider charge or customer-data cleanup was performed.

The target was checked against the intended project before connection. Inspection ran in bounded `REPEATABLE READ`, `READ ONLY` transactions with statement and lock limits. Reports contain aggregate counts and catalog metadata, not customer identities, credentials, phone numbers or individual payment evidence.

## Confirmed snapshot

| Check | Observation |
| --- | --- |
| Registered customers | 1,312 |
| Own-contact records | 1,291, all non-revoked and linked to matching Telegram identities |
| Wallets | 1,190; wallet creation is lazy |
| Auctions | Four scheduled, none past their end, none DEMO or tagged test runs |
| Accepted bids | 21 |
| Finalized settlements | Zero |
| Historical payment intents | 32: 21 credited, five need review, six rejected |
| Payment claims / admin wallet credits | 19 / two |
| Ledger reconciliation | Zero drift across posting projections, holds, bid fees, fee refunds and settlements |
| Payment reconciliation | Zero drift under the existing server reconciliation query |
| Frozen terms | All four use `lowest-unique-v4`; no rule change was applied |
| Applied migration history | 31 applied migrations match local checksums, including normalized line endings where needed |
| ArifPay checkout table | Absent; the additive checkout migration remains unapplied |
| Financial safeguards | 82 non-internal model-table triggers enabled; no unvalidated constraints found |
| Client table access | Model tables have RLS enabled; no SELECT/INSERT/UPDATE/DELETE privileges for `anon` or `authenticated` |

Reconciliation completed in a separate read-only transaction in about 8.2 seconds. These observations are a baseline, not a substitute for repeating counts and reconciliation immediately before release.

## Configuration differences affecting local login

The local staging bot matches none of the retained contact records. The locally configured contact key IDs also match none of the stored contact ciphertext prefixes. This is a local configuration mismatch; it does not establish damage to live customer records.

Do not rebind, reset or re-enroll retained customers to work around it. Existing-customer testing requires the intended bot identity and original protected contact keyring/HMAC configuration. A disposable staging database can instead use independent staging identities and keys. An empty database does not preserve live registrations; replacing production requires a separately reviewed migration and restore/reconciliation rehearsal.

The inspected login has `BYPASSRLS` and role/database creation privileges. It was constrained to read-only transactions for this audit. It is not an appropriate application runtime login. This finding describes the operator's audit connection; it does not identify the deployed runtime credential.

## Security permission requiring review

`cleanup_test_run(text)` is a `SECURITY DEFINER` cleanup routine. Its PUBLIC execute grant is revoked, but explicit `anon` and `authenticated` execute grants remain. It is the only non-trigger SECURITY DEFINER function found in the application schema during this inspection.

The routine was never invoked. No auction qualifies as tagged test data in this snapshot, and no cleanup is proposed. The release includes a separate additive permission correction for review and disposable-database verification. Apply it only through the reviewed migration process; do not rewrite historical migration files or execute the cleanup function to test access.

## Timing boundary

A separate connection check observed a first read of about 3.1 seconds and four warm reads of about 1.2–1.4 seconds from this workstation. These are local-to-database observations, not production API p95, Telegram launch measurements or provider verification latency.

## Contact-check follow-up

Contact GET now reuses the contact snapshot already loaded by the server's bound-session proof check. POST also reuses the bound Telegram identity/contact snapshot and replaces its advisory-lock/read/upsert transaction with one conditional atomic upsert. The existing `own-contact-request:<user>` key and 60-second cooldown remain in place; concurrent requests cannot both obtain permission. The database clock controls renewal.

Native timeout errors now use clear Retry text. Telegram's native contact-approval callback has a finite 30-second wait, and stale callbacks/polls are ignored after retry, cancellation or unmount. The existing six-second contact-read and 12-second bot-request fetch deadlines are unchanged. Safe fixed-stage diagnostics and private `Server-Timing` expose where time was spent without logging launch data, cookies, recipients, credentials or provider response bodies.

These changes reduce redundant work and bound the waiting state. They do not repair a mismatched bot/keyring or establish live sign-in recovery. Focused regression results are recorded with the release commit. Physical Telegram Android/iOS, merchant verification, deployment role checks and pre-release reconciliation remain required.
