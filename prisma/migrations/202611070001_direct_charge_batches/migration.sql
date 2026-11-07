-- Additive direct-charge intents and immutable server-priced batch orders.
-- Existing hosted payments, references, ledger rows and terms are untouched.
CREATE TABLE "BidBatchOrder" (
 id text PRIMARY KEY,
 "userId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 key text NOT NULL,
 "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
 "quoteHash" text NOT NULL CHECK ("quoteHash" ~ '^[a-f0-9]{64}$'),
 "auctionId" text NOT NULL REFERENCES "Auction"(id) ON DELETE RESTRICT,
 "auctionSlug" text NOT NULL,
 "ruleVersion" text NOT NULL,
 "feeVersion" integer NOT NULL CHECK ("feeVersion">=1),
 lines jsonb NOT NULL CHECK (jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 100),
 "totalCents" bigint NOT NULL CHECK ("totalCents" BETWEEN 0 AND 4320000),
 "grossCents" bigint NOT NULL CHECK ("grossCents" BETWEEN 0 AND 4320000),
 "discountCents" bigint NOT NULL CHECK ("discountCents">=0 AND "discountCents"<="grossCents"),
 "couponId" text REFERENCES "ReferralCoupon"(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'QUOTED' CHECK (status IN ('QUOTED','ACCEPTED')),
 receipt jsonb,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL,
 UNIQUE ("userId",key),
 CHECK ("totalCents"="grossCents"-"discountCents"),
 CHECK ((status='ACCEPTED')=(receipt IS NOT NULL))
);
CREATE INDEX "BidBatchOrder_userId_createdAt_idx" ON "BidBatchOrder"("userId","createdAt");
CREATE FUNCTION protect_bid_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line jsonb; item jsonb; i integer:=0; gross numeric:=0; discount numeric:=0; coupons integer:=0; child_hash text; child_key text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Batch payment audit records cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW."userId",NEW.key,NEW."requestHash",NEW."quoteHash",NEW."auctionId",NEW."auctionSlug",NEW."ruleVersion",NEW."feeVersion",NEW.lines,NEW."totalCents",NEW."grossCents",NEW."discountCents",NEW."couponId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."userId",OLD.key,OLD."requestHash",OLD."quoteHash",OLD."auctionId",OLD."auctionSlug",OLD."ruleVersion",OLD."feeVersion",OLD.lines,OLD."totalCents",OLD."grossCents",OLD."discountCents",OLD."couponId",OLD."createdAt") OR OLD.status='ACCEPTED' AND (NEW.status,NEW.receipt) IS DISTINCT FROM (OLD.status,OLD.receipt)) THEN RAISE EXCEPTION 'Batch quote and accepted outcome are immutable'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) LOOP
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR NOT (line ?& ARRAY['position','number','grossFee','discount','netFee']) OR jsonb_typeof(line->'position') IS DISTINCT FROM 'number' OR jsonb_typeof(line->'number') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'grossFee') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'discount') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'netFee') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Incomplete batch allocation'; END IF;
  IF (line->>'position')::integer<>i OR (line->>'number')!~'^[0-9]+\.[0-9]{2}$' OR (line->>'number')::numeric<1 OR (line->>'grossFee')!~'^[0-9]+\.[0-9]{2}$' OR (line->>'discount')!~'^[0-9]+\.[0-9]{2}$' OR (line->>'netFee')!~'^[0-9]+\.[0-9]{2}$' OR (line->>'netFee')::numeric<>(line->>'grossFee')::numeric-(line->>'discount')::numeric THEN RAISE EXCEPTION 'Invalid batch allocation'; END IF;
  gross:=gross+(line->>'grossFee')::numeric*100; discount:=discount+(line->>'discount')::numeric*100;
  IF line ? 'couponId' THEN coupons:=coupons+1; IF i<>0 OR line->>'couponId' IS DISTINCT FROM NEW."couponId" THEN RAISE EXCEPTION 'Invalid coupon allocation'; END IF; END IF;
  IF NEW.status='ACCEPTED' THEN
   item:=NEW.receipt->'receipts'->i;
   child_hash:=encode(sha256(convert_to('lowwin:batch:'||NEW.id||':'||i::text,'UTF8')),'hex');
   child_key:=substr(child_hash,1,8)||'-'||substr(child_hash,9,4)||'-4'||substr(child_hash,14,3)||'-a'||substr(child_hash,18,3)||'-'||substr(child_hash,21,12);
   IF NOT EXISTS(SELECT 1 FROM "Bid" b JOIN "Operation" o ON o.id=b."operationId" WHERE b.id=item->'bid'->>'id' AND b."userId"=NEW."userId" AND b."auctionId"=NEW."auctionId" AND b.amount=(line->>'number')::numeric AND b."feePoints"=(line->>'grossFee')::numeric AND b."termsVersion"=NEW."feeVersion" AND o.scope='BID' AND o."userId"=NEW."userId" AND o.key=child_key AND o.result=item) THEN RAISE EXCEPTION 'Batch acceptance requires every committed child receipt'; END IF;
  END IF;
  i:=i+1;
 END LOOP;
 IF gross<>NEW."grossCents" OR discount<>NEW."discountCents" OR coupons>1 OR (NEW."couponId" IS NOT NULL AND coupons<>1) THEN RAISE EXCEPTION 'Batch total does not match allocations'; END IF;
 IF (SELECT count(DISTINCT (value->>'number')::numeric) FROM jsonb_array_elements(NEW.lines))<>i THEN RAISE EXCEPTION 'Duplicate batch amounts'; END IF;
 IF NEW.status='ACCEPTED' AND (jsonb_array_length(NEW.receipt->'receipts') IS DISTINCT FROM i OR NEW.receipt->>'batchId' IS DISTINCT FROM NEW.id) THEN RAISE EXCEPTION 'Incomplete batch acceptance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bid_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON "BidBatchOrder" FOR EACH ROW EXECUTE FUNCTION protect_bid_batch();
