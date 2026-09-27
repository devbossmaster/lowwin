# Phase 1 operations

## Bot inbox

`POST /api/bot/webhook` checks the Bot API secret before parsing/persisting, rejects invalid update IDs and deduplicates using an INSERT with ON CONFLICT DO NOTHING. Response 200 means durably enqueued, not necessarily delivered. A stopped worker causes queued updates, not lost updates.

Worker reads due rows with `FOR UPDATE SKIP LOCKED`, handles commands, and marks completion in the same DB transaction. Failures use exponential backoff, capped at an hour and eight attempts. Inspect rows with `processedAt IS NULL AND attempts >= 8`; after fixing the cause, an operator can reset `attempts=0, nextAttemptAt=now()` for selected IDs. This is an explicit retry and may resend a previously delivered message after ambiguous network failure. It does not create a user/session or touch a point wallet. Processed raw payloads are cleared to minimize stored personal data; add a retention policy for terminal failed payloads before production.

No deployment or real bot setup was performed during local implementation. Never run two polling/webhook bot consumers. The worker uses `bot.init()` and queued `handleUpdate`, not `bot.start()`.

## Wallet proof

Use `npm run wallet:reconcile` against the intended environment. A zero-drift report means every projection equals its journal posting sum **and** each wallet's HELD projection equals the sum of its auction holds in the same SQL snapshot. Drift entries identify `POSTING` or `HOLD`. Immutable correction journals, not edits, are required for future repair procedures. Reconciliation does not prove future auction rules or provider settlement that have not been implemented.

Apply `202609270001_hold_integrity` in a controlled migration window. It locks the relevant tables while installing guards and checking existing totals; any pre-existing discrepancy aborts the migration. It adds the internal `WalletHoldGuard` table with RLS enabled and no anon/authenticated access. Runtime-role access to the new table/functions must be validated on production Supabase before release; local owner-role tests do not prove these grants. The trigger functions are invoker-rights functions.

No public reserve/release/credit route exists. Internal hold commands include the auction and hold IDs in journal references, scope keys by user and `HOLD_ADJUST`, reject over-release/insufficient available points and keep all writes in one transaction. Callers composing Phase 3 must preserve auction-then-wallet lock order and retry entire transactions after serialization failures. The guard revision row is concurrency metadata, not a ledger account or source of points.

Runtime DB credentials should not have DDL/TRUNCATE/superuser privileges. The table owner can bypass RLS and alter triggers, so use separate migration credentials. Stage and rehearse role grants, backups and restore before production. Supabase public anon/authenticated roles have no access to foundation tables.

## Owner inputs remaining

- Confirm actual bot username/token, webhook secret and HTTPS app domain/ngrok origin in private server configuration.
- Supply a development Supabase project and Vercel secret settings. Use the Connect dialog's actual pooler hostname; do not guess it.
- Select an always-on host for the command worker. Vercel request handlers cannot host an infinite worker loop.
- Verify real /start, /help, menu button and Android/iOS Telegram launch. Local cryptographic fixtures do not replace this.
- Review Phase 1 before starting the catalog phase. Phase 6 payment/provider and launch approvals remain separate.
