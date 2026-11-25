BEGIN;
SET LOCAL lock_timeout='10s';

ALTER TABLE "ReferralPolicy" ADD COLUMN "rewardCents" bigint;
ALTER TABLE "ReferralPolicy" ADD CONSTRAINT referral_wallet_reward_policy_amount
 CHECK ("rewardCents" IS NULL OR "rewardCents" BETWEEN 1 AND 10000000);

-- Existing bids keep their history. Stamp new bids with the top-level xid so
-- qualification works inside the payment savepoint as well as plain bids.
ALTER TABLE "Bid" ADD COLUMN "transactionId" bigint;
ALTER TABLE "Bid" ALTER COLUMN "transactionId" SET DEFAULT txid_current();
CREATE FUNCTION stamp_referral_bid_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW."transactionId":=txid_current();
 RETURN NEW;
END $$;
CREATE TRIGGER bid_referral_transaction_stamp BEFORE INSERT ON "Bid"
 FOR EACH ROW EXECUTE FUNCTION stamp_referral_bid_transaction();

CREATE TABLE "ReferralWalletReward" (
 "referredUserId" text PRIMARY KEY REFERENCES "ReferralSignup"("referredUserId") ON DELETE RESTRICT ON UPDATE CASCADE,
 "referrerUserId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "bidId" text NOT NULL REFERENCES "Bid"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "amountCents" bigint NOT NULL,
 "policyVersion" integer NOT NULL,
 "createdAt" timestamp(3) NOT NULL,
 "operationId" text REFERENCES "Operation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "creditedAt" timestamp(3),
 CONSTRAINT referral_wallet_reward_amount CHECK ("amountCents" BETWEEN 1 AND 10000000 AND "policyVersion">=1),
 CONSTRAINT referral_wallet_reward_parties CHECK ("referredUserId"<>"referrerUserId"),
 CONSTRAINT referral_wallet_reward_credit_fields CHECK (
  ("operationId" IS NULL AND "creditedAt" IS NULL)
  OR ("operationId" IS NOT NULL AND "creditedAt" IS NOT NULL AND "creditedAt">="createdAt"))
);
CREATE UNIQUE INDEX "ReferralWalletReward_bidId_key" ON "ReferralWalletReward"("bidId");
CREATE UNIQUE INDEX "ReferralWalletReward_operationId_key" ON "ReferralWalletReward"("operationId");
CREATE INDEX "ReferralWalletReward_referrerUserId_createdAt_idx" ON "ReferralWalletReward"("referrerUserId","createdAt");
CREATE INDEX referral_wallet_rewards_pending ON "ReferralWalletReward"("createdAt","referredUserId") WHERE "operationId" IS NULL;

INSERT INTO "LedgerAccount"(id,name,kind)
 VALUES('platform-referral-wallet-rewards','platform:referral-wallet-rewards','ISSUANCE') ON CONFLICT(name) DO NOTHING;

CREATE FUNCTION lowwin_referral_bid_eligible(bid_id text,uid text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId"
  JOIN "Product" p ON p.id=a."productId" JOIN "Category" pc ON pc.id=p."categoryId" JOIN "Category" ac ON ac.id=a."categoryId"
  WHERE b.id=bid_id AND b."userId"=uid AND b."transactionId"=txid_current()
    AND NOT a."isDemo" AND NOT p."isDemo" AND NOT a."isSettlementFixture" AND a."testRunId" IS NULL
    AND p.visible AND pc.visible AND ac.visible
    AND a."publishedAt"<=b."acceptedAt" AND a."startsAt"<=b."acceptedAt" AND a."endsAt">b."acceptedAt"
    AND NOT EXISTS (
     SELECT 1 FROM "Bid" prior JOIN "Auction" pa ON pa.id=prior."auctionId" JOIN "Product" pp ON pp.id=pa."productId"
     WHERE prior."userId"=uid AND prior.id<>b.id
       AND NOT pa."isDemo" AND NOT pp."isDemo" AND NOT pa."isSettlementFixture" AND pa."testRunId" IS NULL)
 )
