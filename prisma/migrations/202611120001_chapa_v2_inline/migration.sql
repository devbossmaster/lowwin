-- New v2 Inline intents are distinct from historical v1 SDK and v2 direct/hosted intents.
-- Existing financial records, references and credential bindings are unchanged.
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_flowVersion_check";
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_flowVersion_check" CHECK ("flowVersion" IN (1,2,3,4));
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT chapa_v1_version;
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_v1_version CHECK (
 ("flowVersion"=3 AND COALESCE(initialization->>'apiVersion','')='v1' AND "chargeType" IN ('HOSTED','INLINE'))
 OR ("flowVersion" IN (1,2) AND COALESCE(initialization->>'apiVersion','v2')<>'v1' AND "chargeType"<>'INLINE')
 OR ("flowVersion"=4 AND COALESCE(initialization->>'apiVersion','')='v2' AND "chargeType" IN ('HOSTED','INLINE'))
);
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_v2_inline_identity CHECK (
 "flowVersion"<>4 OR (
  COALESCE(initialization->>'flow','')="chargeType"
  AND COALESCE(initialization->>'amountCents','')="amountCents"::text
  AND COALESCE(initialization->>'merchantReference','')="merchantReference"
  AND COALESCE(initialization->>'idempotencyKey','') ~ '^[A-Za-z0-9:._-]{16,128}$'
  AND COALESCE(initialization->>'publicKeyFingerprint','') ~ '^[a-f0-9]{64}$'
  AND "payerPhoneCipher" IS NOT NULL AND "paymentMethod" IS NOT NULL AND "reconcileUntil" IS NOT NULL
 )
);
CREATE FUNCTION protect_chapa_inline_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."flowVersion"=4 AND OLD."chargeType"='INLINE' AND (
  NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
  OR OLD."authorizationReference" IS NOT NULL AND NEW."authorizationReference" IS DISTINCT FROM OLD."authorizationReference"
  OR OLD."authType" IS NOT NULL AND NEW."authType" IS DISTINCT FROM OLD."authType"
  OR OLD."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId"
 ) THEN RAISE EXCEPTION 'Inline payment intent and accepted authorization are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chapa_inline_v2_guard BEFORE UPDATE ON "ChapaCheckout" FOR EACH ROW EXECUTE FUNCTION protect_chapa_inline_v2();
CREATE INDEX "ChapaCheckout_inline_v2_reconcile_idx" ON "ChapaCheckout"("nextCheckAt") WHERE "flowVersion"=4 AND "creditJournalId" IS NULL;
