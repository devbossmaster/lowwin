-- Additive Chapa v2 hosted-payment audit storage only. No existing users,
-- financial records, auction terms or provider evidence are modified.
CREATE TABLE "ChapaCheckout" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  "purpose" TEXT NOT NULL CHECK (purpose IN ('TOP_UP','BID')),
  "mode" TEXT NOT NULL CHECK (mode IN ('test','live')),
  "credentialFingerprint" TEXT NOT NULL CHECK ("credentialFingerprint" ~ '^[a-f0-9]{64}$'),
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "initialization" JSONB NOT NULL CHECK (jsonb_typeof(initialization)='object'),
  "phoneCipher" TEXT,
  "phoneBotId" TEXT,
  "merchantReference" TEXT NOT NULL UNIQUE CHECK (length("merchantReference") BETWEEN 1 AND 20),
  "chapaReference" TEXT UNIQUE CHECK ("chapaReference" IS NULL OR length("chapaReference") BETWEEN 1 AND 256),
  "checkoutUrl" TEXT CHECK ("checkoutUrl" IS NULL OR length("checkoutUrl")<=2048 AND "checkoutUrl" ~ '^https://[^[:space:]]+$'),
  "amountCents" BIGINT NOT NULL CHECK ("amountCents" BETWEEN 100 AND 4320000),
  "currency" TEXT NOT NULL DEFAULT 'ETB' CHECK (currency='ETB'),
  "auctionId" TEXT REFERENCES "Auction"(id) ON DELETE RESTRICT,
  "auctionSlug" TEXT,
  "bidNumber" DECIMAL,
  "feeVersion" INTEGER,
  "grossFee" DECIMAL,
  "discountPoints" DECIMAL NOT NULL DEFAULT 0 CHECK ("discountPoints">=0 AND "discountPoints"*100=trunc("discountPoints"*100)),
  "couponId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTING' CHECK (status IN ('SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED','CREDITED','BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED')),
  "reason" TEXT,
  "creditJournalId" TEXT UNIQUE REFERENCES "Journal"(id) ON DELETE RESTRICT,
  "bidId" TEXT UNIQUE REFERENCES "Bid"(id) ON DELETE RESTRICT,
  "receipt" JSONB,
  "evidenceHash" TEXT CHECK ("evidenceHash" IS NULL OR "evidenceHash" ~ '^[a-f0-9]{64}$'),
  "paymentMethod" TEXT CHECK ("paymentMethod" IS NULL OR length("paymentMethod")<=128),
  "processorReference" TEXT CHECK ("processorReference" IS NULL OR length("processorReference")<=256),
  "serviceFeeCents" BIGINT CHECK ("serviceFeeCents" IS NULL OR "serviceFeeCents">=0),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "providerCreatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("userId","key"),
  CONSTRAINT chapa_checkout_contact_binding CHECK (("phoneCipher" IS NULL)=("phoneBotId" IS NULL)),
  CONSTRAINT chapa_checkout_purpose_fields CHECK (
    purpose='TOP_UP' AND "auctionId" IS NULL AND "auctionSlug" IS NULL AND "bidNumber" IS NULL AND "feeVersion" IS NULL AND "grossFee" IS NULL AND "discountPoints"=0 AND "couponId" IS NULL
    OR purpose='BID' AND "auctionId" IS NOT NULL AND "auctionSlug" IS NOT NULL AND "bidNumber" IS NOT NULL AND "bidNumber">=1 AND "bidNumber"<>'NaN'::numeric AND "bidNumber"<>'Infinity'::numeric AND "bidNumber"*100=trunc("bidNumber"*100) AND "feeVersion" IS NOT NULL AND "feeVersion">=1 AND "grossFee" IS NOT NULL AND "grossFee">0 AND "grossFee"<=43200 AND "grossFee"*100=trunc("grossFee"*100) AND "discountPoints"<="grossFee" AND "amountCents"=("grossFee"-"discountPoints")*100
  ),
  CONSTRAINT chapa_checkout_credit_evidence CHECK ("creditJournalId" IS NULL OR "chapaReference" IS NOT NULL AND "evidenceHash" IS NOT NULL AND status IN ('CREDITED','BID_ACCEPTED','NEEDS_REVIEW')),
  CONSTRAINT chapa_checkout_bid_outcome CHECK ("bidId" IS NULL OR purpose='BID' AND status='BID_ACCEPTED' AND "creditJournalId" IS NOT NULL),
  CONSTRAINT chapa_checkout_accepted CHECK (status<>'BID_ACCEPTED' OR purpose='BID' AND "bidId" IS NOT NULL AND "creditJournalId" IS NOT NULL),
  CONSTRAINT chapa_checkout_credited CHECK (status<>'CREDITED' OR purpose='TOP_UP' AND "creditJournalId" IS NOT NULL AND "bidId" IS NULL),
  CONSTRAINT chapa_checkout_topup_bid CHECK (purpose<>'TOP_UP' OR "bidId" IS NULL)
);
CREATE INDEX "ChapaCheckout_status_nextCheckAt_idx" ON "ChapaCheckout"(status,"nextCheckAt");
CREATE INDEX "ChapaCheckout_userId_createdAt_idx" ON "ChapaCheckout"("userId","createdAt");
-- Only uncredited attempts can compete for an unresolved charge. A later
-- verified success for an old failed attempt must still be retainable as
-- wallet funds even if a replacement attempt already exists.
CREATE UNIQUE INDEX chapa_active_bid_intent ON "ChapaCheckout"("userId","auctionId","bidNumber") WHERE purpose='BID' AND "creditJournalId" IS NULL AND status NOT IN ('FAILED','CANCELLED','EXPIRED');

