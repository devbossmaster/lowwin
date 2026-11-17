BEGIN;
SET LOCAL lock_timeout='10s';
LOCK TABLE "Auction" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "AuctionTerms" ALTER COLUMN "ruleVersion" SET DEFAULT 'lowest-unique-v5',ALTER COLUMN "minParticipants" SET DEFAULT 2;
-- V5 is additive. Old receipts, completed results and all ledger postings stay immutable.
CREATE TABLE "AuctionPolicyTransition" (
 id text PRIMARY KEY,"auctionId" text NOT NULL UNIQUE REFERENCES "Auction"(id),
 before jsonb NOT NULL,after jsonb NOT NULL,"actorId" text NOT NULL,reason text NOT NULL,
 "operationKey" text NOT NULL UNIQUE,"createdAt" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE TABLE "AuctionRefund" (
 id text PRIMARY KEY,"settlementId" text NOT NULL REFERENCES "AuctionSettlement"(id),"userId" text NOT NULL REFERENCES "user"(id),
 "cashPoints" numeric NOT NULL CHECK("cashPoints">=0),"bonusPoints" numeric NOT NULL CHECK("bonusPoints">=0),"holdPoints" numeric NOT NULL CHECK("holdPoints">=0),
 status text NOT NULL CHECK(status IN ('PENDING','COMPLETED')),
 "operationId" text UNIQUE REFERENCES "Operation"(id),"releaseOperationId" text UNIQUE REFERENCES "Operation"(id),
 "createdAt" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),"completedAt" timestamp(6),
 UNIQUE("settlementId","userId"),CHECK((status='COMPLETED')=("completedAt" IS NOT NULL))
);
CREATE INDEX "AuctionRefund_status_createdAt_idx" ON "AuctionRefund"(status,"createdAt",id);
CREATE TABLE "DepositBonusRefund" (
 id text PRIMARY KEY,"refundId" text NOT NULL REFERENCES "AuctionRefund"(id),"bonusUseId" text NOT NULL UNIQUE REFERENCES "DepositBonusUse"(id),
 "checkoutId" text NOT NULL REFERENCES "DepositBonusLot"("checkoutId"),"userId" text NOT NULL REFERENCES "user"(id),
 "amountCents" bigint NOT NULL CHECK("amountCents">0),"creditedCents" bigint NOT NULL CHECK("creditedCents">=0),"expiredCents" bigint NOT NULL CHECK("expiredCents">=0),
 "createdAt" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),CHECK("amountCents"="creditedCents"+"expiredCents")
);
CREATE INDEX "DepositBonusRefund_checkoutId_idx" ON "DepositBonusRefund"("checkoutId");
-- Refund funding comes from immutable ledger evidence, never today's fee.
CREATE VIEW "AuctionBidFunding" AS SELECT b.id AS "bidId",b."auctionId",b."userId",b."acceptedAt",
 COALESCE((SELECT sum(p.delta) FROM "Journal" j JOIN "Posting" p ON p."journalId"=j.id JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE j."operationId"=b."operationId" AND j.kind='BID_FEE' AND a.name='platform:fees'),0) AS gross,
 COALESCE((SELECT sum(-p.delta) FROM "ReferralRedemption" r JOIN "Journal" j ON j."operationId"=r."operationId" JOIN "Posting" p ON p."journalId"=j.id JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE r."bidId"=b.id AND j.kind='REFERRAL_DISCOUNT' AND a.name='platform:fees'),0) AS discount,
 COALESCE((SELECT sum(u."amountCents")/100 FROM "DepositBonusUse" u WHERE u."bidId"=b.id),0) AS bonus FROM "Bid" b;
REVOKE ALL ON "AuctionBidFunding" FROM PUBLIC;

