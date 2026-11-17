-- Bounded fan-out/history/deletion work retains the original immutable Outbox
-- intents. These indexes add no privileges and rewrite no historical payloads.
CREATE INDEX "Outbox_broadcast_root_state_idx" ON "Outbox" ((payload->>'rootKey'),state,kind)
 WHERE kind IN ('BROADCAST','GLOBAL_CAMPAIGN');
CREATE INDEX "TelegramMessage_pending_delete_idx" ON "TelegramMessage" (id,"outboxId")
 WHERE "deletionState"='DELIVERED';
