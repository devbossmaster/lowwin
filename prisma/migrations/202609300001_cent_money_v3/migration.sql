BEGIN;

-- Money remains denominated in ETB. Widen storage without rescaling any value,
-- rewriting immutable receipts/proofs, disabling triggers, or changing old rules.
-- Deploy with ALL writers stopped; old clients cannot read fractional NUMERIC.
-- Unconstrained NUMERIC plus checks rejects excess precision (never rounds it).
SET LOCAL lock_timeout = '15s';
LOCK TABLE "LedgerAccount","Posting","AuctionTerms","PublicAuctionResult",
 "AuctionHold","Bid","TopUpIntent","PaymentClaim","AuctionSettlement","SettlementMovement"
 IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "LedgerAccount" ALTER COLUMN "balance" TYPE numeric USING "balance"::numeric;

ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_balance_etb_precision" CHECK
   ("balance" IS NULL OR ("balance" = trunc("balance",2) AND abs("balance") <= 9223372036854775807));

ALTER TABLE "Posting" ALTER COLUMN "delta" TYPE numeric USING "delta"::numeric;

ALTER TABLE "Posting" ADD CONSTRAINT "Posting_delta_etb_precision" CHECK
   ("delta" IS NULL OR ("delta" = trunc("delta",2) AND abs("delta") <= 9223372036854775807));

ALTER TABLE "AuctionTerms" ALTER COLUMN "minPoints" TYPE numeric USING "minPoints"::numeric;

ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_minPoints_etb_precision" CHECK
   ("minPoints" IS NULL OR ("minPoints" = trunc("minPoints",2) AND abs("minPoints") <= 9223372036854775807));

ALTER TABLE "AuctionTerms" ALTER COLUMN "maxPoints" TYPE numeric USING "maxPoints"::numeric;

ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_maxPoints_etb_precision" CHECK
   ("maxPoints" IS NULL OR ("maxPoints" = trunc("maxPoints",2) AND abs("maxPoints") <= 9223372036854775807));

ALTER TABLE "AuctionTerms" ALTER COLUMN "stepPoints" TYPE numeric USING "stepPoints"::numeric;

ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_stepPoints_etb_precision" CHECK
   ("stepPoints" IS NULL OR ("stepPoints" = trunc("stepPoints",2) AND abs("stepPoints") <= 9223372036854775807));

ALTER TABLE "AuctionTerms" ALTER COLUMN "entryFeePoints" TYPE numeric USING "entryFeePoints"::numeric;

ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_entryFeePoints_etb_precision" CHECK
   ("entryFeePoints" IS NULL OR ("entryFeePoints" = trunc("entryFeePoints",2) AND abs("entryFeePoints") <= 9223372036854775807));

ALTER TABLE "PublicAuctionResult" ALTER COLUMN "winningPoints" TYPE numeric USING "winningPoints"::numeric;

ALTER TABLE "PublicAuctionResult" ADD CONSTRAINT "PublicAuctionResult_winningPoints_etb_precision" CHECK
   ("winningPoints" IS NULL OR ("winningPoints" = trunc("winningPoints",2) AND abs("winningPoints") <= 9223372036854775807));

ALTER TABLE "AuctionHold" ALTER COLUMN "points" TYPE numeric USING "points"::numeric;

ALTER TABLE "AuctionHold" ADD CONSTRAINT "AuctionHold_points_etb_precision" CHECK
   ("points" IS NULL OR ("points" = trunc("points",2) AND abs("points") <= 9223372036854775807));

ALTER TABLE "Bid" ALTER COLUMN "amount" TYPE numeric USING "amount"::numeric;

ALTER TABLE "Bid" ADD CONSTRAINT "Bid_amount_etb_precision" CHECK
   ("amount" IS NULL OR ("amount" = trunc("amount",2) AND abs("amount") <= 9223372036854775807));

ALTER TABLE "Bid" ALTER COLUMN "feePoints" TYPE numeric USING "feePoints"::numeric;

ALTER TABLE "Bid" ADD CONSTRAINT "Bid_feePoints_etb_precision" CHECK
   ("feePoints" IS NULL OR ("feePoints" = trunc("feePoints",2) AND abs("feePoints") <= 9223372036854775807));

ALTER TABLE "TopUpIntent" ALTER COLUMN "points" TYPE numeric USING "points"::numeric;

ALTER TABLE "TopUpIntent" ADD CONSTRAINT "TopUpIntent_points_etb_precision" CHECK
   ("points" IS NULL OR ("points" = trunc("points",2) AND abs("points") <= 9223372036854775807));

