BEGIN;
SET LOCAL lock_timeout = '10s';
-- V4: bid numbers never represent wallet funds. Historical V1-V3 policies stay frozen.
ALTER TABLE "AuctionTerms" DROP CONSTRAINT auction_terms_range_check;
ALTER TABLE "AuctionTerms" ADD CONSTRAINT auction_terms_range_check CHECK (
 version>=1 AND "minPoints">=1
 AND ("maxPoints" IS NOT NULL OR "ruleVersion" IN ('lowest-unique-v3','lowest-unique-v4'))
 AND ("maxPoints" IS NULL OR ("maxPoints">="minPoints" AND ("maxPoints"-"minPoints") % "stepPoints"=0))
 AND "stepPoints">=CASE WHEN "ruleVersion" IN ('lowest-unique-v3','lowest-unique-v4') THEN 0.01 ELSE 1 END
 AND "entryFeePoints">=0 AND "maxDistinctBids"=100
 AND ("ruleVersion"<>'lowest-unique-v4' OR "maxPoints" IS NULL)
);
CREATE OR REPLACE FUNCTION guard_new_rule_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM "Auction" WHERE id=NEW."auctionId" FOR UPDATE;
 IF NEW."ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4') THEN
  IF NEW."minParticipants"<>2 OR a."publishedAt" IS NOT NULL OR EXISTS(SELECT 1 FROM "Bid" WHERE "auctionId"=a.id) THEN
   RAISE EXCEPTION 'V2 requires two participants and must be frozen before publication';
  END IF;
 ELSIF NEW."ruleVersion"<>'lowest-unique-v1' OR NEW."minParticipants"<>0 THEN
  RAISE EXCEPTION 'Unsupported frozen rule';
 END IF;
 IF NEW."ruleVersion" IN ('lowest-unique-v3','lowest-unique-v4') THEN
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
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId" AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4')) THEN
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
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=aid AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4')) THEN
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
  IF t."ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4') THEN
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
    IF NOT (NEW.proof @> jsonb_build_object('ruleVersion',t."ruleVersion",'termsVersion',t.version,'minParticipants',2,'participantCount',participants,'acceptanceCutoff',a."bidSequence"::text,'acceptedCount',actual_count,'outcome',NEW.outcome,'decision',choice,'settlementId',NEW.id,'cutoff',to_char(NEW.cutoff,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'feePolicy',CASE WHEN t."ruleVersion"='lowest-unique-v4' THEN 'NON_REFUNDABLE_SUBMISSION_FEES' WHEN NEW.outcome='CANCELLED' THEN 'REFUND_ALL_ENTRY_FEES' ELSE 'KEEP_DISCLOSED_ENTRY_FEES' END))
      OR NEW.proof->'amountFrequencies' IS DISTINCT FROM distribution
      OR NEW.proof->'winner' IS DISTINCT FROM (CASE WHEN chosen.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('userId',chosen."userId",'bidId',chosen.id,'amount',trim_scale(chosen.amount)::text,'acceptanceOrder',chosen."acceptanceOrder"::text) END)
    THEN RAISE EXCEPTION 'V2 immutable proof does not match database facts'; END IF;
    IF t."ruleVersion"='lowest-unique-v3' AND NEW.proof->'amountPolicy' IS DISTINCT FROM
      '{"currency":"ETB","minimum":"1","step":"0.01","maxDecimalPlaces":2,"maxConsecutive":3}'::jsonb THEN
      RAISE EXCEPTION 'V3 proof requires frozen cent amount policy';
    END IF;
    IF t."ruleVersion"='lowest-unique-v4' AND NEW.proof->'amountPolicy' IS DISTINCT FROM
      '{"currency":"NONE","minimum":"1","step":"0.01","maxDecimalPlaces":2,"maxConsecutive":3}'::jsonb THEN
      RAISE EXCEPTION 'Fee-only proof must identify a number, not money';
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

CREATE OR REPLACE FUNCTION check_v2_settlement_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AuctionSettlement"%ROWTYPE; movement_record "SettlementMovement"%ROWTYPE; refs jsonb; actual_refs jsonb;
BEGIN
 IF TG_TABLE_NAME='AuctionSettlement' THEN SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW.id;
 ELSE SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW."settlementId"; END IF;
 IF s."ruleVersion" NOT IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4') THEN RETURN NULL; END IF;
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

CREATE OR REPLACE FUNCTION guard_cent_bid_pattern() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule text;
BEGIN
 SELECT "ruleVersion" INTO rule FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId";
 IF rule IN ('lowest-unique-v3','lowest-unique-v4') THEN
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

CREATE OR REPLACE FUNCTION check_terminal_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_id text; a "Auction"%ROWTYPE; s "AuctionSettlement"%ROWTYPE; fee_only boolean;
BEGIN
  IF TG_TABLE_NAME='Auction' THEN auction_id:=NEW.id;
  ELSIF TG_TABLE_NAME='SettlementMovement' THEN SELECT "auctionId" INTO auction_id FROM "AuctionSettlement" WHERE id=NEW."settlementId";
  ELSE auction_id:=NEW."auctionId"; END IF;
  SELECT * INTO a FROM "Auction" WHERE id=auction_id;
  SELECT * INTO s FROM "AuctionSettlement" WHERE "auctionId"=auction_id;
  SELECT "ruleVersion"='lowest-unique-v4' INTO fee_only FROM "AuctionTerms" WHERE "auctionId"=auction_id;
  IF s.id IS NOT NULL THEN
    IF a.status<>(CASE WHEN s.outcome='CANCELLED' THEN 'CANCELLED' ELSE 'CLOSED' END)
      OR EXISTS (SELECT 1 FROM "AuctionHold" WHERE "auctionId"=auction_id AND points<>0)
    THEN RAISE EXCEPTION 'Settled auction must be terminal with zero holds'; END IF;
    IF (SELECT COALESCE(SUM("chargedPoints"),0) FROM "SettlementMovement" WHERE "settlementId"=s.id)<>(CASE WHEN fee_only THEN 0 ELSE COALESCE(s."winningPoints",0) END)
    THEN RAISE EXCEPTION 'Settlement charge total mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM "Bid" b WHERE b."auctionId"=auction_id AND NOT EXISTS (
      SELECT 1 FROM "SettlementMovement" m WHERE m."settlementId"=s.id AND m."userId"=b."userId"))
    THEN RAISE EXCEPTION 'Settlement must include every participant'; END IF;
    IF EXISTS (SELECT 1 FROM "SettlementMovement" m JOIN "Wallet" w ON w.id=m."walletId" WHERE m."settlementId"=s.id AND (
      w."userId"<>m."userId" OR (m."chargedPoints">0 AND m."userId" IS DISTINCT FROM s."winnerUserId")
      OR m."refundedFees"<>(CASE WHEN s.outcome='CANCELLED' AND NOT fee_only THEN (SELECT COALESCE(SUM(b."feePoints"),0) FROM "Bid" b WHERE b."auctionId"=auction_id AND b."userId"=m."userId") ELSE 0 END)))
    THEN RAISE EXCEPTION 'Settlement participant or fee refund mismatch'; END IF;
  ELSIF a.status IN ('CLOSED','CANCELLED') AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId"=auction_id) THEN
    RAISE EXCEPTION 'Terminal transition requires atomic settlement';
  END IF;
  RETURN NULL;
