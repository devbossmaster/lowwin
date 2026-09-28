BEGIN;
-- Additive: no legacy bid, terms, result, journal or proof is backfilled/reinterpreted.
ALTER TABLE "AuctionTerms" ADD COLUMN "minParticipants" integer NOT NULL DEFAULT 0;
ALTER TABLE "Auction" ADD COLUMN "bidSequence" bigint NOT NULL DEFAULT 0 CHECK ("bidSequence">=0);
ALTER TABLE "Bid" ADD COLUMN "acceptanceOrder" bigint CHECK ("acceptanceOrder">0);
CREATE UNIQUE INDEX "Bid_auctionId_acceptanceOrder_key" ON "Bid"("auctionId","acceptanceOrder");
ALTER TABLE "AuctionSettlement" ADD COLUMN decision text, ADD COLUMN "participantCount" integer, ADD COLUMN "acceptanceCutoff" bigint;

CREATE FUNCTION guard_new_rule_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM "Auction" WHERE id=NEW."auctionId" FOR UPDATE;
 IF NEW."ruleVersion"='lowest-unique-v2' THEN
  IF NEW."minParticipants"<>2 OR a."publishedAt" IS NOT NULL OR EXISTS(SELECT 1 FROM "Bid" WHERE "auctionId"=a.id) THEN
   RAISE EXCEPTION 'V2 requires two participants and must be frozen before publication';
  END IF;
 ELSIF NEW."ruleVersion"<>'lowest-unique-v1' OR NEW."minParticipants"<>0 THEN
  RAISE EXCEPTION 'Unsupported frozen rule';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER new_rule_terms BEFORE INSERT ON "AuctionTerms" FOR EACH ROW EXECUTE FUNCTION guard_new_rule_terms();

-- Runs after bid_acceptance_guard, which locks the auction and stamps the DB clock.
-- Never accept a caller-supplied order. Rollback restores the counter atomically.
CREATE FUNCTION assign_v2_acceptance_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId" AND "ruleVersion"='lowest-unique-v2') THEN
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
CREATE TRIGGER bid_v2_order BEFORE INSERT ON "Bid" FOR EACH ROW EXECUTE FUNCTION assign_v2_acceptance_order();
CREATE FUNCTION check_v2_acceptance_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid text; n bigint; maximum bigint; sequence bigint; missing bigint;
BEGIN
 IF TG_TABLE_NAME='Bid' THEN aid:=NEW."auctionId"; ELSE aid:=NEW.id; END IF;
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=aid AND "ruleVersion"='lowest-unique-v2') THEN
  SELECT count(*),coalesce(max("acceptanceOrder"),0),count(*) FILTER(WHERE "acceptanceOrder" IS NULL) INTO n,maximum,missing FROM "Bid" WHERE "auctionId"=aid;
  SELECT "bidSequence" INTO sequence FROM "Auction" WHERE id=aid;
  IF missing<>0 OR sequence<>n OR maximum<>n THEN RAISE EXCEPTION 'Acceptance sequence must match immutable accepted bids'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER v2_order_bid AFTER INSERT ON "Bid" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v2_acceptance_order();
CREATE CONSTRAINT TRIGGER v2_order_counter AFTER UPDATE OF "bidSequence" ON "Auction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v2_acceptance_order();

