-- Additive coordination only. Payment amounts, receipts and ledger rows are unchanged.
ALTER TABLE "ChapaCheckout"
  ADD COLUMN "providerCancelledBy" TEXT,
  ADD COLUMN "verificationSignalVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "verificationHandledSignalVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastPrivateCheckAt" TIMESTAMP(3),
  ADD COLUMN "verificationRetryAfter" TIMESTAMP(3);

ALTER TABLE "ChapaWebhookEvent"
  ADD COLUMN "providerReasonCode" TEXT,
  ADD COLUMN "cancelledBy" TEXT,
  ADD COLUMN "providerUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "paymentMethod" TEXT;

CREATE INDEX "ChapaWebhookEvent_checkoutId_receivedAt_idx"
  ON "ChapaWebhookEvent"("checkoutId", "receivedAt");
