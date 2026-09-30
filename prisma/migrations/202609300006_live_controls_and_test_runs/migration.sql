BEGIN;

ALTER TABLE "Product" ADD COLUMN "testRunId" text;
ALTER TABLE "Auction" ADD COLUMN "testRunId" text;
ALTER TABLE "Auction" ADD COLUMN "controlVersion" integer NOT NULL DEFAULT 0;
ALTER TABLE "Auction" ADD COLUMN presentation jsonb;
ALTER TABLE "AuctionTerms" ADD COLUMN "publishedEndsAt" timestamp(3);
ALTER TABLE "AuctionTerms" ADD COLUMN "maxExtensionMinutes" integer NOT NULL DEFAULT 10080;
ALTER TABLE "AuctionTerms" ADD COLUMN "allowPaidShortening" boolean NOT NULL DEFAULT false;
ALTER TABLE "AuctionTerms" ADD COLUMN "shortenNoticeMinutes" integer NOT NULL DEFAULT 1440;
ALTER TABLE "AuctionTerms" DISABLE TRIGGER immutable_auction_terms;
UPDATE "AuctionTerms" t SET "publishedEndsAt"=a."endsAt" FROM "Auction" a WHERE a.id=t."auctionId";
ALTER TABLE "AuctionTerms" ENABLE TRIGGER immutable_auction_terms;
ALTER TABLE "Bid" ADD COLUMN "feeRevisionId" text;
ALTER TABLE "Outbox" ADD COLUMN "testRunId" text;
ALTER TABLE "FulfillmentCase" ADD COLUMN "testRunId" text;
ALTER TABLE "NotificationInbox" ADD COLUMN "testRunId" text;