END;
$$;
ALTER TABLE "AuctionSettlement" DROP CONSTRAINT settlement_cancel_actor;
ALTER TABLE "AuctionSettlement" ADD CONSTRAINT settlement_cancel_actor CHECK (
 (outcome='CANCELLED' AND "actorId" IS NOT NULL AND reason IS NOT NULL AND key IS NOT NULL AND "requestHash" IS NOT NULL AND length("actorId")>0 AND length(reason)>0 AND length(key)>0 AND length("requestHash")>0)
 OR (outcome='CANCELLED' AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4') AND decision IS NOT NULL AND decision='MINIMUM_PARTICIPANTS' AND reason IS NOT NULL AND reason='MINIMUM_PARTICIPANTS' AND "actorId" IS NULL AND key IS NULL AND "requestHash" IS NULL)
 OR (outcome<>'CANCELLED' AND "actorId" IS NULL AND reason IS NULL AND key IS NULL AND "requestHash" IS NULL)
);
-- Even a direct hold writer must not reserve a chosen number as money.
CREATE FUNCTION guard_fee_only_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.points<>0 AND EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId" AND "ruleVersion"='lowest-unique-v4') THEN
  RAISE EXCEPTION 'Fee-only bids cannot reserve wallet funds';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fee_only_hold_guard BEFORE INSERT OR UPDATE ON "AuctionHold" FOR EACH ROW EXECUTE FUNCTION guard_fee_only_hold();
COMMIT;
