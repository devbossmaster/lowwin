# Staging smoke and recovery record

Use the release gate table in [phase6-release.md](phase6-release.md). This document is a plan where real accounts/infrastructure are needed, not evidence of a completed production check.

## Telegram Android and iOS

Record app/OS versions, bot username, HTTPS origin and test-account IDs in a private evidence record. Launch from BotFather-configured Mini App buttons; validate authentic raw `initData`, fresh authorization time and correct account. Close/reopen, background/resume and switch Telegram accounts. Verify safe areas, keyboard, back navigation, image picker, copy and offline recovery at 360/430px-equivalent widths. Repeat signed-out, tampered signature, expired launch, public dev-identity and stale cookie rejections. Website cookies or browser headers are not Telegram proof.

With separate explicit notification opt-in and confirmed private `/start`, test accepted-bid, settled/no-winner/cancelled and fulfillment messages. Confirm no bid amount distributions, balances or contact details appear. Block the bot, retry, restart `/start`, and check terminal/recovery behavior. Never broadcast to real players during smoke testing.

## Hosted HTTP boundary

On the staging production build behind the actual ingress, capture response headers and body-cache behavior for guest/authenticated `/wallet`, `/my-bids`, `/profile`, `/admin`, `/api/wallet/top-ups`, `/api/wallet/scan` and `/api/admin/payments`. Require private/no-store where applicable, cookie variation, no indexing on admin/private pages, MIME-sniffing prevention and no referrer leakage. Check failed auth responses too. Do not allow a CDN to override private headers or cache one user's HTML/API result for another.

Test TLS/HSTS at ingress, safe CSP/script policy including Telegram's official script, upload/body-size limits, OCR deadline/memory/process packaging and absence of credentials/receipt PII in hosting logs. Local `next build` cannot establish ingress behavior.

## Worker restart and reconciliation

1. Schedule fresh isolated DEMO fixtures, place accepted bids, and stop the settlement worker before cutoff. The page must show Closing / result pending, never a guessed winner.
2. Restart `worker:auctions`; run two workers concurrently. Capture elapsed full transaction time against the 120-second limit. Verify one immutable settlement, no half-settled wallets and clean reconciliation.
3. Interrupt a test worker before commit, and again after commit. Retry and verify balances/fees/results unchanged. The integration suite has these cases; repeat with the staging supervisor and connection limits.
4. Stop the notification worker while jobs are pending, then restart. Check retry/backoff, terminal errors and private inbox deduplication. An external message accepted before a crash may repeat; no financial operation may repeat.
5. Terminate funding verification after lease acquisition/provider response. Revoke the user's/staff session and confirm no credit occurs with lost access. After an expired lease, an authorized retry may proceed; the global transfer claim still prevents double credit.

## Backup and key recovery

Restore a backup into a separate database; never overwrite the active database as a drill. Verify migration history, immutable guards, all reconciliation results, representative session rejection, and decryption with the correct historical keyring. The local Phase 6 drill used custom-format `pg_dump` plus `pg_restore --no-owner --exit-on-error` into a new loopback `_test` database. Production encrypted backups, retention, RPO/RTO and hosted recovery access remain owner requirements.

Back up dedicated delivery-contact keys independently from MFA keys. Rehearse legacy-contact rotation and restore old backups before retiring any key. Record who can recover keys and who can execute migration-role commands.

## Monitoring and capped rollout

Name accountable Owner and Payments Operator. Alert on nonzero reconciliation drift immediately, settlement attempts approaching the transaction deadline, outbox backlog/age, terminal Telegram failures, provider auth/quota/rate-limit/outage, funding requests pending over one hour and unmatched statements. Logs should contain bounded error codes and private case IDs only. Select thresholds using staging traffic and provider quota.

Review all blockers, sign the release packet, then approve a small explicit transfer cohort with capped amounts and daily independent bank reconciliation. Pausing a channel affects new intents only; production interlock rollback must stop new credits while preserving histories. No point balance editing, automatic spent-wallet reversal or manual payment mint is part of recovery.