CREATE TABLE "TestRun" (
  id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'DRAFT',
  label text NOT NULL,
  "actorId" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "finishedAt" timestamp(3),
  "cleanupStartedAt" timestamp(3),
  "cleanedAt" timestamp(3)
);
CREATE TABLE "TestRunActor" (
  "testRunId" text NOT NULL,
  "userId" text NOT NULL,
  label text NOT NULL,
  PRIMARY KEY ("testRunId","userId")
);
CREATE TABLE "AuctionFeeRevision" (
  id text PRIMARY KEY,
  "auctionId" text NOT NULL,
  version integer NOT NULL,
  "feePoints" numeric NOT NULL,
  "effectiveAt" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  "actorId" text,
  reason text NOT NULL,
  "operationKey" text
);
CREATE TABLE "AuctionControlRevision" (
  id text PRIMARY KEY,
  "auctionId" text NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  "actorId" text NOT NULL,
  reason text NOT NULL,
  "operationKey" text NOT NULL,
  "createdAt" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE "TelegramMessage" (
  id text PRIMARY KEY,
  "outboxId" text NOT NULL,
  "auctionId" text,
  "testRunId" text,
  "chatId" text NOT NULL,
  "messageId" bigint NOT NULL,
  "sentAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletionState" text NOT NULL DEFAULT 'DELIVERED',
  "deletionRequestedAt" timestamp(3),
  "deletionAttemptedAt" timestamp(3),
  "deletionError" text
);

CREATE UNIQUE INDEX "AuctionFeeRevision_auctionId_version_key" ON "AuctionFeeRevision"("auctionId",version);
CREATE UNIQUE INDEX "AuctionFeeRevision_operationKey_key" ON "AuctionFeeRevision"("operationKey");
CREATE INDEX "AuctionFeeRevision_auctionId_effectiveAt_idx" ON "AuctionFeeRevision"("auctionId","effectiveAt");
CREATE UNIQUE INDEX "AuctionControlRevision_auctionId_version_key" ON "AuctionControlRevision"("auctionId",version);
CREATE UNIQUE INDEX "AuctionControlRevision_operationKey_key" ON "AuctionControlRevision"("operationKey");
CREATE INDEX "AuctionControlRevision_auctionId_createdAt_idx" ON "AuctionControlRevision"("auctionId","createdAt");
CREATE INDEX "Product_testRunId_idx" ON "Product"("testRunId");
CREATE INDEX "Auction_testRunId_status_idx" ON "Auction"("testRunId",status);
CREATE INDEX "Bid_feeRevisionId_idx" ON "Bid"("feeRevisionId");
CREATE INDEX "Outbox_testRunId_state_idx" ON "Outbox"("testRunId",state);
CREATE INDEX "FulfillmentCase_testRunId_idx" ON "FulfillmentCase"("testRunId");
CREATE INDEX "NotificationInbox_testRunId_idx" ON "NotificationInbox"("testRunId");
CREATE INDEX "TestRun_state_createdAt_idx" ON "TestRun"(state,"createdAt");
CREATE INDEX "TestRunActor_userId_idx" ON "TestRunActor"("userId");
CREATE UNIQUE INDEX "TelegramMessage_outboxId_key" ON "TelegramMessage"("outboxId");
CREATE INDEX "TelegramMessage_auctionId_deletionState_idx" ON "TelegramMessage"("auctionId","deletionState");
CREATE INDEX "TelegramMessage_testRunId_deletionState_idx" ON "TelegramMessage"("testRunId","deletionState");

ALTER TABLE "Product" ADD CONSTRAINT "Product_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_feeRevisionId_fkey" FOREIGN KEY ("feeRevisionId") REFERENCES "AuctionFeeRevision"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FulfillmentCase" ADD CONSTRAINT "FulfillmentCase_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationInbox" ADD CONSTRAINT "NotificationInbox_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestRunActor" ADD CONSTRAINT "TestRunActor_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestRunActor" ADD CONSTRAINT "TestRunActor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuctionFeeRevision" ADD CONSTRAINT "AuctionFeeRevision_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuctionControlRevision" ADD CONSTRAINT "AuctionControlRevision_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelegramMessage" ADD CONSTRAINT "TelegramMessage_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "Outbox"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuctionTerms" ADD CONSTRAINT auction_terms_live_control_check CHECK (
  "maxExtensionMinutes" BETWEEN 0 AND 43200 AND "shortenNoticeMinutes" BETWEEN 5 AND 10080
);
ALTER TABLE "AuctionFeeRevision" ADD CONSTRAINT auction_fee_revision_check CHECK (version >= 1 AND "feePoints" >= 0 AND "feePoints"=trunc("feePoints",2));
ALTER TABLE "AuctionControlRevision" ADD CONSTRAINT auction_control_revision_check CHECK (version >= 1 AND kind IN ('FEE','DEADLINE','PRESENTATION'));
ALTER TABLE "TestRun" ADD CONSTRAINT test_run_state_check CHECK (state IN ('DRAFT','RUNNING','FINISHED','CLEANING','CLEANED','FAILED'));
ALTER TABLE "TelegramMessage" ADD CONSTRAINT telegram_message_delete_state_check CHECK ("deletionState" IN ('DELIVERED','QUEUED','DELETED','UNAVAILABLE','FAILED'));

INSERT INTO "AuctionFeeRevision" (id,"auctionId",version,"feePoints","effectiveAt","actorId",reason)
SELECT gen_random_uuid()::text,t."auctionId",t.version,t."entryFeePoints",COALESCE(a."publishedAt",t."createdAt"),NULL,'Initial published fee'
FROM "AuctionTerms" t JOIN "Auction" a ON a.id=t."auctionId";
UPDATE "Bid" b SET "feeRevisionId"=r.id FROM "AuctionFeeRevision" r
WHERE r."auctionId"=b."auctionId" AND r.version=b."termsVersion" AND r."feePoints"=b."feePoints";

