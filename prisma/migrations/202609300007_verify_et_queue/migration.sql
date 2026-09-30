BEGIN;

ALTER TABLE "TopUpIntent" DROP CONSTRAINT positive_topup;
ALTER TABLE "TopUpIntent" ADD CONSTRAINT positive_topup CHECK (
 points>0 OR ("amountFromReceipt" AND provider IN ('CHECK_ET','VERIFY_ET') AND points=0 AND "expectedCents" IS NULL AND status<>'CREDITED' AND "journalId" IS NULL)
);
ALTER TABLE "TopUpIntent" DROP CONSTRAINT receipt_amount_state;
ALTER TABLE "TopUpIntent" ADD CONSTRAINT receipt_amount_state CHECK (NOT "amountFromReceipt" OR (
 provider IN ('CHECK_ET','VERIFY_ET') AND "quoteSnapshot" IS NOT NULL AND "receivingAccount" IS NOT NULL AND "expiresAt" IS NOT NULL AND
 "quoteSnapshot" ?& ARRAY['minCents','maxCents','earliestTransferAt'] AND
 (("expectedCents" IS NULL AND points=0 AND "journalId" IS NULL AND status<>'CREDITED') OR
 (status='CREDITED' AND "journalId" IS NOT NULL AND "expectedCents">0 AND points="expectedCents"::numeric/100 AND
 "expectedCents">=("quoteSnapshot"->>'minCents')::bigint AND "expectedCents"<=("quoteSnapshot"->>'maxCents')::bigint))
));

CREATE TABLE "VerifyRequest" (
 id text PRIMARY KEY,
 "intentId" text NOT NULL REFERENCES "TopUpIntent"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 key text NOT NULL UNIQUE,
 reference text NOT NULL,
 "requestId" text UNIQUE,
 state text NOT NULL DEFAULT 'SUBMITTING',
 "nextCheckAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 attempts integer NOT NULL DEFAULT 0,
 code text,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" timestamp(3) NOT NULL,
 CONSTRAINT verify_request_state CHECK (state IN ('SUBMITTING','PROCESSING','DONE'))
);
CREATE INDEX "VerifyRequest_state_nextCheckAt_idx" ON "VerifyRequest"(state,"nextCheckAt");
CREATE INDEX "VerifyRequest_intentId_createdAt_idx" ON "VerifyRequest"("intentId","createdAt");
CREATE TABLE "VerifyWebhookEvent" (
 id text PRIMARY KEY,
 "requestId" text NOT NULL,
 event text NOT NULL,
 "payloadHash" text NOT NULL,
 "processingStatus" text,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "processedAt" timestamp(3)
);
CREATE INDEX "VerifyWebhookEvent_requestId_processedAt_idx" ON "VerifyWebhookEvent"("requestId","processedAt");
CREATE TABLE "PaymentTransferAlias" (
 id text PRIMARY KEY,
 channel text NOT NULL,
 alias text NOT NULL,
 "claimId" text NOT NULL REFERENCES "PaymentClaim"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PaymentTransferAlias_channel_alias_key" ON "PaymentTransferAlias"(channel,alias);
CREATE INDEX "PaymentTransferAlias_claimId_idx" ON "PaymentTransferAlias"("claimId");
CREATE FUNCTION guard_transfer_alias() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "PaymentClaim" c WHERE c.id=NEW."claimId" AND c.channel=NEW.channel) OR length(NEW.alias)<8 THEN
  RAISE EXCEPTION 'Transfer alias must belong to its immutable claim';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transfer_alias_guard BEFORE INSERT ON "PaymentTransferAlias" FOR EACH ROW EXECUTE FUNCTION guard_transfer_alias();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "PaymentTransferAlias" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON "PaymentTransferAlias" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['VerifyRequest','VerifyWebhookEvent','PaymentTransferAlias'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON "VerifyRequest","VerifyWebhookEvent" TO lowwin_runtime;
  GRANT SELECT,INSERT ON "PaymentTransferAlias" TO lowwin_runtime;
  CREATE POLICY lowwin_server_access ON "VerifyRequest" TO lowwin_runtime USING (true) WITH CHECK (true);
  CREATE POLICY lowwin_server_access ON "VerifyWebhookEvent" TO lowwin_runtime USING (true) WITH CHECK (true);
  CREATE POLICY lowwin_server_access ON "PaymentTransferAlias" TO lowwin_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;

COMMIT;