ALTER TABLE "PaymentClaim" ALTER COLUMN "points" TYPE numeric USING "points"::numeric;

ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_points_etb_precision" CHECK
   ("points" IS NULL OR ("points" = trunc("points",2) AND abs("points") <= 9223372036854775807));

ALTER TABLE "AuctionSettlement" ALTER COLUMN "winningPoints" TYPE numeric USING "winningPoints"::numeric;

ALTER TABLE "AuctionSettlement" ADD CONSTRAINT "AuctionSettlement_winningPoints_etb_precision" CHECK
   ("winningPoints" IS NULL OR ("winningPoints" = trunc("winningPoints",2) AND abs("winningPoints") <= 9223372036854775807));

ALTER TABLE "SettlementMovement" ALTER COLUMN "holdBefore" TYPE numeric USING "holdBefore"::numeric;

ALTER TABLE "SettlementMovement" ADD CONSTRAINT "SettlementMovement_holdBefore_etb_precision" CHECK
   ("holdBefore" IS NULL OR ("holdBefore" = trunc("holdBefore",2) AND abs("holdBefore") <= 9223372036854775807));

ALTER TABLE "SettlementMovement" ALTER COLUMN "chargedPoints" TYPE numeric USING "chargedPoints"::numeric;

ALTER TABLE "SettlementMovement" ADD CONSTRAINT "SettlementMovement_chargedPoints_etb_precision" CHECK
   ("chargedPoints" IS NULL OR ("chargedPoints" = trunc("chargedPoints",2) AND abs("chargedPoints") <= 9223372036854775807));

ALTER TABLE "SettlementMovement" ALTER COLUMN "releasedPoints" TYPE numeric USING "releasedPoints"::numeric;

ALTER TABLE "SettlementMovement" ADD CONSTRAINT "SettlementMovement_releasedPoints_etb_precision" CHECK
   ("releasedPoints" IS NULL OR ("releasedPoints" = trunc("releasedPoints",2) AND abs("releasedPoints") <= 9223372036854775807));

ALTER TABLE "SettlementMovement" ALTER COLUMN "refundedFees" TYPE numeric USING "refundedFees"::numeric;

ALTER TABLE "SettlementMovement" ADD CONSTRAINT "SettlementMovement_refundedFees_etb_precision" CHECK
   ("refundedFees" IS NULL OR ("refundedFees" = trunc("refundedFees",2) AND abs("refundedFees") <= 9223372036854775807));

ALTER TABLE "AuctionTerms" DROP CONSTRAINT auction_terms_range_check;
ALTER TABLE "AuctionTerms" ADD CONSTRAINT auction_terms_range_check CHECK (
 version>=1 AND "minPoints">=1 AND "maxPoints">="minPoints"
 AND "stepPoints">=CASE WHEN "ruleVersion"='lowest-unique-v3' THEN 0.01 ELSE 1 END
 AND ("maxPoints"-"minPoints") % "stepPoints"=0 AND "entryFeePoints">=0
 AND "maxDistinctBids"=100
);

CREATE OR REPLACE FUNCTION guard_new_rule_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM "Auction" WHERE id=NEW."auctionId" FOR UPDATE;
 IF NEW."ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3') THEN
  IF NEW."minParticipants"<>2 OR a."publishedAt" IS NOT NULL OR EXISTS(SELECT 1 FROM "Bid" WHERE "auctionId"=a.id) THEN
   RAISE EXCEPTION 'V2 requires two participants and must be frozen before publication';
  END IF;
 ELSIF NEW."ruleVersion"<>'lowest-unique-v1' OR NEW."minParticipants"<>0 THEN
  RAISE EXCEPTION 'Unsupported frozen rule';
 END IF;
 IF NEW."ruleVersion"='lowest-unique-v3' THEN
  IF NEW."minPoints"<>1 OR NEW."stepPoints"<>0.01 OR NEW."maxDistinctBids"<>100 THEN
   RAISE EXCEPTION 'V3 requires minimum ETB 1.00, cent steps and 100 distinct bids';
  END IF;
 ELSIF NEW."minPoints"<>trunc(NEW."minPoints") OR NEW."maxPoints"<>trunc(NEW."maxPoints")
   OR NEW."stepPoints"<>trunc(NEW."stepPoints") OR NEW."entryFeePoints"<>trunc(NEW."entryFeePoints") THEN
  RAISE EXCEPTION 'Legacy auction terms require whole ETB';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION assign_v2_acceptance_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId" AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3')) THEN
  IF EXISTS(SELECT 1 FROM "StaffMember" WHERE "userId"=NEW."userId") OR EXISTS(SELECT 1 FROM "UserRestriction" WHERE "userId"=NEW."userId" AND suspended) THEN
   RAISE EXCEPTION 'Ineligible participant';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "Auction" WHERE id=NEW."auctionId" AND "isDemo" AND "isSettlementFixture")
     AND NOT EXISTS(SELECT 1 FROM "user" u JOIN "TelegramOwnContact" c ON c."userId"=u.id AND c."telegramId"=u."telegramId" WHERE u.id=NEW."userId" AND c."revokedAt" IS NULL) THEN
   RAISE EXCEPTION 'Verified own contact required for a real v2 participant';
  END IF;
  UPDATE "Auction" SET "bidSequence"="bidSequence"+1 WHERE id=NEW."auctionId" RETURNING "bidSequence" INTO NEW."acceptanceOrder";
 ELSE NEW."acceptanceOrder":=NULL;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_v2_acceptance_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid text; n bigint; maximum bigint; sequence bigint; missing bigint;