DROP TRIGGER bid_acceptance_guard ON "Bid";
CREATE OR REPLACE FUNCTION guard_bid_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_row "Auction"%ROWTYPE; frozen_terms "AuctionTerms"%ROWTYPE; fee_revision "AuctionFeeRevision"%ROWTYPE; existing_count integer;
BEGIN
  SELECT * INTO auction_row FROM "Auction" WHERE id=NEW."auctionId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Auction not found' USING ERRCODE = '23503'; END IF;
  NEW."acceptedAt" := clock_timestamp() AT TIME ZONE 'UTC';
  IF auction_row.status NOT IN ('SCHEDULED','LIVE') OR auction_row."publishedAt" IS NULL
     OR auction_row."publishedAt" > NEW."acceptedAt" OR auction_row."startsAt" IS NULL OR auction_row."endsAt" IS NULL
     OR NOT (auction_row."startsAt" <= NEW."acceptedAt" AND NEW."acceptedAt" < auction_row."endsAt")
  THEN RAISE EXCEPTION 'Auction is not open for bids' USING ERRCODE = '23514'; END IF;
  SELECT * INTO frozen_terms FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId";
  IF NEW."feeRevisionId" IS NULL THEN
    SELECT * INTO fee_revision FROM "AuctionFeeRevision" WHERE "auctionId"=NEW."auctionId" AND "effectiveAt"<=NEW."acceptedAt" ORDER BY "effectiveAt" DESC,version DESC LIMIT 1;
    NEW."feeRevisionId":=fee_revision.id;
  ELSE
    SELECT * INTO fee_revision FROM "AuctionFeeRevision" WHERE id=NEW."feeRevisionId" AND "auctionId"=NEW."auctionId" AND "effectiveAt"<=NEW."acceptedAt";
  END IF;
  IF NOT FOUND OR NEW."termsVersion"<>fee_revision.version OR NEW."feePoints"<>fee_revision."feePoints"
     OR NEW.amount<frozen_terms."minPoints" OR NEW.amount>frozen_terms."maxPoints"
     OR (NEW.amount-frozen_terms."minPoints") % frozen_terms."stepPoints"<>0
  THEN RAISE EXCEPTION 'Bid does not match current fee revision or published terms' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM "AuctionFeeRevision" newer WHERE newer."auctionId"=NEW."auctionId" AND newer."effectiveAt"<=NEW."acceptedAt"
             AND (newer."effectiveAt">fee_revision."effectiveAt" OR newer."effectiveAt"=fee_revision."effectiveAt" AND newer.version>fee_revision.version))
  THEN RAISE EXCEPTION 'Bid fee quote is stale' USING ERRCODE = '23514'; END IF;
  SELECT COUNT(*) INTO existing_count FROM "Bid" WHERE "auctionId"=NEW."auctionId" AND "userId"=NEW."userId";
  IF existing_count>=frozen_terms."maxDistinctBids" THEN RAISE EXCEPTION 'Distinct bid limit reached' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bid_acceptance_guard BEFORE INSERT ON "Bid" FOR EACH ROW EXECUTE FUNCTION guard_bid_acceptance();

