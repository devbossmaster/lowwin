-- Preserve every historical v2 intent. New v1 intents use their own immutable
-- version marker, charge type and credential binding; no financial row is reset.
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_flowVersion_check";
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_flowVersion_check" CHECK ("flowVersion" IN (1,2,3));
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_chargeType_check";
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_chargeType_check" CHECK ("chargeType" IN ('HOSTED','DIRECT','INLINE'));
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_v1_version CHECK (
 ("flowVersion"=3 AND COALESCE(initialization->>'apiVersion','')='v1' AND "chargeType" IN ('HOSTED','INLINE'))
 OR ("flowVersion" IN (1,2) AND COALESCE(initialization->>'apiVersion','v2')<>'v1' AND "chargeType"<>'INLINE')
);
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_v1_inline_fields CHECK (
 "chargeType"<>'INLINE' OR "payerPhoneCipher" IS NOT NULL AND "paymentMethod" IS NOT NULL AND "reconcileUntil" IS NOT NULL AND "checkoutUrl" IS NULL
);
CREATE INDEX "ChapaCheckout_v1_reconcile_idx" ON "ChapaCheckout"("nextCheckAt") WHERE "flowVersion"=3 AND "creditJournalId" IS NULL;