BEGIN
 IF TG_TABLE_NAME='Bid' THEN aid:=NEW."auctionId"; ELSE aid:=NEW.id; END IF;
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=aid AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3')) THEN
  SELECT count(*),coalesce(max("acceptanceOrder"),0),count(*) FILTER(WHERE "acceptanceOrder" IS NULL) INTO n,maximum,missing FROM "Bid" WHERE "auctionId"=aid;
  SELECT "bidSequence" INTO sequence FROM "Auction" WHERE id=aid;
  IF missing<>0 OR sequence<>n OR maximum<>n THEN RAISE EXCEPTION 'Acceptance sequence must match immutable accepted bids'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION guard_settlement_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE; t "AuctionTerms"%ROWTYPE; chosen "Bid"%ROWTYPE; actual_count integer; participants integer; choice text; distribution jsonb;
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
  IF t."ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3') THEN
    SELECT count(DISTINCT "userId") INTO participants FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff;
    IF NEW."participantCount" IS DISTINCT FROM participants OR NEW."acceptanceCutoff" IS DISTINCT FROM a."bidSequence" OR a."bidSequence"<>actual_count THEN RAISE EXCEPTION 'V2 participant count or acceptance cutoff mismatch'; END IF;
    IF NEW."actorId" IS NOT NULL THEN
      choice:='OWNER_CANCELLED';
      IF NEW.outcome<>'CANCELLED' OR a.status<>'CANCELLED' THEN RAISE EXCEPTION 'Owner cancellation cannot choose a winner'; END IF;
    ELSIF participants<t."minParticipants" THEN
      choice:='MINIMUM_PARTICIPANTS';
      IF NEW.outcome<>'CANCELLED' OR a.status<>'CANCELLED' OR NEW."completedAt"<NEW.cutoff OR NEW.reason IS DISTINCT FROM 'MINIMUM_PARTICIPANTS' THEN RAISE EXCEPTION 'V2 minimum requires cancellation at deadline'; END IF;
    ELSE
      IF a.status<>'CLOSED' OR NEW."completedAt"<NEW.cutoff THEN RAISE EXCEPTION 'Auction is not due for settlement'; END IF;
      SELECT b.* INTO chosen FROM "Bid" b WHERE b."auctionId"=a.id AND b."acceptedAt"<NEW.cutoff
        AND b.amount=(SELECT amount FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff GROUP BY amount HAVING count(*)=1 ORDER BY amount LIMIT 1);
      choice:='LOWEST_UNIQUE';
      IF chosen.id IS NULL THEN
        choice:='FIRST_ACCEPTED_LOWEST';
        SELECT * INTO chosen FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff ORDER BY amount,"acceptanceOrder" LIMIT 1;
      END IF;
      IF chosen.id IS NULL OR chosen."acceptanceOrder" IS NULL OR NEW.outcome<>'WINNER' OR NEW."winningBidId" IS DISTINCT FROM chosen.id OR NEW."winnerUserId" IS DISTINCT FROM chosen."userId" OR NEW."winningPoints" IS DISTINCT FROM chosen.amount THEN RAISE EXCEPTION 'Settlement does not match frozen v2 decision'; END IF;
    END IF;
    IF NEW.decision IS DISTINCT FROM choice THEN RAISE EXCEPTION 'V2 decision mismatch'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('amount',trim_scale(amount)::text,'count',n) ORDER BY amount),'[]'::jsonb) INTO distribution
      FROM (SELECT amount,count(*) n FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff GROUP BY amount) f;
    IF NOT (NEW.proof @> jsonb_build_object('ruleVersion',t."ruleVersion",'termsVersion',t.version,'minParticipants',2,'participantCount',participants,'acceptanceCutoff',a."bidSequence"::text,'acceptedCount',actual_count,'outcome',NEW.outcome,'decision',choice,'settlementId',NEW.id,'cutoff',to_char(NEW.cutoff,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'feePolicy',CASE WHEN NEW.outcome='CANCELLED' THEN 'REFUND_ALL_ENTRY_FEES' ELSE 'KEEP_DISCLOSED_ENTRY_FEES' END))
      OR NEW.proof->'amountFrequencies' IS DISTINCT FROM distribution
      OR NEW.proof->'winner' IS DISTINCT FROM (CASE WHEN chosen.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('userId',chosen."userId",'bidId',chosen.id,'amount',trim_scale(chosen.amount)::text,'acceptanceOrder',chosen."acceptanceOrder"::text) END)
    THEN RAISE EXCEPTION 'V2 immutable proof does not match database facts'; END IF;
    IF t."ruleVersion"='lowest-unique-v3' AND NEW.proof->'amountPolicy' IS DISTINCT FROM
      '{"currency":"ETB","minimum":"1","step":"0.01","maxDecimalPlaces":2,"maxConsecutive":3}'::jsonb THEN
      RAISE EXCEPTION 'V3 proof requires frozen cent amount policy';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.decision IS NOT NULL OR NEW."participantCount" IS NOT NULL OR NEW."acceptanceCutoff" IS NOT NULL THEN RAISE EXCEPTION 'Legacy settlement cannot adopt v2 metadata'; END IF;
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

DROP FUNCTION assert_v2_settlement_journal(text,text,text,text,text,text,text,bigint);

CREATE OR REPLACE FUNCTION assert_v2_settlement_journal(op text, uid text, aid text, sid text, kind text, debit text, credit text, amount numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE j "Journal"%ROWTYPE; o "Operation"%ROWTYPE;
BEGIN
 IF amount=0 THEN RETURN; END IF;
 SELECT * INTO o FROM "Operation" WHERE id=op;
 SELECT * INTO j FROM "Journal" WHERE "operationId"=op;
 IF o.id IS NULL OR o."userId"<>uid OR j.id IS NULL OR j.kind<>kind
   OR o.scope<>(CASE WHEN kind='HOLD_RELEASE' THEN 'HOLD_ADJUST' ELSE kind END)
   OR o.key<>(CASE WHEN kind='HOLD_RELEASE' THEN 'settlement:'||sid ELSE sid END)
   OR o.result->>'auctionId' IS DISTINCT FROM aid
   OR (SELECT count(*) FROM "Posting" WHERE "journalId"=j.id)<>2
   OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name=debit AND p.delta=-amount)
   OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name=credit AND p.delta=amount)
 THEN RAISE EXCEPTION 'V2 financial journal does not match settlement movement'; END IF;