CREATE TRIGGER immutable_auction_fee_revision BEFORE UPDATE OR DELETE ON "AuctionFeeRevision" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER forbid_auction_fee_revision_truncate BEFORE TRUNCATE ON "AuctionFeeRevision" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_auction_control_revision BEFORE UPDATE OR DELETE ON "AuctionControlRevision" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER forbid_auction_control_revision_truncate BEFORE TRUNCATE ON "AuctionControlRevision" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION cleanup_test_run(target text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE auction_ids text[]; actor_ids text[]; product_ids text[]; operation_ids text[];
BEGIN
  SELECT array_agg(id) INTO auction_ids FROM "Auction" WHERE "testRunId"=target;
  SELECT array_agg("userId") INTO actor_ids FROM "TestRunActor" WHERE "testRunId"=target;
  SELECT array_agg(id) INTO product_ids FROM "Product" WHERE "testRunId"=target;
  IF NOT EXISTS(SELECT 1 FROM "TestRun" WHERE id=target AND state IN ('FINISHED','FAILED')) OR auction_ids IS NULL OR actor_ids IS NULL
     OR EXISTS(SELECT 1 FROM unnest(actor_ids) id WHERE id !~ '^demo-showcase-[a-z0-9]{8}-[0-9]+$')
  THEN RAISE EXCEPTION 'Eligible finished test run required'; END IF;
  PERFORM set_config('session_replication_role','replica',true);
  SELECT array_agg(id) INTO operation_ids FROM "Operation" WHERE "userId"=ANY(actor_ids);
  DELETE FROM "NotificationInbox" WHERE "testRunId"=target OR key IN (SELECT key FROM "Outbox" WHERE "testRunId"=target);
  DELETE FROM "TelegramMessage" WHERE "testRunId"=target OR "outboxId" IN (SELECT id FROM "Outbox" WHERE "testRunId"=target);
  DELETE FROM "Outbox" WHERE "testRunId"=target OR payload->>'auctionId'=ANY(auction_ids);
  DELETE FROM "FulfillmentCase" WHERE "testRunId"=target OR "auctionId"=ANY(auction_ids);
  DELETE FROM "SettlementMovement" WHERE "settlementId" IN (SELECT id FROM "AuctionSettlement" WHERE "auctionId"=ANY(auction_ids));
  DELETE FROM "AuctionSettlement" WHERE "auctionId"=ANY(auction_ids);
  DELETE FROM "PublicAuctionResult" WHERE "auctionId"=ANY(auction_ids);
  DELETE FROM "AuctionFavorite" WHERE "auctionId"=ANY(auction_ids) OR "userId"=ANY(actor_ids);
  DELETE FROM "Bid" WHERE "auctionId"=ANY(auction_ids) OR "userId"=ANY(actor_ids);
  DELETE FROM "AuctionHold" WHERE "auctionId"=ANY(auction_ids) OR "walletId" IN (SELECT id FROM "Wallet" WHERE "userId"=ANY(actor_ids));
  DELETE FROM "AuctionControlRevision" WHERE "auctionId"=ANY(auction_ids);
  DELETE FROM "AuctionFeeRevision" WHERE "auctionId"=ANY(auction_ids);
  DELETE FROM "AuctionTerms" WHERE "auctionId"=ANY(auction_ids);
  DELETE FROM "AuctionDraft" WHERE "auctionId"=ANY(auction_ids);
  DELETE FROM "Auction" WHERE id=ANY(auction_ids);
  DELETE FROM "Posting" WHERE "journalId" IN (SELECT id FROM "Journal" WHERE "operationId"=ANY(operation_ids));
  DELETE FROM "Journal" WHERE "operationId"=ANY(operation_ids);
  DELETE FROM "Operation" WHERE id=ANY(operation_ids);
  DELETE FROM "WalletHoldGuard" WHERE "walletId" IN (SELECT id FROM "Wallet" WHERE "userId"=ANY(actor_ids));
  DELETE FROM "LedgerAccount" WHERE "walletId" IN (SELECT id FROM "Wallet" WHERE "userId"=ANY(actor_ids));
  DELETE FROM "Wallet" WHERE "userId"=ANY(actor_ids);
  DELETE FROM "NotificationPreference" WHERE "userId"=ANY(actor_ids);
  DELETE FROM "UserRestriction" WHERE "userId"=ANY(actor_ids);
  DELETE FROM "PlayerProfile" WHERE "userId"=ANY(actor_ids);
  DELETE FROM "TestRunActor" WHERE "testRunId"=target;
  DELETE FROM "user" WHERE id=ANY(actor_ids);
  DELETE FROM "ProductImage" WHERE "productId"=ANY(product_ids);
  DELETE FROM "Product" WHERE "testRunId"=target;
  DELETE FROM "TestRun" WHERE id=target;
  UPDATE "LedgerAccount" a SET balance=COALESCE((SELECT SUM(p.delta) FROM "Posting" p WHERE p."accountId"=a.id),0);
END $$;
REVOKE ALL ON FUNCTION cleanup_test_run(text) FROM PUBLIC;

DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['AuctionFeeRevision','AuctionControlRevision','TestRun','TestRunActor','TelegramMessage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',item);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
    GRANT SELECT,INSERT ON "AuctionFeeRevision","AuctionControlRevision" TO lowwin_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON "TestRun","TestRunActor","TelegramMessage" TO lowwin_runtime;
    CREATE POLICY lowwin_server_access ON "AuctionFeeRevision" TO lowwin_runtime USING (true) WITH CHECK (true);
    CREATE POLICY lowwin_server_access ON "AuctionControlRevision" TO lowwin_runtime USING (true) WITH CHECK (true);
    CREATE POLICY lowwin_server_access ON "TestRun" TO lowwin_runtime USING (true) WITH CHECK (true);
    CREATE POLICY lowwin_server_access ON "TestRunActor" TO lowwin_runtime USING (true) WITH CHECK (true);
    CREATE POLICY lowwin_server_access ON "TelegramMessage" TO lowwin_runtime USING (true) WITH CHECK (true);
    GRANT EXECUTE ON FUNCTION cleanup_test_run(text) TO lowwin_runtime;
  END IF;
END $$;

COMMIT;