$$;

CREATE OR REPLACE FUNCTION guard_referral_signup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "user"%ROWTYPE; registration "ReferralRegistrationProof"%ROWTYPE; p "ReferralPendingSignup"%ROWTYPE; b "Bid"%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO u FROM "user" WHERE id=NEW."referredUserId";
  SELECT * INTO registration FROM "ReferralRegistrationProof" WHERE "userId"=NEW."referredUserId";
  IF u.id IS NULL OR u."telegramId" IS NULL OR registration."transactionId" IS DISTINCT FROM txid_current()
   OR EXISTS(SELECT 1 FROM "Bid" WHERE "userId"=u.id)
   OR NEW."firstBidId" IS NOT NULL THEN RAISE EXCEPTION 'Referral must bind a newly registered customer'; END IF;
  IF NEW."pendingId" IS NOT NULL THEN
   SELECT * INTO p FROM "ReferralPendingSignup" WHERE id=NEW."pendingId";
   IF p.id IS NULL OR p."consumedUserId" IS DISTINCT FROM u.id OR p."referrerUserId"<>NEW."referrerUserId"
    OR p."expiresAt"<=NEW."registeredAt" THEN RAISE EXCEPTION 'Referral signup does not match pending registration'; END IF;
  END IF;
 ELSE
  IF NEW."referredUserId"<>OLD."referredUserId" OR NEW."referrerUserId"<>OLD."referrerUserId"
   OR NEW."pendingId" IS DISTINCT FROM OLD."pendingId" OR NEW."registeredAt"<>OLD."registeredAt"
   OR OLD."firstBidId" IS NOT NULL OR NEW."firstBidId" IS NULL THEN RAISE EXCEPTION 'Referral qualification is immutable'; END IF;
  SELECT * INTO b FROM "Bid" WHERE id=NEW."firstBidId";
  IF NOT lowwin_referral_bid_eligible(b.id,NEW."referredUserId") OR NEW."qualifiedAt" IS NULL
   OR NEW."qualifiedAt"+interval '1 millisecond'<b."acceptedAt" THEN RAISE EXCEPTION 'Referral requires the first qualifying accepted bid'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_referral_wallet_reward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE signup "ReferralSignup"%ROWTYPE; policy "ReferralPolicy"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."operationId" IS NOT NULL OR NEW."operationId" IS NULL
   OR (NEW."referredUserId",NEW."referrerUserId",NEW."bidId",NEW."amountCents",NEW."policyVersion",NEW."createdAt")
      IS DISTINCT FROM
      (OLD."referredUserId",OLD."referrerUserId",OLD."bidId",OLD."amountCents",OLD."policyVersion",OLD."createdAt")
   THEN RAISE EXCEPTION 'Referral reward evidence is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO signup FROM "ReferralSignup" WHERE "referredUserId"=NEW."referredUserId";
 SELECT * INTO policy FROM "ReferralPolicy" WHERE id='default' FOR SHARE;
 IF signup."firstBidId" IS DISTINCT FROM NEW."bidId"
  OR signup."referrerUserId" IS DISTINCT FROM NEW."referrerUserId"
  OR signup."qualifiedAt" IS DISTINCT FROM NEW."createdAt"
  OR NOT lowwin_referral_bid_eligible(NEW."bidId",NEW."referredUserId")
  OR policy.enabled IS DISTINCT FROM true OR policy."rewardCents" IS DISTINCT FROM NEW."amountCents"
  OR policy.version IS DISTINCT FROM NEW."policyVersion"
  OR NEW."operationId" IS NOT NULL
  OR EXISTS(SELECT 1 FROM "ReferralCoupon" WHERE "referredUserId"=NEW."referredUserId")
  OR NOT EXISTS(
   SELECT 1 FROM "user" u WHERE u.id=NEW."referrerUserId" AND u.role='member' AND u."telegramId" IS NOT NULL
    AND u.id NOT LIKE 'demo-showcase-%'
    AND NOT EXISTS(SELECT 1 FROM "TestRunActor" t WHERE t."userId"=u.id)
    AND NOT EXISTS(SELECT 1 FROM "StaffMember" s WHERE s."userId"=u.id)
    AND NOT EXISTS(SELECT 1 FROM "UserRestriction" r WHERE r."userId"=u.id AND r.suspended))
 THEN RAISE EXCEPTION 'Referral reward requires its accepted bid, eligible sponsor and current policy'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_wallet_reward_guard BEFORE INSERT OR UPDATE ON "ReferralWalletReward"
 FOR EACH ROW EXECUTE FUNCTION guard_referral_wallet_reward();