END $$;

CREATE OR REPLACE FUNCTION check_v2_settlement_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AuctionSettlement"%ROWTYPE; movement_record "SettlementMovement"%ROWTYPE; refs jsonb; actual_refs jsonb;
BEGIN
 IF TG_TABLE_NAME='AuctionSettlement' THEN SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW.id;
 ELSE SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW."settlementId"; END IF;
 IF s."ruleVersion" NOT IN ('lowest-unique-v2','lowest-unique-v3') THEN RETURN NULL; END IF;
 IF jsonb_typeof(s.proof->'references') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'V2 proof requires financial references'; END IF;
 FOR movement_record IN SELECT * FROM "SettlementMovement" WHERE "settlementId"=s.id LOOP
  PERFORM assert_v2_settlement_journal(movement_record."chargeOperationId",movement_record."userId",s."auctionId",s.id,'AUCTION_WIN_CHARGE','user:'||movement_record."userId"||':held','platform:settlement',movement_record."chargedPoints");
  PERFORM assert_v2_settlement_journal(movement_record."releaseOperationId",movement_record."userId",s."auctionId",s.id,'HOLD_RELEASE','user:'||movement_record."userId"||':held','user:'||movement_record."userId"||':available',movement_record."releasedPoints");
  PERFORM assert_v2_settlement_journal(movement_record."refundOperationId",movement_record."userId",s."auctionId",s.id,'AUCTION_FEE_REFUND','platform:fees','user:'||movement_record."userId"||':available',movement_record."refundedFees");
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'userId',m."userId",'walletId',m."walletId",'holdBefore',trim_scale(m."holdBefore")::text,'chargedPoints',trim_scale(m."chargedPoints")::text,'releasedPoints',trim_scale(m."releasedPoints")::text,'refundedFees',trim_scale(m."refundedFees")::text,
  'chargeOperationId',m."chargeOperationId",'releaseOperationId',m."releaseOperationId",'refundOperationId',m."refundOperationId",
  'chargeJournalId',cj.id,'releaseJournalId',lj.id,'refundJournalId',rj.id,
  'feeJournalIds',coalesce((SELECT jsonb_agg(j.id ORDER BY j.id COLLATE "C") FROM "Bid" b JOIN "Journal" j ON j."operationId"=b."operationId" WHERE b."auctionId"=s."auctionId" AND b."userId"=m."userId"),'[]'::jsonb)) ORDER BY m."userId" COLLATE "C"),'[]'::jsonb) INTO refs
 FROM "SettlementMovement" m LEFT JOIN "Journal" cj ON cj."operationId"=m."chargeOperationId" LEFT JOIN "Journal" lj ON lj."operationId"=m."releaseOperationId" LEFT JOIN "Journal" rj ON rj."operationId"=m."refundOperationId" WHERE m."settlementId"=s.id;
 SELECT coalesce(jsonb_agg(value ORDER BY (value->>'userId') COLLATE "C"),'[]'::jsonb) INTO actual_refs FROM jsonb_array_elements(s.proof->'references');
 IF actual_refs IS DISTINCT FROM refs THEN RAISE EXCEPTION 'V2 proof financial references mismatch'; END IF;
 RETURN NULL;
