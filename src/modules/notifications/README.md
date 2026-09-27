# Notification boundary

Phase 5B commits immutable outbox intents and permitted inbox entries with accepted bids, settlements/cancellations and fulfillment events. `service.ts` owns fixed private templates, scheduled favorite/start deduplication and the row-locked dispatcher. No live bid values, balances, contact details or identity profiles enter bot messages.

`npm run worker:notifications` is separate from the authenticated webhook command worker and settlement worker. Opt-in and confirmed private `/start` chat are required. Preferences, favorites and auction state are rechecked at dispatch. Historical illustrative DEMO inventory is excluded.

Delivery metadata handles 429 retry_after, bounded backoff, blocked chats and terminal failures. Operator retry is Owner-only, reasoned and audited. Outbox content, keys and original settlement references cannot change. Telegram has no exactly-once guarantee: crash after external send and before database acknowledgement may repeat the message. A delivery retry never invokes a ledger mutation.

See `docs/phase5b-operations.md` and the Owner runbook for validation, retention and release gates. No real messages were sent in tests; grammY transport was intercepted.
