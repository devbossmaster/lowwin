-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "acceptedAt" TIMESTAMP(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
    "termsVersion" INTEGER NOT NULL,
    "feePoints" BIGINT NOT NULL,
    "operationId" TEXT NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bid_operationId_key" ON "Bid"("operationId");

-- CreateIndex
CREATE INDEX "Bid_userId_auctionId_acceptedAt_idx" ON "Bid"("userId", "auctionId", "acceptedAt");

-- CreateIndex
CREATE INDEX "Bid_auctionId_amount_idx" ON "Bid"("auctionId", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_userId_auctionId_amount_key" ON "Bid"("userId", "auctionId", "amount");

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- The old catalog check incorrectly capped the auction-wide count at 100.
-- The rule is 100 distinct amounts per USER and auction, guarded below.
ALTER TABLE "Auction" DROP CONSTRAINT auction_bid_count_check;
ALTER TABLE "Auction" ADD CONSTRAINT auction_bid_count_check CHECK ("acceptedBidCount" >= 0);
ALTER TABLE "Bid" ADD CONSTRAINT bid_value_check CHECK (amount > 0 AND "termsVersion" >= 1 AND "feePoints" >= 0);

CREATE FUNCTION guard_bid_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_row "Auction"%ROWTYPE; frozen_terms "AuctionTerms"%ROWTYPE; existing_count integer;
BEGIN
  -- A direct writer must obey the same auction-first serialization as the app.
  SELECT * INTO auction_row FROM "Auction" WHERE id = NEW."auctionId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Auction not found' USING ERRCODE = '23503'; END IF;
  -- Stamp after any auction-lock wait. Client and app timestamps are ignored.
  NEW."acceptedAt" := clock_timestamp() AT TIME ZONE 'UTC';
  IF auction_row.status NOT IN ('SCHEDULED','LIVE') OR auction_row."publishedAt" IS NULL
     OR auction_row."publishedAt" > NEW."acceptedAt"
     OR auction_row."startsAt" IS NULL OR auction_row."endsAt" IS NULL
     OR NOT (auction_row."startsAt" <= NEW."acceptedAt" AND NEW."acceptedAt" < auction_row."endsAt")
  THEN RAISE EXCEPTION 'Auction is not open for bids' USING ERRCODE = '23514'; END IF;
  SELECT * INTO frozen_terms FROM "AuctionTerms" WHERE "auctionId" = NEW."auctionId";
  IF NOT FOUND OR NEW."termsVersion" <> frozen_terms.version OR NEW."feePoints" <> frozen_terms."entryFeePoints"
     OR NEW.amount < frozen_terms."minPoints" OR NEW.amount > frozen_terms."maxPoints"
     OR (NEW.amount - frozen_terms."minPoints") % frozen_terms."stepPoints" <> 0
  THEN RAISE EXCEPTION 'Bid does not match published terms' USING ERRCODE = '23514'; END IF;
  SELECT COUNT(*) INTO existing_count FROM "Bid" WHERE "auctionId" = NEW."auctionId" AND "userId" = NEW."userId";
  IF existing_count >= frozen_terms."maxDistinctBids" THEN
    RAISE EXCEPTION 'Distinct bid limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bid_acceptance_guard BEFORE INSERT ON "Bid" FOR EACH ROW EXECUTE FUNCTION guard_bid_acceptance();
CREATE TRIGGER immutable_bid BEFORE UPDATE OR DELETE ON "Bid" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER forbid_bid_truncate BEFORE TRUNCATE ON "Bid" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION check_auction_bid_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_id text; recorded integer; actual integer;
BEGIN
  IF TG_TABLE_NAME = 'Bid' THEN auction_id := NEW."auctionId"; ELSE auction_id := NEW.id; END IF;
  SELECT "acceptedBidCount" INTO recorded FROM "Auction" WHERE id = auction_id;
  SELECT COUNT(*) INTO actual FROM "Bid" WHERE "auctionId" = auction_id;
  IF recorded <> actual THEN RAISE EXCEPTION 'Auction bid count must equal accepted bids' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER bid_count_on_insert AFTER INSERT ON "Bid"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auction_bid_count();
CREATE CONSTRAINT TRIGGER bid_count_on_auction AFTER UPDATE OF "acceptedBidCount" ON "Auction"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_auction_bid_count();

ALTER TABLE "Bid" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "Bid" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "Bid" FROM authenticated; END IF;
END $$;