ALTER TABLE "AuctionSettlement" DROP CONSTRAINT settlement_cancel_actor;
ALTER TABLE "AuctionSettlement" ADD CONSTRAINT settlement_cancel_actor CHECK (
 (outcome='CANCELLED' AND "actorId" IS NOT NULL AND reason IS NOT NULL AND key IS NOT NULL AND "requestHash" IS NOT NULL AND length("actorId")>0 AND length(reason)>0 AND length(key)>0 AND length("requestHash")>0)
 OR (outcome='CANCELLED' AND "ruleVersion"='lowest-unique-v2' AND decision IS NOT NULL AND decision='MINIMUM_PARTICIPANTS' AND reason IS NOT NULL AND reason='MINIMUM_PARTICIPANTS' AND "actorId" IS NULL AND key IS NULL AND "requestHash" IS NULL)
 OR (outcome<>'CANCELLED' AND "actorId" IS NULL AND reason IS NULL AND key IS NULL AND "requestHash" IS NULL)
);

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
  IF t."ruleVersion"='lowest-unique-v2' THEN
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
    SELECT coalesce(jsonb_agg(jsonb_build_object('amount',amount::text,'count',n) ORDER BY amount),'[]'::jsonb) INTO distribution
      FROM (SELECT amount,count(*) n FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<NEW.cutoff GROUP BY amount) f;
    IF NOT (NEW.proof @> jsonb_build_object('ruleVersion',t."ruleVersion",'termsVersion',t.version,'minParticipants',2,'participantCount',participants,'acceptanceCutoff',a."bidSequence"::text,'acceptedCount',actual_count,'outcome',NEW.outcome,'decision',choice,'settlementId',NEW.id,'cutoff',to_char(NEW.cutoff,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'feePolicy',CASE WHEN NEW.outcome='CANCELLED' THEN 'REFUND_ALL_ENTRY_FEES' ELSE 'KEEP_DISCLOSED_ENTRY_FEES' END))
      OR NEW.proof->'amountFrequencies' IS DISTINCT FROM distribution
      OR NEW.proof->'winner' IS DISTINCT FROM (CASE WHEN chosen.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('userId',chosen."userId",'bidId',chosen.id,'amount',chosen.amount::text,'acceptanceOrder',chosen."acceptanceOrder"::text) END)
    THEN RAISE EXCEPTION 'V2 immutable proof does not match database facts'; END IF;
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

-- Validate financial references at commit, after nested settlement movements exist.
CREATE FUNCTION assert_v2_settlement_journal(op text, uid text, aid text, sid text, kind text, debit text, credit text, amount bigint) RETURNS void LANGUAGE plpgsql AS $$
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
CREATE FUNCTION check_v2_settlement_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AuctionSettlement"%ROWTYPE; movement_record "SettlementMovement"%ROWTYPE; refs jsonb; actual_refs jsonb;
BEGIN
 IF TG_TABLE_NAME='AuctionSettlement' THEN SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW.id;
 ELSE SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW."settlementId"; END IF;
 IF s."ruleVersion"<>'lowest-unique-v2' THEN RETURN NULL; END IF;
 IF jsonb_typeof(s.proof->'references') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'V2 proof requires financial references'; END IF;
 FOR movement_record IN SELECT * FROM "SettlementMovement" WHERE "settlementId"=s.id LOOP
  PERFORM assert_v2_settlement_journal(movement_record."chargeOperationId",movement_record."userId",s."auctionId",s.id,'AUCTION_WIN_CHARGE','user:'||movement_record."userId"||':held','platform:settlement',movement_record."chargedPoints");
  PERFORM assert_v2_settlement_journal(movement_record."releaseOperationId",movement_record."userId",s."auctionId",s.id,'HOLD_RELEASE','user:'||movement_record."userId"||':held','user:'||movement_record."userId"||':available',movement_record."releasedPoints");
  PERFORM assert_v2_settlement_journal(movement_record."refundOperationId",movement_record."userId",s."auctionId",s.id,'AUCTION_FEE_REFUND','platform:fees','user:'||movement_record."userId"||':available',movement_record."refundedFees");
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'userId',m."userId",'walletId',m."walletId",'holdBefore',m."holdBefore"::text,'chargedPoints',m."chargedPoints"::text,'releasedPoints',m."releasedPoints"::text,'refundedFees',m."refundedFees"::text,
  'chargeOperationId',m."chargeOperationId",'releaseOperationId',m."releaseOperationId",'refundOperationId',m."refundOperationId",
  'chargeJournalId',cj.id,'releaseJournalId',lj.id,'refundJournalId',rj.id,
  'feeJournalIds',coalesce((SELECT jsonb_agg(j.id ORDER BY j.id COLLATE "C") FROM "Bid" b JOIN "Journal" j ON j."operationId"=b."operationId" WHERE b."auctionId"=s."auctionId" AND b."userId"=m."userId"),'[]'::jsonb)) ORDER BY m."userId" COLLATE "C"),'[]'::jsonb) INTO refs
 FROM "SettlementMovement" m LEFT JOIN "Journal" cj ON cj."operationId"=m."chargeOperationId" LEFT JOIN "Journal" lj ON lj."operationId"=m."releaseOperationId" LEFT JOIN "Journal" rj ON rj."operationId"=m."refundOperationId" WHERE m."settlementId"=s.id;
 SELECT coalesce(jsonb_agg(value ORDER BY (value->>'userId') COLLATE "C"),'[]'::jsonb) INTO actual_refs FROM jsonb_array_elements(s.proof->'references');
 IF actual_refs IS DISTINCT FROM refs THEN RAISE EXCEPTION 'V2 proof financial references mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER v2_proof_complete AFTER INSERT ON "AuctionSettlement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v2_settlement_proof();
CREATE CONSTRAINT TRIGGER v2_proof_movements AFTER INSERT ON "SettlementMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v2_settlement_proof();
COMMIT;