END $$;

ALTER TABLE "AuctionSettlement" DROP CONSTRAINT settlement_cancel_actor;
ALTER TABLE "AuctionSettlement" ADD CONSTRAINT settlement_cancel_actor CHECK (
 (outcome='CANCELLED' AND "actorId" IS NOT NULL AND reason IS NOT NULL AND key IS NOT NULL AND "requestHash" IS NOT NULL AND length("actorId")>0 AND length(reason)>0 AND length(key)>0 AND length("requestHash")>0)
 OR (outcome='CANCELLED' AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3') AND decision IS NOT NULL AND decision='MINIMUM_PARTICIPANTS' AND reason IS NOT NULL AND reason='MINIMUM_PARTICIPANTS' AND "actorId" IS NULL AND key IS NULL AND "requestHash" IS NULL)
 OR (outcome<>'CANCELLED' AND "actorId" IS NULL AND reason IS NULL AND key IS NULL AND "requestHash" IS NULL)
);

-- This trigger runs AFTER bid_acceptance_guard (auction row lock), BEFORE
-- bid_v2_order. Failed submissions consume no sequence, fee, or hold.
CREATE FUNCTION guard_cent_bid_pattern() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule text;
BEGIN
 SELECT "ruleVersion" INTO rule FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId";
 IF rule='lowest-unique-v3' THEN
  IF NEW.amount<1 OR NEW.amount<>trunc(NEW.amount,2) THEN
   RAISE EXCEPTION 'Minimum bid is ETB 1.00 with at most two decimals';
  END IF;
  IF EXISTS (
   SELECT 1 FROM generate_series(0,3) AS start_offset(n)
   WHERE NOT EXISTS (
    SELECT 1 FROM generate_series(0,3) AS member_offset(n)
    WHERE NEW.amount + (member_offset.n-start_offset.n)*0.01 <> NEW.amount
     AND NOT EXISTS (SELECT 1 FROM "Bid" b WHERE b."auctionId"=NEW."auctionId"
      AND b."userId"=NEW."userId" AND b.amount=NEW.amount+(member_offset.n-start_offset.n)*0.01)
   )
  ) THEN RAISE EXCEPTION 'Four consecutive cent amounts are not allowed'; END IF;
 ELSIF NEW.amount<>trunc(NEW.amount) OR NEW."feePoints"<>trunc(NEW."feePoints") THEN
  RAISE EXCEPTION 'Legacy auction bids require whole ETB';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bid_cent_pattern BEFORE INSERT ON "Bid" FOR EACH ROW EXECUTE FUNCTION guard_cent_bid_pattern();
COMMIT;
