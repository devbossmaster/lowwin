-- One-time production Supabase SQL Editor script for the exact inventory
-- inspected on 2026-10-06. Run the whole file as one transaction.
-- Abort on any changed inventory or financial activity. Keep a database backup.
-- 10:00 Africa/Addis_Ababa = 07:00 UTC. Existing ends stay at 18:00 EAT.
BEGIN;
SET LOCAL search_path = public, pg_temp;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE "Category", "Product", "ProductImage", "Auction", "AuctionTerms",
  "AuctionFeeRevision", "AuctionControlRevision", "AuctionDraft", "AuctionFavorite",
  "Bid", "AuctionHold", "AuctionSettlement", "SettlementMovement",
  "PublicAuctionResult", "FulfillmentCase", "Outbox", "TelegramMessage",
  "NotificationInbox" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF (clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa')::date <> DATE '2026-10-06' THEN
    RAISE EXCEPTION 'This relist is only for 6 October 2026 EAT';
  END IF;
  IF (SELECT count(*) FROM "Auction") <> 4
     OR (SELECT count(*) FROM "Auction" WHERE id IN (
       '3262495b-8b6d-400d-b89f-6c1008d90a0f',
       '86413ef4-9958-4405-b251-9a2caafb3e84',
       '7fa05fe0-5614-4d7a-a633-64fd487e1f23',
       '7a7ac41f-89cb-4216-984c-4b9dbec083e5')) <> 4
     OR (SELECT count(*) FROM "Product") <> 4
     OR (SELECT count(*) FROM "Product" WHERE id IN (
       'ab12e42e-dfd5-40c4-8c38-62dd71f40440',
       'eacb061e-8410-41d4-9767-e4eecd39c099',
       '9f83b1f4-e49c-4345-b7ba-7a57131a936e',
       'fb51d4e2-3270-48b9-8431-3e3bb09a9b3a')) <> 4
     OR (SELECT count(*) FROM "Category") <> 3
     OR (SELECT count(*) FROM "Category" WHERE id IN (
       '7d8879e3-5cd3-4882-90c7-7b938a827e8d',
       'd4520162-3325-432f-be5b-c3a3617e825d',
       'aeb363de-0186-423b-8b31-07dfae79a632')) <> 3
     OR (SELECT count(*) FROM "ProductImage") <> 4
  THEN RAISE EXCEPTION 'Catalog differs from the inspected four-auction inventory'; END IF;

  IF EXISTS (SELECT 1 FROM "Auction" WHERE status NOT IN ('SCHEDULED','LIVE')
      OR "acceptedBidCount"<>0 OR "bidSequence"<>0 OR "testRunId" IS NOT NULL
      OR "isDemo" OR "isSettlementFixture" OR "publishedAt" IS NULL
      OR "endsAt"<>TIMESTAMP '2026-10-27 15:00:00')
     OR EXISTS (SELECT 1 FROM "Product" WHERE "testRunId" IS NOT NULL OR "isDemo")
     OR (SELECT array_agg("publicCode" ORDER BY "publicCode") FROM "Auction")
        IS DISTINCT FROM ARRAY[1,3,4,6]
     OR (SELECT count(*) FROM "Bid")<>0
     OR (SELECT count(*) FROM "AuctionHold")<>0
     OR (SELECT count(*) FROM "AuctionSettlement")<>0
     OR (SELECT count(*) FROM "SettlementMovement")<>0
     OR (SELECT count(*) FROM "PublicAuctionResult")<>0
     OR (SELECT count(*) FROM "FulfillmentCase")<>0
     OR (SELECT count(*) FROM "AuctionControlRevision")<>0
     OR (SELECT count(*) FROM "AuctionTerms")<>4
     OR (SELECT count(*) FROM "AuctionFeeRevision" WHERE version=1)<>4
     OR (SELECT count(*) FROM "AuctionFeeRevision")<>4
     OR EXISTS (SELECT 1 FROM "Auction" a WHERE
       (a.id='3262495b-8b6d-400d-b89f-6c1008d90a0f' AND
        (a."publicCode"<>1 OR a."productId"<>'9f83b1f4-e49c-4345-b7ba-7a57131a936e')) OR
       (a.id='86413ef4-9958-4405-b251-9a2caafb3e84' AND
        (a."publicCode"<>3 OR a."productId"<>'eacb061e-8410-41d4-9767-e4eecd39c099')) OR
       (a.id='7fa05fe0-5614-4d7a-a633-64fd487e1f23' AND
        (a."publicCode"<>4 OR a."productId"<>'fb51d4e2-3270-48b9-8431-3e3bb09a9b3a')) OR
       (a.id='7a7ac41f-89cb-4216-984c-4b9dbec083e5' AND
        (a."publicCode"<>6 OR a."productId"<>'ab12e42e-dfd5-40c4-8c38-62dd71f40440')))
     OR EXISTS (SELECT 1 FROM "Auction" a WHERE NOT EXISTS (
       SELECT 1 FROM "AuctionTerms" t WHERE t."auctionId"=a.id)
       OR NOT EXISTS (SELECT 1 FROM "AuctionFeeRevision" f WHERE f."auctionId"=a.id))
  THEN RAISE EXCEPTION 'Auction activity or frozen terms changed; nothing deleted'; END IF;

  IF to_regclass(pg_get_serial_sequence('"Auction"','publicCode'))
       IS DISTINCT FROM to_regclass('"Auction_publicCode_seq"') THEN
    RAISE EXCEPTION 'Public-code sequence differs from the expected schema';
  END IF;
END $$;

CREATE TEMP TABLE _old_categories ON COMMIT DROP AS SELECT * FROM "Category";
CREATE TEMP TABLE _old_products ON COMMIT DROP AS SELECT * FROM "Product";
CREATE TEMP TABLE _old_images ON COMMIT DROP AS SELECT * FROM "ProductImage";
CREATE TEMP TABLE _old_auctions ON COMMIT DROP AS SELECT * FROM "Auction";
CREATE TEMP TABLE _old_terms ON COMMIT DROP AS SELECT * FROM "AuctionTerms";
CREATE TEMP TABLE _old_fees ON COMMIT DROP AS SELECT * FROM "AuctionFeeRevision";
CREATE TEMP TABLE _old_favorites ON COMMIT DROP AS SELECT * FROM "AuctionFavorite";

CREATE TEMP TABLE _category_ids ON COMMIT DROP AS
  SELECT id AS old_id, gen_random_uuid()::text AS new_id FROM _old_categories;
CREATE TEMP TABLE _product_ids ON COMMIT DROP AS
  SELECT id AS old_id, gen_random_uuid()::text AS new_id FROM _old_products;
CREATE TEMP TABLE _auction_ids ON COMMIT DROP AS
  SELECT id AS old_id, gen_random_uuid()::text AS new_id FROM _old_auctions;

-- Retire old promotions and clear stale in-app links. Keep sent-message
-- records as an audit of what users already received in Telegram.
CREATE TEMP TABLE _old_outbox ON COMMIT DROP AS
  SELECT id, key FROM "Outbox"
  WHERE payload->>'auctionId' IN (
    SELECT old_id FROM _auction_ids
    UNION ALL SELECT 'ed4b49f9-3e7e-4f09-83b0-15cec60d274f' -- former code 2
    UNION ALL SELECT '86e55a9d-1816-4964-ab98-3f93b53f5805' -- former code 5
  );
DELETE FROM "NotificationInbox"
WHERE key IN (SELECT key FROM _old_outbox)
   OR href IN ('/auctions/1','/auctions/2','/auctions/3',
               '/auctions/4','/auctions/5','/auctions/6');
UPDATE "Outbox" SET state='SKIPPED',"lastError"='CATALOG_RELISTED'
WHERE id IN (SELECT id FROM _old_outbox) AND state='PENDING';
ALTER TABLE "AuctionDraft" DISABLE TRIGGER protect_admin_draft;
DELETE FROM "AuctionDraft" WHERE "auctionId" IN (SELECT old_id FROM _auction_ids);
ALTER TABLE "AuctionDraft" ENABLE TRIGGER protect_admin_draft;

-- These append-only rows have no bid or settlement references (checked above).
-- Disable only their named guards, inside this transaction, for this reset.
ALTER TABLE "AuctionTerms" DISABLE TRIGGER immutable_auction_terms;
ALTER TABLE "AuctionFeeRevision" DISABLE TRIGGER immutable_auction_fee_revision;
ALTER TABLE "AuctionControlRevision" DISABLE TRIGGER immutable_auction_control_revision;
DELETE FROM "AuctionControlRevision" WHERE "auctionId" IN (SELECT old_id FROM _auction_ids);
DELETE FROM "AuctionFeeRevision" WHERE "auctionId" IN (SELECT old_id FROM _auction_ids);
DELETE FROM "AuctionTerms" WHERE "auctionId" IN (SELECT old_id FROM _auction_ids);
ALTER TABLE "AuctionTerms" ENABLE TRIGGER immutable_auction_terms;
ALTER TABLE "AuctionFeeRevision" ENABLE TRIGGER immutable_auction_fee_revision;
ALTER TABLE "AuctionControlRevision" ENABLE TRIGGER immutable_auction_control_revision;

DELETE FROM "AuctionFavorite" WHERE "auctionId" IN (SELECT old_id FROM _auction_ids);
DELETE FROM "Auction" WHERE id IN (SELECT old_id FROM _auction_ids);
DELETE FROM "ProductImage" WHERE id IN (SELECT id FROM _old_images);
DELETE FROM "Product" WHERE id IN (SELECT old_id FROM _product_ids);
DELETE FROM "Category" WHERE id IN (SELECT old_id FROM _category_ids);

INSERT INTO "Category" (id,version,slug,name,"nameAm",description,"descriptionAm",
  "sortOrder",visible,"requiresEligibilityReview")
SELECT m.new_id,1,c.slug,c.name,c."nameAm",c.description,c."descriptionAm",
  c."sortOrder",c.visible,c."requiresEligibilityReview"
FROM _old_categories c JOIN _category_ids m ON m.old_id=c.id;

INSERT INTO "Product" (id,version,slug,title,"titleAm",description,"descriptionAm",
  condition,"conditionAm","categoryId",visible,"isDemo","testRunId")
SELECT m.new_id,1,p.slug,p.title,p."titleAm",p.description,p."descriptionAm",
  p.condition,p."conditionAm",c.new_id,p.visible,false,NULL
FROM _old_products p JOIN _product_ids m ON m.old_id=p.id
JOIN _category_ids c ON c.old_id=p."categoryId";

INSERT INTO "ProductImage" (id,"productId",path,alt,"sourceType","sourceCredit","sortOrder")
SELECT gen_random_uuid()::text,m.new_id,i.path,i.alt,i."sourceType",i."sourceCredit",i."sortOrder"
FROM _old_images i JOIN _product_ids m ON m.old_id=i."productId";

-- Publish after inserting frozen terms. The terms trigger requires an
-- unpublished auction at insertion time.
INSERT INTO "Auction" (id,code,"publicCode",slug,"productId","categoryId",status,
  "startsAt","endsAt","publishedAt",featured,"isDemo","testRunId",
  "controlVersion",presentation,"acceptedBidCount","bidSequence","publicViewCount",
  "fulfillmentSummary","fulfillmentSummaryAm","fulfillmentRegion","fulfillmentRegionAm",
  "isSettlementFixture","closeAttempts","nextCloseAttemptAt","closeErrorCode")
SELECT m.new_id,
  'LW-'||upper(substr(replace(m.new_id,'-',''),1,8))||'-'||upper(substr(replace(m.new_id,'-',''),9,3)),
  CASE a."publicCode" WHEN 1 THEN 1 WHEN 6 THEN 2 WHEN 3 THEN 3 WHEN 4 THEN 4 END,
  a.slug,p.new_id,c.new_id,'DRAFT',TIMESTAMP '2026-10-06 07:00:00',a."endsAt",NULL,
  a.featured,false,NULL,0,a.presentation,0,0,0,
  a."fulfillmentSummary",a."fulfillmentSummaryAm",a."fulfillmentRegion",a."fulfillmentRegionAm",
  false,0,NULL,NULL
FROM _old_auctions a JOIN _auction_ids m ON m.old_id=a.id
JOIN _product_ids p ON p.old_id=a."productId"
JOIN _category_ids c ON c.old_id=a."categoryId";

INSERT INTO "AuctionTerms" (id,"auctionId",version,"ruleVersion","minParticipants",
  "minPoints","maxPoints","stepPoints","entryFeePoints","maxDistinctBids",
  "noWinnerTerms","cancellationTerms","fulfillmentSnapshot","publishedEndsAt",
  "maxExtensionMinutes","allowPaidShortening","shortenNoticeMinutes","createdAt")
SELECT gen_random_uuid()::text,m.new_id,t.version,t."ruleVersion",t."minParticipants",
  t."minPoints",t."maxPoints",t."stepPoints",t."entryFeePoints",t."maxDistinctBids",
  t."noWinnerTerms",t."cancellationTerms",t."fulfillmentSnapshot",t."publishedEndsAt",
  t."maxExtensionMinutes",true,1440,clock_timestamp() AT TIME ZONE 'UTC'
FROM _old_terms t JOIN _auction_ids m ON m.old_id=t."auctionId";

INSERT INTO "AuctionFeeRevision" (id,"auctionId",version,"feePoints","effectiveAt",
  "actorId",reason,"operationKey")
SELECT gen_random_uuid()::text,m.new_id,1,f."feePoints",
  clock_timestamp() AT TIME ZONE 'UTC',f."actorId",'Initial fee for relisted auction',NULL
FROM _old_fees f JOIN _auction_ids m ON m.old_id=f."auctionId";

UPDATE "Auction" SET "publishedAt"=clock_timestamp() AT TIME ZONE 'UTC',
  status=CASE WHEN "startsAt"<=clock_timestamp() AT TIME ZONE 'UTC' THEN 'LIVE' ELSE 'SCHEDULED' END
WHERE id IN (SELECT new_id FROM _auction_ids);

-- A saved item remains saved for the same user after its auction is replaced.
INSERT INTO "AuctionFavorite" ("userId","auctionId","createdAt")
SELECT f."userId",m.new_id,f."createdAt"
FROM _old_favorites f JOIN _auction_ids m ON m.old_id=f."auctionId";

-- ALTER SEQUENCE RESTART is transactional; the next admin-created auction is 5.
ALTER SEQUENCE "Auction_publicCode_seq" RESTART WITH 5;

-- Keep the existing admin deadline action usable immediately. The same
-- function is also checked into the normal Prisma migration path.
CREATE OR REPLACE FUNCTION protect_published_auction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL THEN
    IF NEW."endsAt" IS DISTINCT FROM OLD."endsAt" AND NOT (
      OLD.status IN ('LIVE', 'SCHEDULED')
      AND NEW."endsAt" IS NOT NULL
      AND NEW."startsAt" IS NOT NULL
      AND NEW."endsAt" > NEW."startsAt"
      AND NEW."endsAt" >= (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '5 minutes'
      AND EXISTS (
        SELECT 1 FROM "AuctionTerms" t
        WHERE t."auctionId" = OLD.id
          AND NEW."endsAt" <= COALESCE(t."publishedEndsAt", OLD."endsAt")
            + t."maxExtensionMinutes" * INTERVAL '1 minute'
          AND (NEW."endsAt" >= OLD."endsAt" OR OLD."acceptedBidCount" = 0
            OR (t."allowPaidShortening" AND NEW."endsAt" >=
              (clock_timestamp() AT TIME ZONE 'UTC')
                + t."shortenNoticeMinutes" * INTERVAL '1 minute'))
      )
      AND NEW."controlVersion" = OLD."controlVersion" + 1
      AND EXISTS (
        SELECT 1 FROM "AuctionControlRevision" r
        WHERE r."auctionId" = OLD.id
          AND r.version = NEW."controlVersion"
          AND r.kind = 'DEADLINE'
          AND (r."before"->>'endsAt')::timestamptz = (OLD."endsAt" AT TIME ZONE 'UTC')
          AND (r."after"->>'endsAt')::timestamptz = (NEW."endsAt" AT TIME ZONE 'UTC')
      )
    ) THEN
      RAISE EXCEPTION 'Published auction deadline requires a matching control revision';
    END IF;

    IF NEW.slug IS DISTINCT FROM OLD.slug AND NOT (
      OLD.status = 'CANCELLED'
      AND NEW.status = 'CANCELLED'
      AND NEW.slug IS NULL
      AND NEW.featured = false
      AND NEW."controlVersion" = OLD."controlVersion" + 1
      AND EXISTS (
        SELECT 1 FROM "AuctionControlRevision" r
        WHERE r."auctionId" = OLD.id
          AND r.version = NEW."controlVersion"
          AND r.kind = 'PRESENTATION'
          AND r."before"->>'publicSlug' = OLD.slug
          AND r."after"->>'publicSlug' IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'Published auction public page requires a matching control revision';
    END IF;

    IF NEW.id <> OLD.id OR NEW.code <> OLD.code
      OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
      OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
      OR NEW."isDemo" <> OLD."isDemo"
      OR NEW."isSettlementFixture" <> OLD."isSettlementFixture"
      OR NEW."fulfillmentSummary" IS DISTINCT FROM OLD."fulfillmentSummary"
      OR NEW."fulfillmentRegion" IS DISTINCT FROM OLD."fulfillmentRegion"
    THEN
      RAISE EXCEPTION 'Published auction schedule and identity are immutable';
    END IF;
  END IF;

  IF OLD.status IN ('CLOSED', 'CANCELLED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Terminal auction cannot reopen or change outcome';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF (SELECT count(*) FROM "Category")<>3 OR (SELECT count(*) FROM "Product")<>4
    OR (SELECT count(*) FROM "ProductImage")<>4 OR (SELECT count(*) FROM "Auction")<>4
    OR (SELECT count(*) FROM "AuctionFavorite")<>(SELECT count(*) FROM _old_favorites)
    OR (SELECT array_agg("publicCode" ORDER BY "publicCode") FROM "Auction")
       IS DISTINCT FROM ARRAY[1,2,3,4]
    OR EXISTS (SELECT 1 FROM "Auction" a LEFT JOIN "AuctionTerms" t ON t."auctionId"=a.id
      LEFT JOIN "AuctionFeeRevision" f ON f."auctionId"=a.id
      WHERE a."startsAt"<>TIMESTAMP '2026-10-06 07:00:00'
        OR a."endsAt"<>TIMESTAMP '2026-10-27 15:00:00'
        OR a."publishedAt" IS NULL OR t.id IS NULL OR f.id IS NULL
        OR NOT t."allowPaidShortening" OR t."shortenNoticeMinutes"<>1440)
  THEN RAISE EXCEPTION 'Post-relist validation failed; everything rolls back'; END IF;
END $$;

COMMIT;

SELECT a."publicCode",a.code,a.status,a."startsAt" AS "startsAtUtc",
  a."endsAt" AS "endsAtUtc",p.title,c.name AS category,
  t."allowPaidShortening",t."shortenNoticeMinutes",
  (SELECT count(*) FROM "AuctionFavorite" f WHERE f."auctionId"=a.id) AS favorites
FROM "Auction" a JOIN "Product" p ON p.id=a."productId"
JOIN "Category" c ON c.id=a."categoryId"
JOIN "AuctionTerms" t ON t."auctionId"=a.id
ORDER BY a."publicCode";
