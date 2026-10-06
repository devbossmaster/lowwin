-- One-time correction after the 2026-10-06 relist made four auctions LIVE.
-- Run the whole file once in the production Supabase SQL Editor.
-- The new opening is exactly five hours after this transaction captures time.
-- Abort without changes if a bid, hold, settlement, or auction detail changed.
BEGIN;
SET LOCAL search_path = public, pg_temp;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE "Auction", "Bid", "AuctionHold", "AuctionSettlement",
  "SettlementMovement", "AuctionControlRevision" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF (clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa')::date <> DATE '2026-10-06'
     OR (SELECT count(*) FROM "Auction") <> 4
     OR (SELECT count(*) FROM "Auction" WHERE
       ("publicCode"=1 AND code='LW-4300B65D-227') OR
       ("publicCode"=2 AND code='LW-82326704-F19') OR
       ("publicCode"=3 AND code='LW-C3F0778E-A4E') OR
       ("publicCode"=4 AND code='LW-28677DFD-55B')) <> 4
     OR EXISTS (SELECT 1 FROM "Auction" WHERE status<>'LIVE'
       OR "startsAt"<>TIMESTAMP '2026-10-06 07:00:00'
       OR "endsAt"<>TIMESTAMP '2026-10-27 15:00:00'
       OR "publishedAt" IS NULL OR "acceptedBidCount"<>0
       OR "bidSequence"<>0 OR "controlVersion"<>0)
     OR (SELECT count(*) FROM "Bid")<>0
     OR (SELECT count(*) FROM "AuctionHold")<>0
     OR (SELECT count(*) FROM "AuctionSettlement")<>0
     OR (SELECT count(*) FROM "SettlementMovement")<>0
     OR (SELECT count(*) FROM "AuctionControlRevision")<>0
  THEN RAISE EXCEPTION 'Auction changed or has bids; start correction was not applied'; END IF;
END $$;

CREATE TEMP TABLE _corrected_opening ON COMMIT DROP AS
SELECT ((clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '5 hours')::timestamp(3)
  AS "startsAtUtc";
CREATE TEMP TABLE _previous_starts ON COMMIT DROP AS
SELECT id,code,"publicCode","startsAt" FROM "Auction";

-- The published-start guard has no normal admin override. Disable this one
-- named trigger only while the four no-bid rows are corrected. Table locks
-- prevent a concurrent bid or admin change during the transaction.
-- Auction has a deferred settlement trigger; run its check at statement end
-- so PostgreSQL can re-enable the published-start guard in this transaction.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "Auction" DISABLE TRIGGER protect_published_auction;
UPDATE "Auction" SET "startsAt"=(SELECT "startsAtUtc" FROM _corrected_opening),
  status='SCHEDULED'
WHERE id IN (SELECT id FROM _previous_starts);
ALTER TABLE "Auction" ENABLE TRIGGER protect_published_auction;

-- Keep an immutable record of the exceptional published-start correction.
INSERT INTO "AdminAudit" (id,"actorId",action,target,details,"operationKey","createdAt")
SELECT gen_random_uuid()::text,'system:sql-editor','AUCTION_START_CORRECTION',p.code,
  jsonb_build_object(
    'reason','Correct accidental live opening after relist; no bids or holds',
    'publicCode',p."publicCode",
    'oldStartsAtUtc',p."startsAt",
    'newStartsAtUtc',n."startsAtUtc"
  ),
  'auction-start-correction:2026-10-06:'||p.code,
  clock_timestamp() AT TIME ZONE 'UTC'
FROM _previous_starts p CROSS JOIN _corrected_opening n;

DO $$
BEGIN
  IF (SELECT count(*) FROM "Auction" WHERE status='SCHEDULED'
      AND "startsAt"=(SELECT "startsAtUtc" FROM _corrected_opening)
      AND "startsAt">clock_timestamp() AT TIME ZONE 'UTC'
      AND "endsAt"=TIMESTAMP '2026-10-27 15:00:00') <> 4 THEN
    RAISE EXCEPTION 'Auction status or opening time did not match; rolled back';
  END IF;
  IF (SELECT count(*) FROM "Bid")<>0 OR (SELECT count(*) FROM "AuctionHold")<>0 THEN
    RAISE EXCEPTION 'Bid or hold appeared during correction; rolled back';
  END IF;
END $$;

COMMIT;

SELECT "publicCode",code,status,"startsAt" AS "startsAtUtc",
  "startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa' AS "startsAtEAT",
  "endsAt" AS "endsAtUtc"
FROM "Auction" ORDER BY "publicCode";
