BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "Auction" IN EXCLUSIVE MODE;

-- Remove the active v3 ceiling in the audited update below; completed records
-- and existing accepted bid receipts stay unchanged.
ALTER TABLE "AuctionTerms" ALTER COLUMN "maxPoints" DROP NOT NULL;
ALTER TABLE "AuctionTerms" DROP CONSTRAINT auction_terms_range_check;
ALTER TABLE "AuctionTerms" ADD CONSTRAINT auction_terms_range_check CHECK (
  version >= 1 AND "minPoints" >= 1
  AND ("maxPoints" IS NOT NULL OR "ruleVersion" = 'lowest-unique-v3')
  AND ("maxPoints" IS NULL OR
       ("maxPoints" >= "minPoints"
        AND ("maxPoints" - "minPoints") % "stepPoints" = 0))
  AND "stepPoints" >= CASE WHEN "ruleVersion" = 'lowest-unique-v3' THEN 0.01 ELSE 1 END
  AND "entryFeePoints" >= 0 AND "maxDistinctBids" = 100
);

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
     OR NEW.amount<frozen_terms."minPoints"
     OR (frozen_terms."maxPoints" IS NOT NULL AND NEW.amount>frozen_terms."maxPoints")
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

-- Update only unfinished auctions. Bid receipts and prior fee revisions stay
-- immutable; the zero-fee revision applies to bids accepted after this change.
ALTER TABLE "AuctionControlRevision" DROP CONSTRAINT auction_control_revision_check;
ALTER TABLE "AuctionControlRevision" ADD CONSTRAINT auction_control_revision_check
  CHECK (version >= 1 AND kind IN ('FEE','DEADLINE','PRESENTATION','BIDDING_POLICY'));

CREATE TEMP TABLE changed_auction_bidding_policy ON COMMIT DROP AS
SELECT a.id AS "auctionId", a."controlVersion", t."maxPoints", t."ruleVersion",
       r.version AS "feeVersion", r."feePoints"
FROM "Auction" a
JOIN "AuctionTerms" t ON t."auctionId"=a.id
JOIN LATERAL (
  SELECT version,"feePoints" FROM "AuctionFeeRevision"
  WHERE "auctionId"=a.id ORDER BY "effectiveAt" DESC,version DESC LIMIT 1
) r ON true
WHERE a.status IN ('SCHEDULED','LIVE') AND a."publishedAt" IS NOT NULL
  AND a."endsAt">clock_timestamp()
  AND NOT EXISTS (SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
  AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" p WHERE p."auctionId"=a.id)
  AND ((t."ruleVersion"='lowest-unique-v3' AND t."maxPoints" IS NOT NULL) OR r."feePoints">0);

ALTER TABLE "AuctionTerms" DISABLE TRIGGER immutable_auction_terms;
UPDATE "AuctionTerms" t SET "maxPoints"=NULL
FROM changed_auction_bidding_policy c
WHERE t."auctionId"=c."auctionId" AND c."ruleVersion"='lowest-unique-v3';
ALTER TABLE "AuctionTerms" ENABLE TRIGGER immutable_auction_terms;

INSERT INTO "AuctionFeeRevision" (id,"auctionId",version,"feePoints","effectiveAt","actorId",reason,"operationKey")
SELECT gen_random_uuid()::text,c."auctionId",c."feeVersion"+1,0,
       clock_timestamp() AT TIME ZONE 'UTC',NULL,
       'Owner-requested removal of additional bid fee',
       'migration:202610020001:fee:'||c."auctionId"
FROM changed_auction_bidding_policy c WHERE c."feePoints">0;

INSERT INTO "AuctionControlRevision" (id,"auctionId",version,kind,before,after,"actorId",reason,"operationKey")
SELECT gen_random_uuid()::text,c."auctionId",c."controlVersion"+1,'BIDDING_POLICY',
       jsonb_build_object('maxPoints',c."maxPoints",'feePoints',c."feePoints"),
       jsonb_build_object('maxPoints',CASE WHEN c."ruleVersion"='lowest-unique-v3' THEN NULL ELSE c."maxPoints" END,'feePoints',0),
       'system:migration:202610020001','Owner-requested removal of active bid maximum and additional fee',
       'migration:202610020001:policy:'||c."auctionId"
FROM changed_auction_bidding_policy c;

UPDATE "Auction" a SET "controlVersion"=c."controlVersion"+1
FROM changed_auction_bidding_policy c WHERE a.id=c."auctionId";

COMMIT;
