# Notification boundary

Outbox has a unique event key and is written in the same transaction as its future domain change. Phase 5 adds user preferences, notification rows and dispatch. Phase 1 worker handles the durable Telegram command inbox only. Telegram sendMessage has no idempotency parameter: a crash after delivery before acknowledgment can duplicate a reply; never advertise exactly-once external delivery.
