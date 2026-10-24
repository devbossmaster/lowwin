-- Additive only. No existing customer, auction, payment or ledger data changes.
CREATE TABLE "ArifPayCheckout" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  "auctionId" TEXT NOT NULL REFERENCES "Auction"(id) ON DELETE RESTRICT,
  "auctionSlug" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "bidNumber" DECIMAL NOT NULL CHECK ("bidNumber">=1),
  "feeVersion" INTEGER NOT NULL CHECK ("feeVersion">=1),
  "fee" DECIMAL NOT NULL CHECK (fee>0 AND fee<=43200 AND fee*100=trunc(fee*100)),
  "currency" TEXT NOT NULL DEFAULT 'ETB' CHECK (currency='ETB'),
  "channel" TEXT NOT NULL CHECK (channel IN ('TELEBIRR','MPESA')),
  "phoneCipher" TEXT NOT NULL,
  "phoneHash" TEXT NOT NULL,
  "nonce" TEXT NOT NULL UNIQUE,
  "sessionId" TEXT UNIQUE,
  "transactionId" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTING' CHECK (status IN ('SUBMITTING','PENDING','BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED')),
  "reason" TEXT,
  "creditJournalId" TEXT UNIQUE REFERENCES "Journal"(id) ON DELETE RESTRICT,
  "bidId" TEXT UNIQUE REFERENCES "Bid"(id) ON DELETE RESTRICT,
  "receipt" JSONB,
  "evidenceHash" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("userId","key"),
  CHECK ("bidId" IS NULL OR (status='BID_ACCEPTED' AND "creditJournalId" IS NOT NULL)),
  CHECK ("creditJournalId" IS NULL OR "transactionId" IS NOT NULL)
);
CREATE INDEX "ArifPayCheckout_status_nextCheckAt_idx" ON "ArifPayCheckout"(status,"nextCheckAt");
CREATE INDEX "ArifPayCheckout_userId_createdAt_idx" ON "ArifPayCheckout"("userId","createdAt");
-- Refreshed clients cannot create a second charge for an unresolved bid intent.
CREATE UNIQUE INDEX arifpay_active_bid_intent ON "ArifPayCheckout"("userId","auctionId","bidNumber") WHERE status NOT IN ('FAILED','CANCELLED','EXPIRED');
CREATE FUNCTION protect_arifpay_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment audit records cannot be deleted'; END IF;
  IF (NEW.id,NEW."userId",NEW."auctionId",NEW."auctionSlug",NEW.key,NEW."requestHash",NEW."bidNumber",NEW."feeVersion",NEW.fee,NEW.currency,NEW.channel,NEW."phoneCipher",NEW."phoneHash",NEW.nonce,NEW."expiresAt",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."userId",OLD."auctionId",OLD."auctionSlug",OLD.key,OLD."requestHash",OLD."bidNumber",OLD."feeVersion",OLD.fee,OLD.currency,OLD.channel,OLD."phoneCipher",OLD."phoneHash",OLD.nonce,OLD."expiresAt",OLD."createdAt") THEN RAISE EXCEPTION 'Checkout intent is immutable'; END IF;
  IF (OLD."sessionId" IS NOT NULL AND NEW."sessionId" IS DISTINCT FROM OLD."sessionId") OR
     (OLD."transactionId" IS NOT NULL AND NEW."transactionId" IS DISTINCT FROM OLD."transactionId") OR
     (OLD."creditJournalId" IS NOT NULL AND NEW."creditJournalId" IS DISTINCT FROM OLD."creditJournalId") OR
     (OLD."bidId" IS NOT NULL AND NEW."bidId" IS DISTINCT FROM OLD."bidId") THEN RAISE EXCEPTION 'Payment evidence is immutable'; END IF;
  IF OLD."creditJournalId" IS NOT NULL AND (NEW.status,NEW.receipt,NEW."evidenceHash") IS DISTINCT FROM (OLD.status,OLD.receipt,OLD."evidenceHash") THEN RAISE EXCEPTION 'Verified payment outcome is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arifpay_checkout_guard BEFORE UPDATE OR DELETE ON "ArifPayCheckout" FOR EACH ROW EXECUTE FUNCTION protect_arifpay_checkout();
ALTER TABLE "ArifPayCheckout" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ArifPayCheckout" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ArifPayCheckout" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON "ArifPayCheckout" TO lowwin_runtime;
  CREATE POLICY lowwin_server_access ON "ArifPayCheckout" TO lowwin_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;