CREATE FUNCTION validate_v5_settlement(n "AuctionSettlement") RETURNS "AuctionSettlement" LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE;t "AuctionTerms"%ROWTYPE;b "Bid"%ROWTYPE;cnt int;pc int;d text;distribution jsonb;
BEGIN
 SELECT * INTO a FROM "Auction" WHERE id=n."auctionId" FOR UPDATE;
 SELECT * INTO t FROM "AuctionTerms" WHERE "auctionId"=a.id;
 n."completedAt":=clock_timestamp() AT TIME ZONE 'UTC';
 IF t."ruleVersion" IS DISTINCT FROM 'lowest-unique-v5' OR n."termsVersion"<>t.version OR n.cutoff IS DISTINCT FROM a."endsAt" OR a."publishedAt" IS NULL OR a."publishedAt">n."completedAt" OR EXISTS(SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId"=a.id) THEN RAISE EXCEPTION 'V5 settlement requires its frozen current auction';END IF;
 SELECT count(*),count(DISTINCT "userId") INTO cnt,pc FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<n.cutoff;
 IF cnt<>a."acceptedBidCount" OR cnt<>n."acceptedCount" OR pc IS DISTINCT FROM n."participantCount" OR n."acceptanceCutoff" IS DISTINCT FROM a."bidSequence" OR t."minParticipants"<>2 THEN RAISE EXCEPTION 'V5 cutoff/count mismatch';END IF;
 IF n."actorId" IS NOT NULL THEN d:='OWNER_CANCELLED';
 ELSIF n."completedAt"<n.cutoff THEN RAISE EXCEPTION 'V5 cannot decide before cutoff';
 ELSIF pc<2 THEN d:='MINIMUM_PARTICIPANTS';
 ELSE
  SELECT x.* INTO b FROM "Bid" x WHERE x."auctionId"=a.id AND x."acceptedAt"<n.cutoff AND x.amount=(SELECT amount FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<n.cutoff GROUP BY amount HAVING count(*)=1 ORDER BY amount LIMIT 1);
  d:=CASE WHEN b.id IS NULL THEN 'NO_UNIQUE_BID' ELSE 'LOWEST_UNIQUE' END;
 END IF;
 IF n.decision IS DISTINCT FROM d OR n.outcome IS DISTINCT FROM (CASE WHEN d='LOWEST_UNIQUE' THEN 'WINNER' ELSE 'CANCELLED' END) OR a.status IS DISTINCT FROM (CASE WHEN d='LOWEST_UNIQUE' THEN 'CLOSED' ELSE 'CANCELLED' END) THEN RAISE EXCEPTION 'V5 unique-only decision mismatch';END IF;
 IF d='LOWEST_UNIQUE' THEN
  IF n."winningBidId" IS DISTINCT FROM b.id OR n."winnerUserId" IS DISTINCT FROM b."userId" OR n."winningPoints" IS DISTINCT FROM b.amount THEN RAISE EXCEPTION 'V5 winner mismatch';END IF;
  IF n.proof->'winner' IS DISTINCT FROM (jsonb_build_object('userId',b."userId",'bidId',b.id,'amount',trim_scale(b.amount)::text)||CASE WHEN b."acceptanceOrder" IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('acceptanceOrder',b."acceptanceOrder"::text) END) THEN RAISE EXCEPTION 'V5 winner proof mismatch';END IF;
 ELSIF n."winningBidId" IS NOT NULL OR n."winnerUserId" IS NOT NULL OR n."winningPoints" IS NOT NULL OR n.proof->'winner' IS DISTINCT FROM 'null'::jsonb OR (n."actorId" IS NULL AND n.reason IS DISTINCT FROM d) THEN RAISE EXCEPTION 'V5 cancellation cannot invent a winner';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('amount',trim_scale(amount)::text,'count',c) ORDER BY amount),'[]'::jsonb) INTO distribution FROM(SELECT amount,count(*) c FROM "Bid" WHERE "auctionId"=a.id AND "acceptedAt"<n.cutoff GROUP BY amount)q;
 IF n.proof->'amountFrequencies' IS DISTINCT FROM distribution OR NOT(n.proof @> jsonb_build_object('settlementId',n.id,'ruleVersion','lowest-unique-v5','termsVersion',t.version,'outcome',n.outcome,'decision',d,'acceptedCount',cnt,'participantCount',pc,'minParticipants',2,'acceptanceCutoff',a."bidSequence"::text,'cutoff',to_char(n.cutoff,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'feePolicy',CASE WHEN d='LOWEST_UNIQUE' THEN 'KEEP_DISCLOSED_ENTRY_FEES' ELSE 'REFUND_NET_PAID_FEES' END,'refundPolicy','ORIGINAL_FUNDING_V1')) THEN RAISE EXCEPTION 'V5 proof mismatch';END IF;
 IF n.proof->'amountPolicy' IS DISTINCT FROM '{"currency":"NONE","minimum":"1","step":"0.01","maxDecimalPlaces":2,"maxConsecutive":3}'::jsonb OR n.proof->'references' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'V5 proof must retain number-only policy and separate durable refunds';END IF;
 RETURN n;
END $$;

CREATE FUNCTION assert_v5_refund_queue(sid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s "AuctionSettlement"%ROWTYPE;
BEGIN
 SELECT * INTO s FROM "AuctionSettlement" WHERE id=sid;IF s."ruleVersion" IS DISTINCT FROM 'lowest-unique-v5' THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM "SettlementMovement" WHERE "settlementId"=s.id) OR NOT EXISTS(SELECT 1 FROM "Auction" WHERE id=s."auctionId" AND status=CASE WHEN s.outcome='CANCELLED' THEN 'CANCELLED' ELSE 'CLOSED' END) THEN RAISE EXCEPTION 'V5 terminal evidence mismatch';END IF;
 IF EXISTS(SELECT 1 FROM "Bid" b WHERE b."auctionId"=s."auctionId" AND NOT EXISTS(SELECT 1 FROM "AuctionRefund" r WHERE r."settlementId"=sid AND r."userId"=b."userId")) THEN RAISE EXCEPTION 'Every V5 participant requires a durable refund decision';END IF;
 IF EXISTS(SELECT 1 FROM "AuctionHold" ah JOIN "Wallet" w ON w.id=ah."walletId" WHERE ah."auctionId"=s."auctionId" AND ah.points>0 AND NOT EXISTS(SELECT 1 FROM "AuctionRefund" r WHERE r."settlementId"=sid AND r."userId"=w."userId" AND r.status='PENDING' AND r."holdPoints"=ah.points)) THEN RAISE EXCEPTION 'Legacy hold has no pending release';END IF;
 IF EXISTS(WITH funding AS(SELECT "userId",sum(gross-discount-bonus) cash,sum(bonus) bonus FROM "AuctionBidFunding" WHERE "auctionId"=s."auctionId" AND "acceptedAt"<s.cutoff GROUP BY "userId") SELECT 1 FROM "AuctionRefund" r LEFT JOIN funding f ON f."userId"=r."userId" WHERE r."settlementId"=sid AND (r."cashPoints" IS DISTINCT FROM (CASE WHEN s.outcome='CANCELLED' THEN COALESCE(f.cash,0) ELSE 0 END) OR r."bonusPoints" IS DISTINCT FROM (CASE WHEN s.outcome='CANCELLED' THEN COALESCE(f.bonus,0) ELSE 0 END))) THEN RAISE EXCEPTION 'V5 refund must equal original net funding';END IF;
END $$;

CREATE FUNCTION guard_v5_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "AuctionSettlement"%ROWTYPE;j "Journal"%ROWTYPE;o "Operation"%ROWTYPE;cash numeric;bonus numeric;expired numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Refund audit cannot be removed';END IF;
 IF TG_OP='UPDATE' AND (OLD.status='COMPLETED' OR (to_jsonb(NEW)-ARRAY['status','operationId','releaseOperationId','completedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','operationId','releaseOperationId','completedAt'])) THEN RAISE EXCEPTION 'Refund intent is immutable';END IF;
 SELECT * INTO s FROM "AuctionSettlement" WHERE id=NEW."settlementId";
 IF s."ruleVersion" IS DISTINCT FROM 'lowest-unique-v5' THEN RAISE EXCEPTION 'Refund requires V5 committed decision';END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'PENDING' OR NEW."holdPoints" IS DISTINCT FROM COALESCE((SELECT ah.points FROM "AuctionHold" ah JOIN "Wallet" w ON w.id=ah."walletId" WHERE ah."auctionId"=s."auctionId" AND w."userId"=NEW."userId"),0) OR NOT EXISTS(SELECT 1 FROM "Bid" WHERE "auctionId"=s."auctionId" AND "userId"=NEW."userId") AND NEW."holdPoints"=0) THEN RAISE EXCEPTION 'Refund requires frozen participant funding or legacy hold';END IF;
 IF TG_OP='INSERT' THEN
  SELECT COALESCE(sum(f.gross-f.discount-f.bonus),0),COALESCE(sum(f.bonus),0) INTO cash,bonus FROM "AuctionBidFunding" f WHERE f."auctionId"=s."auctionId" AND f."userId"=NEW."userId" AND f."acceptedAt"<s.cutoff;
  IF NEW."cashPoints"<>(CASE WHEN s.outcome='CANCELLED' THEN cash ELSE 0 END) OR NEW."bonusPoints"<>(CASE WHEN s.outcome='CANCELLED' THEN bonus ELSE 0 END) THEN RAISE EXCEPTION 'Refund intent does not match actual funding';END IF;
 END IF;
 IF NEW.status='COMPLETED' THEN
  IF NEW."completedAt">clock_timestamp() AT TIME ZONE 'UTC' OR NEW."completedAt"<NEW."createdAt" THEN RAISE EXCEPTION 'Invalid refund completion clock';END IF;
  IF NEW."cashPoints"+NEW."bonusPoints">0 THEN
   SELECT * INTO o FROM "Operation" WHERE id=NEW."operationId";SELECT * INTO j FROM "Journal" WHERE "operationId"=o.id;
   SELECT COALESCE(sum("creditedCents"),0)/100,COALESCE(sum("expiredCents"),0)/100 INTO bonus,expired FROM "DepositBonusRefund" WHERE "refundId"=NEW.id;
   IF o.scope IS DISTINCT FROM 'AUCTION_FEE_REFUND' OR o."userId" IS DISTINCT FROM NEW."userId" OR o.key IS DISTINCT FROM NEW.id OR j.kind IS DISTINCT FROM 'AUCTION_FEE_REFUND' OR j.reference IS DISTINCT FROM 'auction-refund:'||NEW.id OR j."transactionId"<>txid_current() OR bonus+expired<>NEW."bonusPoints" THEN RAISE EXCEPTION 'Refund ledger evidence missing';END IF;
   IF (SELECT COALESCE(sum(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='platform:fees')<>-NEW."cashPoints"-NEW."bonusPoints"
    OR (SELECT COALESCE(sum(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='user:'||NEW."userId"||':available')<>NEW."cashPoints"
    OR (SELECT COALESCE(sum(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='user:'||NEW."userId"||':bonus')<>bonus
    OR (SELECT COALESCE(sum(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='platform:issuance')<>expired
    OR EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name NOT IN ('platform:fees','platform:issuance','user:'||NEW."userId"||':available','user:'||NEW."userId"||':bonus')) THEN RAISE EXCEPTION 'Refund cannot convert discounts or bonus to cash';END IF;
  ELSIF NEW."operationId" IS NOT NULL THEN RAISE EXCEPTION 'Zero fee cannot create a refund credit';END IF;
  IF NEW."holdPoints">0 AND NOT EXISTS(SELECT 1 FROM "Operation" op JOIN "Journal" jj ON jj."operationId"=op.id WHERE op.id=NEW."releaseOperationId" AND op."userId"=NEW."userId" AND op.scope='HOLD_ADJUST' AND op.result->>'auctionId'=s."auctionId" AND op.result->>'direction'='RELEASE' AND (op.result->>'points')::numeric=NEW."holdPoints" AND jj.kind='HOLD_RELEASE' AND jj."transactionId"=txid_current()) THEN RAISE EXCEPTION 'Legacy hold must release independently';END IF;
 ELSIF NEW."operationId" IS NOT NULL OR NEW."releaseOperationId" IS NOT NULL THEN RAISE EXCEPTION 'Pending refund has no completed ledger effect';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER auction_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuctionRefund" FOR EACH ROW EXECUTE FUNCTION guard_v5_refund();
CREATE FUNCTION guard_bonus_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "DepositBonusUse"%ROWTYPE;l "DepositBonusLot"%ROWTYPE;r "AuctionRefund"%ROWTYPE;s "AuctionSettlement"%ROWTYPE;b "Bid"%ROWTYPE;
BEGIN
 SELECT * INTO u FROM "DepositBonusUse" WHERE id=NEW."bonusUseId";SELECT * INTO l FROM "DepositBonusLot" WHERE "checkoutId"=u."checkoutId";SELECT * INTO r FROM "AuctionRefund" WHERE id=NEW."refundId";SELECT * INTO s FROM "AuctionSettlement" WHERE id=r."settlementId";SELECT * INTO b FROM "Bid" WHERE id=u."bidId";
 IF s.outcome IS DISTINCT FROM 'CANCELLED' OR s."ruleVersion" IS DISTINCT FROM 'lowest-unique-v5' OR b."auctionId" IS DISTINCT FROM s."auctionId" OR u."userId" IS DISTINCT FROM r."userId" OR NEW."userId" IS DISTINCT FROM u."userId" OR NEW."checkoutId" IS DISTINCT FROM u."checkoutId" OR NEW."amountCents" IS DISTINCT FROM u."amountCents" OR NEW."createdAt">clock_timestamp() AT TIME ZONE 'UTC' OR NEW."creditedCents" IS DISTINCT FROM (CASE WHEN l."expiresAt">NEW."createdAt" THEN u."amountCents" ELSE 0 END) THEN RAISE EXCEPTION 'Bonus refund must retain original funding and expiry';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bonus_refund_proof BEFORE INSERT ON "DepositBonusRefund" FOR EACH ROW EXECUTE FUNCTION guard_bonus_refund();
CREATE FUNCTION check_v5_refund_funding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "AuctionRefund"%ROWTYPE;uid text;
BEGIN
 IF TG_TABLE_NAME='DepositBonusRefund' THEN
  SELECT * INTO r FROM "AuctionRefund" WHERE id=NEW."refundId";uid:=NEW."userId";
  IF r.status IS DISTINCT FROM 'COMPLETED' OR r."operationId" IS NULL THEN RAISE EXCEPTION 'Bonus restoration requires committed refund evidence';END IF;
  PERFORM assert_deposit_bonus_wallet(uid);
 ELSIF NEW.kind='AUCTION_FEE_REFUND' AND NEW.reference LIKE 'auction-refund:%' THEN
  IF NOT EXISTS(SELECT 1 FROM "AuctionRefund" WHERE "operationId"=NEW."operationId" AND status='COMPLETED' AND 'auction-refund:'||id=NEW.reference) THEN RAISE EXCEPTION 'Refund journal requires completed durable intent';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bonus_refund_committed AFTER INSERT ON "DepositBonusRefund" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v5_refund_funding();
CREATE CONSTRAINT TRIGGER refund_journal_committed AFTER INSERT ON "Journal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_v5_refund_funding();

ALTER TABLE "AuctionTerms" DROP CONSTRAINT auction_terms_range_check;
ALTER TABLE "AuctionTerms" ADD CONSTRAINT auction_terms_range_check CHECK(version>=1 AND "minPoints">=1 AND ("maxPoints" IS NOT NULL OR "ruleVersion" IN ('lowest-unique-v3','lowest-unique-v4','lowest-unique-v5')) AND ("maxPoints" IS NULL OR ("maxPoints">="minPoints" AND ("maxPoints"-"minPoints")%"stepPoints"=0)) AND "stepPoints">=CASE WHEN "ruleVersion" IN ('lowest-unique-v3','lowest-unique-v4','lowest-unique-v5') THEN 0.01 ELSE 1 END AND "entryFeePoints">=0 AND "maxDistinctBids"=100 AND ("ruleVersion" NOT IN ('lowest-unique-v4','lowest-unique-v5') OR "maxPoints" IS NULL));
ALTER TABLE "AuctionSettlement" DROP CONSTRAINT settlement_cancel_actor;
ALTER TABLE "AuctionSettlement" ADD CONSTRAINT settlement_cancel_actor CHECK((outcome='CANCELLED' AND "actorId" IS NOT NULL AND reason IS NOT NULL AND key IS NOT NULL AND "requestHash" IS NOT NULL AND length("actorId")>0 AND length(reason)>0 AND length(key)>0 AND length("requestHash")>0) OR (outcome='CANCELLED' AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4','lowest-unique-v5') AND decision IN ('MINIMUM_PARTICIPANTS','NO_UNIQUE_BID') AND reason=decision AND "actorId" IS NULL AND key IS NULL AND "requestHash" IS NULL AND (decision<>'NO_UNIQUE_BID' OR "ruleVersion"='lowest-unique-v5')) OR (outcome<>'CANCELLED' AND "actorId" IS NULL AND reason IS NULL AND key IS NULL AND "requestHash" IS NULL));


CREATE OR REPLACE FUNCTION guard_new_rule_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM "Auction" WHERE id=NEW."auctionId" FOR UPDATE;
 IF NEW."ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4','lowest-unique-v5') THEN
  IF NEW."minParticipants"<>2 OR a."publishedAt" IS NOT NULL OR EXISTS(SELECT 1 FROM "Bid" WHERE "auctionId"=a.id) THEN
   RAISE EXCEPTION 'V2 requires two participants and must be frozen before publication';
  END IF;
 ELSIF NEW."ruleVersion"<>'lowest-unique-v1' OR NEW."minParticipants"<>0 THEN
  RAISE EXCEPTION 'Unsupported frozen rule';
 END IF;
 IF NEW."ruleVersion" IN ('lowest-unique-v3','lowest-unique-v4','lowest-unique-v5') THEN
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
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId" AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4','lowest-unique-v5')) THEN
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
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=aid AND "ruleVersion"='lowest-unique-v5') THEN
  SELECT count("acceptanceOrder"),coalesce(max("acceptanceOrder"),0) INTO n,maximum FROM "Bid" WHERE "auctionId"=aid;
  SELECT "bidSequence" INTO sequence FROM "Auction" WHERE id=aid;
  IF sequence<>n OR maximum<>n OR EXISTS(SELECT 1 FROM "Bid" b WHERE b."auctionId"=aid AND b."acceptanceOrder" IS NULL AND NOT EXISTS(SELECT 1 FROM "AuctionPolicyTransition" x WHERE x."auctionId"=aid AND x.before->>'ruleVersion'='lowest-unique-v1' AND b."acceptedAt"<=x."createdAt")) THEN RAISE EXCEPTION 'V5 acceptance sequence mismatch';END IF;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='Bid' THEN aid:=NEW."auctionId"; ELSE aid:=NEW.id; END IF;
 IF EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=aid AND "ruleVersion" IN ('lowest-unique-v2','lowest-unique-v3','lowest-unique-v4','lowest-unique-v5')) THEN
  SELECT count(*),coalesce(max("acceptanceOrder"),0),count(*) FILTER(WHERE "acceptanceOrder" IS NULL) INTO n,maximum,missing FROM "Bid" WHERE "auctionId"=aid;
  SELECT "bidSequence" INTO sequence FROM "Auction" WHERE id=aid;
  IF missing<>0 OR sequence<>n OR maximum<>n THEN RAISE EXCEPTION 'Acceptance sequence must match immutable accepted bids'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION guard_cent_bid_pattern() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule text;
BEGIN
 SELECT "ruleVersion" INTO rule FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId";
 IF rule IN ('lowest-unique-v3','lowest-unique-v4','lowest-unique-v5') THEN
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

CREATE OR REPLACE FUNCTION guard_fee_only_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.points<>0 AND EXISTS(SELECT 1 FROM "AuctionTerms" WHERE "auctionId"=NEW."auctionId" AND "ruleVersion" IN ('lowest-unique-v4','lowest-unique-v5')) THEN
  RAISE EXCEPTION 'Fee-only bids cannot reserve wallet funds';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_settlement_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "Auction"%ROWTYPE; t "AuctionTerms"%ROWTYPE; chosen "Bid"%ROWTYPE; actual_count integer; participants integer; choice text; distribution jsonb;
BEGIN
 IF NEW."ruleVersion"='lowest-unique-v5' THEN RETURN validate_v5_settlement(NEW); END IF;
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

CREATE OR REPLACE FUNCTION check_terminal_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_id text; a "Auction"%ROWTYPE; s "AuctionSettlement"%ROWTYPE; fee_only boolean;
BEGIN
  IF TG_TABLE_NAME='Auction' THEN auction_id:=NEW.id;
  ELSIF TG_TABLE_NAME='SettlementMovement' THEN SELECT "auctionId" INTO auction_id FROM "AuctionSettlement" WHERE id=NEW."settlementId";
  ELSE auction_id:=NEW."auctionId"; END IF;
  SELECT * INTO a FROM "Auction" WHERE id=auction_id;
  SELECT * INTO s FROM "AuctionSettlement" WHERE "auctionId"=auction_id;
  SELECT "ruleVersion"='lowest-unique-v4' INTO fee_only FROM "AuctionTerms" WHERE "auctionId"=auction_id;
  IF s."ruleVersion"='lowest-unique-v5' THEN PERFORM assert_v5_refund_queue(s.id); RETURN NULL; END IF;
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

CREATE OR REPLACE FUNCTION assert_deposit_bonus_wallet(uid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE projected numeric; actual numeric;
BEGIN
 SELECT COALESCE((SELECT balance*100 FROM "LedgerAccount" WHERE name='user:'||uid||':bonus'),0) INTO projected;
 SELECT COALESCE(sum(l."amountCents"-COALESCE(u.used,0)-COALESCE(e."amountCents",0)),0) INTO actual
 FROM "DepositBonusLot" l LEFT JOIN LATERAL(SELECT COALESCE(sum("amountCents"),0)-COALESCE((SELECT sum("creditedCents") FROM "DepositBonusRefund" WHERE "checkoutId"=l."checkoutId"),0) AS used FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId") u ON true
 LEFT JOIN "DepositBonusExpiry" e ON e."checkoutId"=l."checkoutId" WHERE l."userId"=uid;
 IF projected<>actual OR EXISTS(SELECT 1 FROM "DepositBonusLot" l WHERE l."userId"=uid AND l."amountCents"+COALESCE((SELECT sum("creditedCents") FROM "DepositBonusRefund" WHERE "checkoutId"=l."checkoutId"),0)<
  COALESCE((SELECT sum(u."amountCents") FROM "DepositBonusUse" u WHERE u."checkoutId"=l."checkoutId"),0)+COALESCE((SELECT e."amountCents" FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId"),0))
 THEN RAISE EXCEPTION 'Deposit bonus lot balance mismatch';END IF;
END $$;

CREATE OR REPLACE FUNCTION assert_deposit_bonus_proof(op_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o "Operation"%ROWTYPE;j "Journal"%ROWTYPE;l "DepositBonusLot"%ROWTYPE;c "ChapaCheckout"%ROWTYPE;
 e "DepositBonusExpiry"%ROWTYPE;b "Bid"%ROWTYPE;amount bigint;uid text;debit text;credit text;principal "Journal"%ROWTYPE;principal_op "Operation"%ROWTYPE;
BEGIN
 SELECT * INTO o FROM "Operation" WHERE id=op_id;SELECT * INTO j FROM "Journal" WHERE "operationId"=op_id;
 IF o.scope NOT IN ('DEPOSIT_BONUS','DEPOSIT_BONUS_USE','DEPOSIT_BONUS_EXPIRY') THEN
  IF j.kind IN ('DEPOSIT_BONUS','DEPOSIT_BONUS_USE','DEPOSIT_BONUS_EXPIRY') THEN RAISE EXCEPTION 'Deposit bonus journal requires its matching operation';END IF;
  RETURN;
 END IF;
 uid:=o."userId";
 IF j.id IS NULL OR j.kind<>o.scope THEN RAISE EXCEPTION 'Deposit bonus operation has no matching journal';END IF;
 IF o.scope='DEPOSIT_BONUS' THEN
  SELECT * INTO l FROM "DepositBonusLot" WHERE "journalId"=j.id;SELECT * INTO c FROM "ChapaCheckout" WHERE id=l."checkoutId";
  SELECT * INTO principal FROM "Journal" WHERE id=c."creditJournalId";
  SELECT * INTO principal_op FROM "Operation" WHERE id=principal."operationId";
  amount:=l."amountCents";debit:='platform:issuance';credit:='user:'||uid||':bonus';
  IF l."checkoutId" IS NULL OR l."userId" IS DISTINCT FROM uid OR c."userId" IS DISTINCT FROM uid OR c.purpose IS DISTINCT FROM 'TOP_UP' OR c.status IS DISTINCT FROM 'CREDITED'
   OR c."providerStatus" IS DISTINCT FROM 'SUCCESS' OR c."verificationState" IS DISTINCT FROM 'VERIFIED' OR principal.kind IS DISTINCT FROM 'CHAPA_RECEIPT'
   OR principal."transactionId" IS DISTINCT FROM j."transactionId" OR j."transactionId"<>txid_current() OR o.key IS DISTINCT FROM c.id OR o."requestHash" IS DISTINCT FROM c."evidenceHash"
   OR principal.reference IS DISTINCT FROM 'chapa:'||c."merchantReference" OR principal_op.scope IS DISTINCT FROM 'CHAPA_RECEIPT'
   OR principal_op."userId" IS DISTINCT FROM uid OR principal_op.key IS DISTINCT FROM c.id OR principal_op."requestHash" IS DISTINCT FROM c."evidenceHash"
   OR (principal_op.result->>'amountCents')::bigint IS DISTINCT FROM c."amountCents"
   OR (SELECT count(*) FROM "Posting" WHERE "journalId"=principal.id)<>2
   OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=principal.id AND a.name='platform:issuance' AND p.delta=-c."amountCents"::numeric/100)
   OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=principal.id AND a.name='user:'||uid||':available' AND p.delta=c."amountCents"::numeric/100)
   OR l."createdAt"<principal."createdAt" OR l."createdAt">clock_timestamp() AT TIME ZONE 'UTC'
   OR (c.initialization->'depositBonus'->>'amountCents')::bigint IS DISTINCT FROM amount
   OR (c.initialization->'depositBonus'->>'policyVersion')::integer IS DISTINCT FROM l."policyVersion"
   OR (c.initialization->'depositBonus'->>'validityDays')::integer IS DISTINCT FROM l."validityDays"
   OR o.result->>'principalJournalId' IS DISTINCT FROM c."creditJournalId" OR o.result->>'checkoutId' IS DISTINCT FROM c.id
   OR (o.result->>'policyVersion')::integer IS DISTINCT FROM l."policyVersion" OR (o.result->>'validityDays')::integer IS DISTINCT FROM l."validityDays"
   OR (o.result->>'expiresAt')::timestamp IS DISTINCT FROM l."expiresAt"
   OR j.reference IS DISTINCT FROM 'deposit-bonus:'||c.id THEN RAISE EXCEPTION 'Deposit bonus requires its verified principal receipt';END IF;
 ELSIF o.scope='DEPOSIT_BONUS_USE' THEN
  SELECT * INTO b FROM "Bid" WHERE id=o.key;SELECT sum("amountCents") INTO amount FROM "DepositBonusUse" WHERE "operationId"=o.id;
  debit:='user:'||uid||':bonus';credit:='user:'||uid||':available';
  IF b.id IS NULL OR b."userId" IS DISTINCT FROM uid OR amount IS NULL OR j.reference IS DISTINCT FROM 'bid:'||b.id OR o.result->>'bidId' IS DISTINCT FROM b.id
   OR NOT EXISTS(SELECT 1 FROM "Auction" a JOIN "AuctionTerms" t ON t."auctionId"=a.id JOIN "Product" p ON p.id=a."productId" WHERE a.id=b."auctionId" AND t."ruleVersion" IN ('lowest-unique-v4','lowest-unique-v5') AND NOT a."isDemo" AND a."testRunId" IS NULL AND NOT p."isDemo")
   OR NOT EXISTS(SELECT 1 FROM "Journal" fee WHERE fee."operationId"=b."operationId" AND fee.kind='BID_FEE' AND fee."transactionId"=j."transactionId")
   OR amount>100*(b."feePoints"-COALESCE((SELECT "discountPoints" FROM "ReferralRedemption" WHERE "bidId"=b.id),0))
   OR EXISTS(SELECT 1 FROM "ChapaCheckout" x WHERE x.purpose='BID' AND (x."bidId"=b.id OR x."batchId" IS NOT NULL AND EXISTS(SELECT 1 FROM "BidBatchOrder" batch WHERE batch.id=x."batchId" AND batch.receipt->'receipts' @> jsonb_build_array(jsonb_build_object('bid',jsonb_build_object('id',b.id))))))
   OR EXISTS(SELECT 1 FROM "ArifPayCheckout" x WHERE x."bidId"=b.id)
   OR EXISTS(SELECT 1 FROM "DepositBonusUse" u JOIN "DepositBonusLot" lot ON lot."checkoutId"=u."checkoutId" WHERE u."operationId"=o.id AND (u."userId"<>uid OR lot."userId"<>uid OR u."bidId"<>b.id OR b."acceptedAt">=lot."expiresAt" OR b."acceptedAt"<lot."createdAt" OR EXISTS(SELECT 1 FROM "DepositBonusExpiry" x WHERE x."checkoutId"=lot."checkoutId")))
  THEN RAISE EXCEPTION 'Deposit bonus may only fund an accepted fee before expiry';END IF;
 ELSE
  SELECT * INTO e FROM "DepositBonusExpiry" WHERE "journalId"=j.id;SELECT * INTO l FROM "DepositBonusLot" WHERE "checkoutId"=e."checkoutId";
  amount:=e."amountCents";debit:='user:'||uid||':bonus';credit:='platform:issuance';
  IF e."checkoutId" IS NULL OR e."userId" IS DISTINCT FROM uid OR l."userId" IS DISTINCT FROM uid OR e."createdAt"<l."expiresAt" OR e."createdAt">clock_timestamp() AT TIME ZONE 'UTC' OR o.key IS DISTINCT FROM l."checkoutId" OR j.reference IS DISTINCT FROM 'deposit-bonus:'||l."checkoutId" OR o.result->>'checkoutId' IS DISTINCT FROM l."checkoutId"
   OR amount<>l."amountCents"+COALESCE((SELECT sum("creditedCents") FROM "DepositBonusRefund" WHERE "checkoutId"=l."checkoutId"),0)-COALESCE((SELECT sum("amountCents") FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId"),0)
  THEN RAISE EXCEPTION 'Deposit bonus expiry does not match unused expired value';END IF;
 END IF;
 IF amount IS NULL OR amount<=0 OR (o.result->>'amountCents')::bigint IS DISTINCT FROM amount
  OR (SELECT count(*) FROM "Posting" WHERE "journalId"=j.id)<>2
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name=debit AND p.delta=-amount::numeric/100)
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name=credit AND p.delta=amount::numeric/100)
 THEN RAISE EXCEPTION 'Deposit bonus journal proof mismatch';END IF;
 PERFORM assert_deposit_bonus_wallet(uid);
END $$;

CREATE OR REPLACE FUNCTION assert_referral_redemption(op_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r "ReferralRedemption"%ROWTYPE; c "ReferralCoupon"%ROWTYPE; b "Bid"%ROWTYPE;
 o "Operation"%ROWTYPE; j "Journal"%ROWTYPE; bj "Journal"%ROWTYPE; bo "Operation"%ROWTYPE; rule text;
BEGIN
 SELECT * INTO r FROM "ReferralRedemption" WHERE "operationId"=op_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Referral redemption must fund an accepted bid'; END IF;
 SELECT * INTO c FROM "ReferralCoupon" WHERE id=r."couponId";
 SELECT * INTO b FROM "Bid" WHERE id=r."bidId";
 SELECT * INTO o FROM "Operation" WHERE id=op_id;
 SELECT * INTO bo FROM "Operation" WHERE id=b."operationId";
 SELECT * INTO j FROM "Journal" WHERE "operationId"=op_id;
 SELECT * INTO bj FROM "Journal" WHERE "operationId"=b."operationId";
 SELECT "ruleVersion" INTO rule FROM "AuctionTerms" WHERE "auctionId"=b."auctionId";
 IF c.id IS NULL OR b.id IS NULL OR j.id IS NULL OR bj.id IS NULL OR rule NOT IN ('lowest-unique-v4','lowest-unique-v5')
  OR c."ownerUserId"<>r."userId" OR b."userId"<>r."userId" OR o."userId"<>r."userId" OR bo."userId"<>r."userId"
  OR o.scope<>'REFERRAL_DISCOUNT' OR o.key<>b.id OR j.kind<>'REFERRAL_DISCOUNT' OR bj.kind<>'BID_FEE'
  OR j.reference<>'bid:'||b.id OR j."transactionId"<>bj."transactionId" OR j."transactionId"<>txid_current()
  OR r."grossFeePoints"<>b."feePoints" OR r."discountPoints"<>trunc(b."feePoints"*c.percent/100,2)
  OR r."createdAt"<c."createdAt" OR r."createdAt">=c."expiresAt" OR b."acceptedAt">=c."expiresAt"
  OR bo.result->'charge'->>'couponId' IS DISTINCT FROM c.id
  OR (bo.result->'charge'->>'discountPoints')::numeric IS DISTINCT FROM r."discountPoints"
  OR (bo.result->'charge'->>'netFeePoints')::numeric IS DISTINCT FROM b."feePoints"-r."discountPoints"
  OR o.result->>'bidId' IS DISTINCT FROM b.id OR o.result->>'couponId' IS DISTINCT FROM c.id
  OR (o.result->>'discountPoints')::numeric IS DISTINCT FROM r."discountPoints"
  OR (SELECT count(*) FROM "Posting" WHERE "journalId"=j.id)<>2
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='platform:fees' AND p.delta=-r."discountPoints")
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='user:'||r."userId"||':available' AND p.delta=r."discountPoints")
 THEN RAISE EXCEPTION 'Referral redemption proof mismatch'; END IF;
END $$;

-- Scoped transition capability replaces the unconditional immutable trigger.
-- It accepts exactly the audited V5 improvement, never arbitrary term edits.
CREATE FUNCTION protect_v5_terms_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."ruleVersion" IS DISTINCT FROM 'lowest-unique-v5' OR OLD."ruleVersion" NOT IN ('lowest-unique-v1','lowest-unique-v2','lowest-unique-v3','lowest-unique-v4')
  OR NEW."minParticipants"<>2 OR NEW."minPoints"<>1 OR NEW."stepPoints"<>0.01 OR NEW."maxPoints" IS NOT NULL
  OR (to_jsonb(NEW)-ARRAY['ruleVersion','minParticipants','minPoints','maxPoints','stepPoints','noWinnerTerms','cancellationTerms']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ruleVersion','minParticipants','minPoints','maxPoints','stepPoints','noWinnerTerms','cancellationTerms'])
  OR NOT EXISTS(SELECT 1 FROM "AuctionPolicyTransition" x JOIN "Auction" a ON a.id=x."auctionId" WHERE x."auctionId"=OLD."auctionId" AND x.before=to_jsonb(OLD) AND x.after->>'ruleVersion'='lowest-unique-v5' AND a.status IN ('DRAFT','LIVE','SCHEDULED') AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id) AND NOT EXISTS(SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id)) THEN RAISE EXCEPTION 'Frozen terms require an exact audited V5 transition';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER immutable_auction_terms ON "AuctionTerms";
CREATE TRIGGER immutable_auction_terms BEFORE UPDATE OR DELETE ON "AuctionTerms" FOR EACH ROW EXECUTE FUNCTION protect_v5_terms_transition();
INSERT INTO "AuctionPolicyTransition"(id,"auctionId",before,after,"actorId",reason,"operationKey")
SELECT gen_random_uuid()::text,a.id,to_jsonb(t),jsonb_build_object('ruleVersion','lowest-unique-v5','refundPolicy','ORIGINAL_FUNDING_V1'),'operator:v5-policy-migration','Owner-requested unique-only decisions and cancellation net-fee refunds; accepted receipts retained','v5-policy:'||a.id
FROM "Auction" a JOIN "AuctionTerms" t ON t."auctionId"=a.id WHERE a.status IN ('DRAFT','LIVE','SCHEDULED') AND t."ruleVersion" IN ('lowest-unique-v1','lowest-unique-v2','lowest-unique-v3','lowest-unique-v4') AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id) AND NOT EXISTS(SELECT 1 FROM "PublicAuctionResult" p WHERE p."auctionId"=a.id);
UPDATE "AuctionTerms" t SET "ruleVersion"='lowest-unique-v5',"minParticipants"=2,"minPoints"=1,"maxPoints"=NULL,"stepPoints"=0.01,
 "noWinnerTerms"='At least two eligible participants are required. The lowest unique accepted number wins. If no number is unique, cancel with NO_UNIQUE_BID; repeated numbers never win.',
 "cancellationTerms"='Cancelled auctions automatically return actual net paid fees to Lowwin wallets. Cash returns as cash; promotional credit retains its original expiry and never becomes cash. Discounts are not refunded. Legacy holds release separately; refunds are announced after ledger commit.'
FROM "AuctionPolicyTransition" x WHERE x."auctionId"=t."auctionId" AND x.before=to_jsonb(t);
INSERT INTO "AuctionControlRevision"(id,"auctionId",version,kind,before,after,"actorId",reason,"operationKey") SELECT gen_random_uuid()::text,a.id,a."controlVersion"+1,'BIDDING_POLICY',x.before,x.after,x."actorId",x.reason,x."operationKey" FROM "AuctionPolicyTransition" x JOIN "Auction" a ON a.id=x."auctionId";
UPDATE "Auction" a SET "controlVersion"="controlVersion"+1 FROM "AuctionPolicyTransition" x WHERE x."auctionId"=a.id;
DO $$DECLARE tab text;role_name text;BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN GRANT SELECT ON "AuctionBidFunding" TO lowwin_runtime;END IF;
 FOREACH tab IN ARRAY ARRAY['AuctionPolicyTransition','AuctionRefund','DepositBonusRefund'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tab);
  EXECUTE format('CREATE TRIGGER v5_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change()',tab);
  IF tab<>'AuctionRefund' THEN EXECUTE format('CREATE TRIGGER v5_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',tab);END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',tab,role_name);END IF;END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
   EXECUTE format('GRANT SELECT ON %I TO lowwin_runtime',tab);
   IF tab<>'AuctionPolicyTransition' THEN EXECUTE format('GRANT INSERT ON %I TO lowwin_runtime',tab);END IF;
   IF tab='AuctionRefund' THEN EXECUTE 'GRANT UPDATE(status,"operationId","releaseOperationId","completedAt") ON "AuctionRefund" TO lowwin_runtime';END IF;
   EXECUTE format('CREATE POLICY lowwin_server_access ON %I TO lowwin_runtime USING(true) WITH CHECK(true)',tab);
  END IF;
 END LOOP;
END $$;
COMMIT;
