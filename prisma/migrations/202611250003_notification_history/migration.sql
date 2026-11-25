-- Seek recent notification roots without blocking worker sends.
CREATE INDEX CONCURRENTLY "Outbox_notification_history_idx"
  ON "Outbox" ("createdAt" DESC, id)
  WHERE "testRunId" IS NULL AND COALESCE(payload->>'rootKey',key)=key;
