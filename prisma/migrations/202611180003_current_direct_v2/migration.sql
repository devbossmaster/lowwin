-- New private-key v2 Direct intents have a separate version. Historical
-- Inline/Direct/hosted intents keep their original protocol and evidence.
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_flowVersion_check";
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_flowVersion_check"
 CHECK ("flowVersion" IN (1,2,3,4,5));
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT chapa_v1_version;
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_v1_version CHECK (
 ("flowVersion"=3 AND COALESCE(initialization->>'apiVersion','')='v1' AND "chargeType" IN ('HOSTED','INLINE'))
 OR ("flowVersion" IN (1,2) AND COALESCE(initialization->>'apiVersion','v2')<>'v1' AND "chargeType"<>'INLINE')
 OR ("flowVersion"=4 AND COALESCE(initialization->>'apiVersion','')='v2' AND "chargeType" IN ('HOSTED','INLINE'))
 OR ("flowVersion"=5 AND COALESCE(initialization->>'apiVersion','')='v2' AND "chargeType"='DIRECT')
);
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_current_direct_identity CHECK (
 "flowVersion"<>5 OR (
  COALESCE(initialization->>'flowVersion','')='5'
  AND COALESCE(initialization->>'flow','')='DIRECT'
  AND COALESCE(initialization->>'amountCents','')="amountCents"::text
  AND COALESCE(initialization->>'merchantReference','')="merchantReference"
  AND COALESCE(initialization->>'idempotencyKey','')='lowwin-direct-v5:'||id
  AND COALESCE(initialization->>'paymentMethod','')="paymentMethod"
  AND COALESCE(initialization->>'payerPhoneHash','') ~ '^[a-f0-9]{64}$'
  AND COALESCE(initialization->'metadata'->>'checkout_id','')=id
  AND COALESCE(initialization->>'webhookSignatureProfile','') IN ('raw_body','legacy_secret')
  AND "payerPhoneCipher" IS NOT NULL AND "paymentMethod" IS NOT NULL
  AND "reconcileUntil" IS NOT NULL AND "checkoutUrl" IS NULL
 )
);
CREATE OR REPLACE FUNCTION protect_chapa_inline_v2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (OLD."flowVersion"=4 AND OLD."chargeType"='INLINE' OR OLD."flowVersion"=5 AND OLD."chargeType"='DIRECT') AND (
  NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
  OR OLD."authorizationReference" IS NOT NULL AND NEW."authorizationReference" IS DISTINCT FROM OLD."authorizationReference"
  OR OLD."authType" IS NOT NULL AND NEW."authType" IS DISTINCT FROM OLD."authType"
  OR OLD."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId"
 ) THEN RAISE EXCEPTION 'Payment intent and accepted authorization are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE INDEX "ChapaCheckout_current_direct_reconcile_idx" ON "ChapaCheckout"("nextCheckAt")
 WHERE "flowVersion"=5 AND "creditJournalId" IS NULL;

-- Direct top-ups use the same policy snapshot and principal-before-bonus proof.
-- Only the accepted checkout version changes; quote limits/timing stay intact.
CREATE OR REPLACE FUNCTION guard_deposit_bonus_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q jsonb; p "DepositBonusPolicy"%ROWTYPE; expected bigint;quoted timestamp(3);
BEGIN
 q:=NEW.initialization->'depositBonus';IF q IS NULL OR q='null'::jsonb THEN RETURN NEW;END IF;
 quoted:=(q->>'quotedAt')::timestamptz AT TIME ZONE 'UTC';
 SELECT * INTO p FROM "DepositBonusPolicy" WHERE id='default' FOR SHARE;
 expected:=LEAST(NEW."amountCents"*p.percent/100,COALESCE(p."maxBonusCents",NEW."amountCents"));
 IF NEW.purpose<>'TOP_UP' OR NEW."flowVersion" NOT IN (4,5) OR p.id IS NULL OR NOT p.enabled OR NEW."amountCents"<p."minCents"
  OR quoted IS NULL OR quoted<date_trunc('milliseconds',transaction_timestamp() AT TIME ZONE 'UTC') OR quoted>clock_timestamp() AT TIME ZONE 'UTC'
  OR quoted<(clock_timestamp() AT TIME ZONE 'UTC')-interval '30 seconds' OR p."endsAt" IS NOT NULL AND p."endsAt"<=quoted
  OR (q->>'policyVersion')::integer IS DISTINCT FROM p.version OR (q->>'percent')::integer IS DISTINCT FROM p.percent
  OR (q->>'minAmountCents')::bigint IS DISTINCT FROM p."minCents" OR (q->>'maxBonusCents')::bigint IS DISTINCT FROM p."maxBonusCents"
  OR (q->>'validityDays')::integer IS DISTINCT FROM p."validityDays" OR (q->>'endsAt')::timestamp IS DISTINCT FROM p."endsAt"
  OR (q->>'amountCents')::bigint IS DISTINCT FROM expected OR expected<=0 OR q->>'quotedAt' IS NULL
 THEN RAISE EXCEPTION 'Deposit bonus quote does not match the active policy';END IF;
 RETURN NEW;
END $$;
