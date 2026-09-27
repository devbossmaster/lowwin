BEGIN;

ALTER TABLE "Auction" ADD COLUMN "isSettlementFixture" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "closeAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextCloseAttemptAt" TIMESTAMP(3), ADD COLUMN "closeErrorCode" TEXT;
ALTER TABLE "Auction" ADD CONSTRAINT settlement_fixture_demo CHECK (NOT "isSettlementFixture" OR "isDemo");

CREATE TABLE "AuctionSettlement" (
  id TEXT PRIMARY KEY,
  "auctionId" TEXT NOT NULL UNIQUE REFERENCES "Auction"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  outcome TEXT NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "termsVersion" INTEGER NOT NULL,
  cutoff TIMESTAMP(6) NOT NULL,
  "completedAt" TIMESTAMP(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  "acceptedCount" INTEGER NOT NULL,
  "winnerUserId" TEXT REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "winningBidId" TEXT UNIQUE REFERENCES "Bid"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "winningPoints" BIGINT,
  "actorId" TEXT, reason TEXT, key TEXT, "requestHash" TEXT,
  proof JSONB NOT NULL,
  CONSTRAINT "AuctionSettlement_actorId_key_key" UNIQUE ("actorId", key),
  CONSTRAINT settlement_outcome CHECK (
    (outcome='WINNER' AND "winnerUserId" IS NOT NULL AND "winningBidId" IS NOT NULL AND "winningPoints" IS NOT NULL AND "winningPoints">0)
    OR (outcome IN ('NO_WINNER','CANCELLED') AND "winnerUserId" IS NULL AND "winningBidId" IS NULL AND "winningPoints" IS NULL)
  ),
  CONSTRAINT settlement_cancel_actor CHECK (
    (outcome='CANCELLED' AND "actorId" IS NOT NULL AND reason IS NOT NULL AND key IS NOT NULL AND "requestHash" IS NOT NULL AND length("actorId")>0 AND length(reason)>0 AND length(key)>0 AND length("requestHash")>0)
    OR (outcome<>'CANCELLED' AND "actorId" IS NULL AND reason IS NULL AND key IS NULL AND "requestHash" IS NULL)
  ),
  CONSTRAINT settlement_count CHECK ("acceptedCount">=0 AND "termsVersion">=1)
);

CREATE TABLE "SettlementMovement" (
  id TEXT PRIMARY KEY,
  "settlementId" TEXT NOT NULL REFERENCES "AuctionSettlement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "walletId" TEXT NOT NULL REFERENCES "Wallet"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "holdBefore" BIGINT NOT NULL,
  "chargedPoints" BIGINT NOT NULL,
  "releasedPoints" BIGINT NOT NULL,
  "refundedFees" BIGINT NOT NULL,
  "chargeOperationId" TEXT UNIQUE REFERENCES "Operation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "releaseOperationId" TEXT UNIQUE REFERENCES "Operation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "refundOperationId" TEXT UNIQUE REFERENCES "Operation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SettlementMovement_settlementId_userId_key" UNIQUE ("settlementId","userId"),
  CONSTRAINT settlement_movement_points CHECK (
    "holdBefore">=0 AND "chargedPoints">=0 AND "releasedPoints">=0 AND "refundedFees">=0
    AND "holdBefore"="chargedPoints"+"releasedPoints"
    AND ("chargedPoints">0)=("chargeOperationId" IS NOT NULL)
    AND ("releasedPoints">0)=("releaseOperationId" IS NOT NULL)
    AND ("refundedFees">0)=("refundOperationId" IS NOT NULL)
  )
);
ALTER TABLE "Outbox" ADD COLUMN "settlementId" TEXT REFERENCES "AuctionSettlement"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION protect_published_auction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND (
    NEW.id<>OLD.id OR NEW.code<>OLD.code OR NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
    OR NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
    OR NEW."isDemo"<>OLD."isDemo" OR NEW."isSettlementFixture"<>OLD."isSettlementFixture"
    OR NEW."fulfillmentSummary" IS DISTINCT FROM OLD."fulfillmentSummary"
    OR NEW."fulfillmentRegion" IS DISTINCT FROM OLD."fulfillmentRegion"
  ) THEN RAISE EXCEPTION 'Published auction schedule and identity are immutable'; END IF;
  IF OLD.status IN ('CLOSED','CANCELLED') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'Terminal auction cannot reopen or change outcome';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_published_auction BEFORE UPDATE ON "Auction" FOR EACH ROW EXECUTE FUNCTION protect_published_auction();

CREATE FUNCTION guard_settlement_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE; t "AuctionTerms"%ROWTYPE; chosen "Bid"%ROWTYPE; actual_count integer;
BEGIN
  SELECT * INTO a FROM "Auction" WHERE id=NEW."auctionId" FOR UPDATE;
  NEW."completedAt" := clock_timestamp() AT TIME ZONE 'UTC';
  IF a."publishedAt" IS NULL OR a."publishedAt">NEW."completedAt" OR EXISTS (SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId"=a.id) THEN
    RAISE EXCEPTION 'Unpublished or illustrative result cannot be settled';
  END IF;
  SELECT * INTO t FROM "AuctionTerms" WHERE "auctionId"=a.id;
  IF NOT FOUND OR NEW."ruleVersion"<>t."ruleVersion" OR NEW."termsVersion"<>t.version OR NEW.cutoff<>a."endsAt" THEN
    RAISE EXCEPTION 'Settlement must use frozen terms and deadline';
  END IF;
  SELECT COUNT(*) INTO actual_count FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff;
  IF NEW."acceptedCount"<>actual_count OR actual_count<>a."acceptedBidCount" THEN RAISE EXCEPTION 'Settlement accepted count mismatch'; END IF;
  IF NEW.outcome='CANCELLED' THEN
    IF a.status<>'CANCELLED' THEN RAISE EXCEPTION 'Cancellation requires cancelled auction'; END IF;
  ELSE
    IF a.status<>'CLOSED' OR NEW."completedAt"<a."endsAt" THEN RAISE EXCEPTION 'Auction is not due for settlement'; END IF;
    SELECT b.* INTO chosen FROM "Bid" b WHERE b."auctionId"=a.id AND b."acceptedAt"<NEW.cutoff
      AND b.amount=(SELECT amount FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff
        GROUP BY amount HAVING COUNT(*)=1 ORDER BY amount ASC LIMIT 1);
    IF (chosen.id IS NULL AND NEW.outcome<>'NO_WINNER') OR (chosen.id IS NOT NULL AND (
      NEW.outcome<>'WINNER' OR NEW."winningBidId" IS DISTINCT FROM chosen.id
      OR NEW."winnerUserId" IS DISTINCT FROM chosen."userId" OR NEW."winningPoints" IS DISTINCT FROM chosen.amount))
    THEN RAISE EXCEPTION 'Settlement does not match lowest unique decision'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER settlement_acceptance BEFORE INSERT ON "AuctionSettlement" FOR EACH ROW EXECUTE FUNCTION guard_settlement_insert();

CREATE FUNCTION check_terminal_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_id text; a "Auction"%ROWTYPE; s "AuctionSettlement"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='Auction' THEN auction_id:=NEW.id;
  ELSIF TG_TABLE_NAME='SettlementMovement' THEN SELECT "auctionId" INTO auction_id FROM "AuctionSettlement" WHERE id=NEW."settlementId";
  ELSE auction_id:=NEW."auctionId"; END IF;
  SELECT * INTO a FROM "Auction" WHERE id=auction_id;
  SELECT * INTO s FROM "AuctionSettlement" WHERE "auctionId"=auction_id;
  IF s.id IS NOT NULL THEN
    IF a.status<>(CASE WHEN s.outcome='CANCELLED' THEN 'CANCELLED' ELSE 'CLOSED' END)
      OR EXISTS (SELECT 1 FROM "AuctionHold" WHERE "auctionId"=auction_id AND points<>0)
    THEN RAISE EXCEPTION 'Settled auction must be terminal with zero holds'; END IF;
    IF (SELECT COALESCE(SUM("chargedPoints"),0) FROM "SettlementMovement" WHERE "settlementId"=s.id)<>COALESCE(s."winningPoints",0)
    THEN RAISE EXCEPTION 'Settlement charge total mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM "Bid" b WHERE b."auctionId"=auction_id AND NOT EXISTS (
      SELECT 1 FROM "SettlementMovement" m WHERE m."settlementId"=s.id AND m."userId"=b."userId"))
    THEN RAISE EXCEPTION 'Settlement must include every participant'; END IF;
    IF EXISTS (SELECT 1 FROM "SettlementMovement" m JOIN "Wallet" w ON w.id=m."walletId" WHERE m."settlementId"=s.id AND (
      w."userId"<>m."userId" OR (m."chargedPoints">0 AND m."userId" IS DISTINCT FROM s."winnerUserId")
      OR m."refundedFees"<>(CASE WHEN s.outcome='CANCELLED' THEN (SELECT COALESCE(SUM(b."feePoints"),0) FROM "Bid" b WHERE b."auctionId"=auction_id AND b."userId"=m."userId") ELSE 0 END)))
    THEN RAISE EXCEPTION 'Settlement participant or fee refund mismatch'; END IF;
  ELSIF a.status IN ('CLOSED','CANCELLED') AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId"=auction_id) THEN
    RAISE EXCEPTION 'Terminal transition requires atomic settlement';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER settlement_complete AFTER INSERT ON "AuctionSettlement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_terminal_settlement();
CREATE CONSTRAINT TRIGGER settlement_movement_complete AFTER INSERT ON "SettlementMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_terminal_settlement();
CREATE CONSTRAINT TRIGGER auction_terminal_complete AFTER UPDATE OF status ON "Auction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_terminal_settlement();
CREATE CONSTRAINT TRIGGER settled_hold_zero AFTER INSERT OR UPDATE ON "AuctionHold" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_terminal_settlement();

DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['AuctionSettlement','SettlementMovement'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',item);
    EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change()',item);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
  END LOOP;
END $$;
CREATE FUNCTION protect_settlement_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."settlementId" IS NOT NULL AND (TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.key<>OLD.key OR NEW.kind<>OLD.kind
    OR NEW.payload<>OLD.payload OR NEW."createdAt"<>OLD."createdAt" OR NEW."settlementId" IS DISTINCT FROM OLD."settlementId")
  THEN RAISE EXCEPTION 'Settlement notification intent is immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_settlement_outbox BEFORE UPDATE OR DELETE ON "Outbox" FOR EACH ROW EXECUTE FUNCTION protect_settlement_outbox();
CREATE TRIGGER forbid_outbox_truncate BEFORE TRUNCATE ON "Outbox" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
COMMIT;
