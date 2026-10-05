-- Extend the receiving-account allowlist without rewriting any policy versions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "PaymentPolicy"
  DROP CONSTRAINT "PaymentPolicy_channel_check",
  ADD CONSTRAINT "PaymentPolicy_channel_check"
    CHECK (channel IN ('telebirr', 'cbe', 'mpesa'));

COMMIT;
