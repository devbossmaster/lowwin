-- AlterTable
ALTER TABLE "PlayerProfile" ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactEmail" TEXT;

-- CreateTable
CREATE TABLE "ReferralPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "discountPercent" INTEGER NOT NULL DEFAULT 10,
    "expiryDays" INTEGER NOT NULL DEFAULT 30,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralInvite" (
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralInvite_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReferralPendingSignup" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "consumedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralPendingSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSignup" (
    "referredUserId" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "pendingId" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstBidId" TEXT,
    "qualifiedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralSignup_pkey" PRIMARY KEY ("referredUserId")
);

-- CreateTable
CREATE TABLE "ReferralCoupon" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "grossFeePoints" DECIMAL NOT NULL,
    "discountPoints" DECIMAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralInvite_token_key" ON "ReferralInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPendingSignup_consumedUserId_key" ON "ReferralPendingSignup"("consumedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPendingSignup_botId_telegramId_key" ON "ReferralPendingSignup"("botId", "telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralSignup_pendingId_key" ON "ReferralSignup"("pendingId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralSignup_firstBidId_key" ON "ReferralSignup"("firstBidId");

-- CreateIndex
CREATE INDEX "ReferralSignup_referrerUserId_registeredAt_idx" ON "ReferralSignup"("referrerUserId", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCoupon_referredUserId_key" ON "ReferralCoupon"("referredUserId");

-- CreateIndex
CREATE INDEX "ReferralCoupon_ownerUserId_expiresAt_idx" ON "ReferralCoupon"("ownerUserId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_couponId_key" ON "ReferralRedemption"("couponId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_bidId_key" ON "ReferralRedemption"("bidId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRedemption_operationId_key" ON "ReferralRedemption"("operationId");

-- AddForeignKey
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPendingSignup" ADD CONSTRAINT "ReferralPendingSignup_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPendingSignup" ADD CONSTRAINT "ReferralPendingSignup_consumedUserId_fkey" FOREIGN KEY ("consumedUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_pendingId_fkey" FOREIGN KEY ("pendingId") REFERENCES "ReferralPendingSignup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_firstBidId_fkey" FOREIGN KEY ("firstBidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCoupon" ADD CONSTRAINT "ReferralCoupon_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCoupon" ADD CONSTRAINT "ReferralCoupon_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "ReferralSignup"("referredUserId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "ReferralCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRedemption" ADD CONSTRAINT "ReferralRedemption_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReferralRegistrationProof" (
 "userId" TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT,
 "transactionId" BIGINT NOT NULL DEFAULT txid_current(),
 "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE FUNCTION guard_referral_registration_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Referral registration proof is server managed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_registration_guard BEFORE INSERT ON "ReferralRegistrationProof" FOR EACH ROW EXECUTE FUNCTION guard_referral_registration_proof();
CREATE FUNCTION record_referral_registration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."telegramId" IS NOT NULL THEN INSERT INTO "ReferralRegistrationProof"("userId") VALUES(NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_registration AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION record_referral_registration();

-- Additive only: no customer, ledger, payment, auction or settlement row is reset.
ALTER TABLE "PlayerProfile" ADD CONSTRAINT referral_profile_contact_lengths CHECK
 (("contactEmail" IS NULL OR length("contactEmail")<=254) AND (city IS NULL OR length(city)<=80));
ALTER TABLE "ReferralPolicy" ADD CONSTRAINT referral_policy_limits CHECK
 (id='default' AND "discountPercent" BETWEEN 5 AND 15 AND "expiryDays" BETWEEN 15 AND 30 AND version>=1);
ALTER TABLE "ReferralInvite" ADD CONSTRAINT referral_invite_token CHECK (token ~ '^[A-Za-z0-9_-]{12}$');
ALTER TABLE "ReferralPendingSignup" ADD CONSTRAINT referral_pending_limits CHECK
 ("botId" ~ '^[0-9]{1,20}$' AND "telegramId" ~ '^[0-9]{1,20}$' AND "expiresAt"=COALESCE("renewedAt","createdAt")+interval '30 days');
ALTER TABLE "ReferralSignup" ADD CONSTRAINT referral_signup_identity CHECK
 ("referrerUserId"<>"referredUserId" AND (("firstBidId" IS NULL AND "qualifiedAt" IS NULL) OR ("firstBidId" IS NOT NULL AND "qualifiedAt" IS NOT NULL)));
ALTER TABLE "ReferralCoupon" ADD CONSTRAINT referral_coupon_limits CHECK
 (percent BETWEEN 5 AND 15 AND "policyVersion">=1 AND "expiresAt">"createdAt");
ALTER TABLE "ReferralRedemption" ADD CONSTRAINT referral_redemption_amount CHECK
 ("grossFeePoints">0 AND "discountPoints">0 AND "discountPoints"<"grossFeePoints"
  AND "grossFeePoints"=trunc("grossFeePoints",2) AND "discountPoints"=trunc("discountPoints",2));

CREATE FUNCTION guard_referral_pending() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "user"%ROWTYPE; registration "ReferralRegistrationProof"%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM "user" WHERE "telegramId"=NEW."telegramId") THEN RAISE EXCEPTION 'Existing customers cannot acquire a referral'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."botId"<>OLD."botId" OR NEW."telegramId"<>OLD."telegramId"
   OR NEW."referrerUserId"<>OLD."referrerUserId" OR NEW."createdAt"<>OLD."createdAt"
   OR OLD."consumedUserId" IS NOT NULL THEN RAISE EXCEPTION 'Referral attribution is immutable'; END IF;
  IF NEW."consumedUserId" IS NULL THEN
   IF OLD."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' OR NEW."renewedAt" IS NULL OR NEW."renewedAt"<OLD."expiresAt"
    OR EXISTS(SELECT 1 FROM "user" WHERE "telegramId"=NEW."telegramId") THEN RAISE EXCEPTION 'Referral renewal requires a fresh unregistered start'; END IF;
   RETURN NEW;
  END IF;
  IF NEW."renewedAt" IS DISTINCT FROM OLD."renewedAt" OR NEW."expiresAt"<>OLD."expiresAt" THEN RAISE EXCEPTION 'Referral consumption cannot renew attribution'; END IF;
  SELECT * INTO u FROM "user" WHERE id=NEW."consumedUserId";
  SELECT * INTO registration FROM "ReferralRegistrationProof" WHERE "userId"=u.id;
  IF u.id IS NULL OR u."telegramId" IS DISTINCT FROM NEW."telegramId" OR registration."transactionId" IS DISTINCT FROM txid_current()
   OR registration."registeredAt"+interval '1 millisecond'<COALESCE(NEW."renewedAt",NEW."createdAt")
   OR NEW."expiresAt"<clock_timestamp() AT TIME ZONE 'UTC' THEN RAISE EXCEPTION 'Referral signup does not match registration'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_pending_guard BEFORE INSERT OR UPDATE ON "ReferralPendingSignup" FOR EACH ROW EXECUTE FUNCTION guard_referral_pending();

CREATE FUNCTION guard_referral_signup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u "user"%ROWTYPE; registration "ReferralRegistrationProof"%ROWTYPE; p "ReferralPendingSignup"%ROWTYPE; b "Bid"%ROWTYPE; bid_xid bigint;
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
  SELECT xmin::text::bigint INTO bid_xid FROM "Bid" WHERE id=NEW."firstBidId";
  IF b.id IS NULL OR b."userId"<>NEW."referredUserId" OR bid_xid<>(txid_current()%4294967296)
   OR NEW."qualifiedAt" IS NULL OR NEW."qualifiedAt"+interval '1 millisecond'<b."acceptedAt"
   OR EXISTS(SELECT 1 FROM "Bid" WHERE "userId"=b."userId" AND id<>b.id) THEN RAISE EXCEPTION 'Referral requires the first accepted bid'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_signup_guard BEFORE INSERT OR UPDATE ON "ReferralSignup" FOR EACH ROW EXECUTE FUNCTION guard_referral_signup();

CREATE FUNCTION guard_referral_coupon() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "ReferralSignup"%ROWTYPE; p "ReferralPolicy"%ROWTYPE; bid_xid bigint;
BEGIN
 SELECT * INTO s FROM "ReferralSignup" WHERE "referredUserId"=NEW."referredUserId";
 SELECT * INTO p FROM "ReferralPolicy" WHERE id='default' FOR SHARE;
 SELECT xmin::text::bigint INTO bid_xid FROM "Bid" WHERE id=s."firstBidId";
 IF s."firstBidId" IS NULL OR s."referrerUserId"<>NEW."ownerUserId" OR bid_xid<>(txid_current()%4294967296)
  OR p.id IS NULL OR NOT p.enabled OR p.version<>NEW."policyVersion" OR p."discountPercent"<>NEW.percent
  OR NEW."createdAt" IS DISTINCT FROM s."qualifiedAt" OR NEW."expiresAt"<>NEW."createdAt"+p."expiryDays"*interval '1 day'
 THEN RAISE EXCEPTION 'Referral coupon requires a committed qualification policy'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referral_coupon_guard BEFORE INSERT ON "ReferralCoupon" FOR EACH ROW EXECUTE FUNCTION guard_referral_coupon();

CREATE FUNCTION assert_referral_redemption(op_id text) RETURNS void LANGUAGE plpgsql AS $$
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
 IF c.id IS NULL OR b.id IS NULL OR j.id IS NULL OR bj.id IS NULL OR rule IS DISTINCT FROM 'lowest-unique-v4'
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

CREATE FUNCTION check_referral_redemption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ReferralRedemption' THEN PERFORM assert_referral_redemption(NEW."operationId");
 ELSIF TG_TABLE_NAME='Journal' THEN
  IF NEW.kind='REFERRAL_DISCOUNT' THEN PERFORM assert_referral_redemption(NEW."operationId"); END IF;
 ELSIF TG_TABLE_NAME='Operation' THEN
  IF NEW.scope='REFERRAL_DISCOUNT' THEN PERFORM assert_referral_redemption(NEW.id); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER referral_redemption_proof AFTER INSERT ON "ReferralRedemption" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_referral_redemption();
CREATE CONSTRAINT TRIGGER referral_journal_proof AFTER INSERT ON "Journal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_referral_redemption();
CREATE CONSTRAINT TRIGGER referral_operation_proof AFTER INSERT ON "Operation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_referral_redemption();

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['ReferralInvite','ReferralCoupon','ReferralRedemption','ReferralRegistrationProof'] LOOP
  EXECUTE format('CREATE TRIGGER referral_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['ReferralPolicy','ReferralInvite','ReferralPendingSignup','ReferralSignup','ReferralCoupon','ReferralRedemption','ReferralRegistrationProof'] LOOP
  EXECUTE format('CREATE TRIGGER referral_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change()',name);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
   IF name IN ('ReferralPolicy','ReferralPendingSignup','ReferralSignup') THEN
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO lowwin_runtime',name);
   ELSE EXECUTE format('GRANT SELECT,INSERT ON %I TO lowwin_runtime',name); END IF;
   EXECUTE format('CREATE POLICY lowwin_server_access ON %I TO lowwin_runtime USING (true) WITH CHECK (true)',name);
  END IF;
 END LOOP;
END $$;
CREATE TRIGGER referral_policy_no_delete BEFORE DELETE ON "ReferralPolicy" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER referral_pending_no_delete BEFORE DELETE ON "ReferralPendingSignup" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER referral_signup_no_delete BEFORE DELETE ON "ReferralSignup" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
