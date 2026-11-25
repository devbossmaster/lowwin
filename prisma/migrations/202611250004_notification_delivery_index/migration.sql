-- Fetch campaign deliveries for the selected notification history page.
CREATE INDEX CONCURRENTLY "Outbox_notification_delivery_root_idx"
  ON "Outbox" ((payload->>'rootKey'), kind)
  WHERE "testRunId" IS NULL AND payload->>'rootKey' IS NOT NULL;