CREATE FUNCTION protect_chapa_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Chapa payment audit records cannot be deleted'; END IF;
  IF (NEW.id,NEW."userId",NEW.purpose,NEW.mode,NEW."credentialFingerprint",NEW.key,NEW."requestHash",NEW.initialization,NEW."phoneCipher",NEW."phoneBotId",NEW."merchantReference",NEW."amountCents",NEW.currency,NEW."auctionId",NEW."auctionSlug",NEW."bidNumber",NEW."feeVersion",NEW."grossFee",NEW."discountPoints",NEW."couponId",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."userId",OLD.purpose,OLD.mode,OLD."credentialFingerprint",OLD.key,OLD."requestHash",OLD.initialization,OLD."phoneCipher",OLD."phoneBotId",OLD."merchantReference",OLD."amountCents",OLD.currency,OLD."auctionId",OLD."auctionSlug",OLD."bidNumber",OLD."feeVersion",OLD."grossFee",OLD."discountPoints",OLD."couponId",OLD."createdAt") THEN RAISE EXCEPTION 'Chapa checkout intent is immutable'; END IF;
  IF (OLD."chapaReference" IS NOT NULL AND NEW."chapaReference" IS DISTINCT FROM OLD."chapaReference") OR
     (OLD."checkoutUrl" IS NOT NULL AND NEW."checkoutUrl" IS DISTINCT FROM OLD."checkoutUrl") OR
     (OLD."creditJournalId" IS NOT NULL AND NEW."creditJournalId" IS DISTINCT FROM OLD."creditJournalId") OR
     (OLD."bidId" IS NOT NULL AND NEW."bidId" IS DISTINCT FROM OLD."bidId") THEN RAISE EXCEPTION 'Chapa payment evidence is immutable'; END IF;
  IF OLD."checkoutUrl" IS NOT NULL AND (NEW."expiresAt",NEW."providerCreatedAt") IS DISTINCT FROM (OLD."expiresAt",OLD."providerCreatedAt") THEN RAISE EXCEPTION 'Chapa checkout validity is immutable'; END IF;
  IF OLD."creditJournalId" IS NOT NULL AND (NEW.status,NEW.reason,NEW.receipt,NEW."evidenceHash",NEW."expiresAt",NEW."providerCreatedAt",NEW."paymentMethod",NEW."processorReference",NEW."serviceFeeCents") IS DISTINCT FROM (OLD.status,OLD.reason,OLD.receipt,OLD."evidenceHash",OLD."expiresAt",OLD."providerCreatedAt",OLD."paymentMethod",OLD."processorReference",OLD."serviceFeeCents") THEN RAISE EXCEPTION 'Verified Chapa outcome is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapa_checkout_guard BEFORE UPDATE OR DELETE ON "ChapaCheckout" FOR EACH ROW EXECUTE FUNCTION protect_chapa_checkout();

CREATE TABLE "ChapaWebhookEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "mode" TEXT NOT NULL CHECK (mode IN ('test','live')),
  "configurationFingerprint" TEXT NOT NULL CHECK ("configurationFingerprint" ~ '^[a-f0-9]{64}$'),
  "bodyHash" TEXT NOT NULL CHECK ("bodyHash" ~ '^[a-f0-9]{64}$'),
  "merchantReference" TEXT CHECK ("merchantReference" IS NULL OR length("merchantReference") BETWEEN 1 AND 20),
  "chapaReference" TEXT CHECK ("chapaReference" IS NULL OR length("chapaReference") BETWEEN 1 AND 256),
  "event" TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 80),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mode,"configurationFingerprint","bodyHash")
);
CREATE INDEX "ChapaWebhookEvent_merchantReference_receivedAt_idx" ON "ChapaWebhookEvent"("merchantReference","receivedAt");
CREATE FUNCTION protect_chapa_webhook_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Authenticated Chapa delivery records are immutable';
END $$;
CREATE TRIGGER chapa_webhook_event_guard BEFORE UPDATE OR DELETE ON "ChapaWebhookEvent" FOR EACH ROW EXECUTE FUNCTION protect_chapa_webhook_event();

ALTER TABLE "ChapaCheckout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChapaWebhookEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ChapaCheckout","ChapaWebhookEvent" FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON "ChapaCheckout","ChapaWebhookEvent" FROM %I',browser_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
    REVOKE ALL ON "ChapaCheckout","ChapaWebhookEvent" FROM lowwin_runtime;
    GRANT SELECT,INSERT,UPDATE ON "ChapaCheckout" TO lowwin_runtime;
    GRANT SELECT,INSERT ON "ChapaWebhookEvent" TO lowwin_runtime;
    CREATE POLICY lowwin_server_access ON "ChapaCheckout" TO lowwin_runtime USING (true) WITH CHECK (true);
    CREATE POLICY lowwin_server_access ON "ChapaWebhookEvent" TO lowwin_runtime USING (true) WITH CHECK (true);
  END IF;
END $$;