CREATE TRIGGER referral_wallet_reward_no_delete BEFORE DELETE ON "ReferralWalletReward"
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER referral_wallet_reward_no_truncate BEFORE TRUNCATE ON "ReferralWalletReward"
 FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION check_referral_wallet_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op_id text; reward "ReferralWalletReward"%ROWTYPE; op "Operation"%ROWTYPE; journal "Journal"%ROWTYPE; amount numeric;
BEGIN
 IF TG_TABLE_NAME='Operation' THEN
  IF NEW.scope<>'REFERRAL_REWARD' THEN RETURN NULL; END IF;
  op_id:=NEW.id;
 ELSIF TG_TABLE_NAME='Journal' THEN
  IF NEW.kind<>'REFERRAL_REWARD' THEN RETURN NULL; END IF;
  op_id:=NEW."operationId";
 ELSE
  op_id:=NEW."operationId";
 END IF;
 SELECT * INTO reward FROM "ReferralWalletReward" WHERE "operationId"=op_id;
 SELECT * INTO op FROM "Operation" WHERE id=op_id;
 SELECT * INTO journal FROM "Journal" WHERE "operationId"=op_id;
 amount:=reward."amountCents"::numeric/100;
 IF reward."creditedAt" IS NULL OR op.scope IS DISTINCT FROM 'REFERRAL_REWARD'
  OR op."userId" IS DISTINCT FROM reward."referrerUserId" OR op.key IS DISTINCT FROM reward."referredUserId"
  OR op.result->>'bidId' IS DISTINCT FROM reward."bidId"
  OR op.result->>'amountCents' IS DISTINCT FROM reward."amountCents"::text
  OR journal.kind IS DISTINCT FROM 'REFERRAL_REWARD' OR journal."transactionId" IS DISTINCT FROM txid_current()
  OR journal.reference IS DISTINCT FROM ('referral:'||reward."referredUserId")
  OR (SELECT count(*) FROM "Posting" WHERE "journalId"=journal.id)<>2
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId"
   WHERE p."journalId"=journal.id AND a.name='platform:referral-wallet-rewards' AND p.delta=-amount)
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" JOIN "Wallet" w ON w.id=a."walletId"
   WHERE p."journalId"=journal.id AND a.kind='AVAILABLE' AND w."userId"=reward."referrerUserId" AND p.delta=amount)
 THEN RAISE EXCEPTION 'Referral wallet credit proof mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER referral_wallet_credit_proof AFTER UPDATE ON "ReferralWalletReward"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_referral_wallet_credit();
CREATE CONSTRAINT TRIGGER referral_wallet_journal_proof AFTER INSERT ON "Journal"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='REFERRAL_REWARD') EXECUTE FUNCTION check_referral_wallet_credit();
CREATE CONSTRAINT TRIGGER referral_wallet_operation_proof AFTER INSERT ON "Operation"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.scope='REFERRAL_REWARD') EXECUTE FUNCTION check_referral_wallet_credit();

ALTER TABLE "ReferralWalletReward" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION lowwin_referral_bid_eligible(text,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ReferralWalletReward" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ReferralWalletReward" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON "ReferralWalletReward" TO lowwin_runtime;
  GRANT EXECUTE ON FUNCTION lowwin_referral_bid_eligible(text,text) TO lowwin_runtime;
  CREATE POLICY lowwin_server_access ON "ReferralWalletReward" TO lowwin_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;
COMMIT;