ALTER TABLE "ChapaCheckout" ADD COLUMN "chargeType" text NOT NULL DEFAULT 'HOSTED' CHECK ("chargeType" IN ('HOSTED','DIRECT')),
 ADD COLUMN "batchId" text UNIQUE REFERENCES "BidBatchOrder"(id) ON DELETE RESTRICT,
 ADD COLUMN "authType" text CHECK ("authType" IN ('USSD','OTP')),
 ADD COLUMN "authorizationReference" text,
 ADD COLUMN "providerRequestId" text,
 ADD COLUMN "payerPhoneCipher" text,
 ADD COLUMN "validationAttempts" integer NOT NULL DEFAULT 0 CHECK ("validationAttempts">=0),
 ADD COLUMN "reconcileUntil" timestamp(3),
 ADD CONSTRAINT chapa_direct_fields CHECK ("chargeType"<>'DIRECT' OR "payerPhoneCipher" IS NOT NULL AND "paymentMethod" IS NOT NULL AND "reconcileUntil" IS NOT NULL AND "checkoutUrl" IS NULL),
 ADD CONSTRAINT chapa_batch_purpose CHECK ("batchId" IS NULL OR purpose='BID');
CREATE INDEX "ChapaCheckout_direct_reconcile_idx" ON "ChapaCheckout"("nextCheckAt") WHERE "chargeType"='DIRECT' AND "creditJournalId" IS NULL;
CREATE FUNCTION protect_chapa_direct() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."batchId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "BidBatchOrder" b WHERE b.id=NEW."batchId" AND b."userId"=NEW."userId" AND b."auctionId"=NEW."auctionId" AND b."auctionSlug"=NEW."auctionSlug" AND b."feeVersion"=NEW."feeVersion" AND b."totalCents"=NEW."amountCents" AND b."grossCents"=NEW."grossFee"*100 AND b."discountCents"=NEW."discountPoints"*100 AND b."couponId" IS NOT DISTINCT FROM NEW."couponId" AND b.status='QUOTED') THEN RAISE EXCEPTION 'Payment must bind its immutable batch quote'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW."chargeType",NEW."batchId",NEW."payerPhoneCipher",NEW."reconcileUntil") IS DISTINCT FROM (OLD."chargeType",OLD."batchId",OLD."payerPhoneCipher",OLD."reconcileUntil") OR
 OLD."chargeType"='DIRECT' AND (NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod" OR OLD."authorizationReference" IS NOT NULL AND NEW."authorizationReference" IS DISTINCT FROM OLD."authorizationReference" OR OLD."authType" IS NOT NULL AND NEW."authType" IS DISTINCT FROM OLD."authType" OR OLD."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId") THEN RAISE EXCEPTION 'Direct-charge intent and authorization are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chapa_direct_guard BEFORE INSERT OR UPDATE ON "ChapaCheckout" FOR EACH ROW EXECUTE FUNCTION protect_chapa_direct();
ALTER TABLE "BidBatchOrder" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BidBatchOrder" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BidBatchOrder" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BidBatchOrder" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN GRANT SELECT,INSERT,UPDATE ON "BidBatchOrder" TO lowwin_runtime; CREATE POLICY batch_runtime ON "BidBatchOrder" TO lowwin_runtime USING (true) WITH CHECK (true); END IF;
END $$;
