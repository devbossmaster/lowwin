-- Additive, disabled until an administrator explicitly saves an enabled policy.
-- Align the saved provider lifecycle with the existing v2 evidence parser.
-- Expiry remains a privately verified non-paid outcome and cannot issue credit.
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_providerStatus_check";
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_providerStatus_check" CHECK (
 "providerStatus" IN ('SUCCESS','PENDING','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','AUTH_NEEDED'));
ALTER TABLE "LedgerAccount" DROP CONSTRAINT account_kind;
ALTER TABLE "LedgerAccount" ADD CONSTRAINT account_kind CHECK (
 (kind IN ('AVAILABLE','HELD','BONUS') AND "walletId" IS NOT NULL) OR
 (kind IN ('ISSUANCE','FEES','SETTLEMENT') AND "walletId" IS NULL));

CREATE TABLE "DepositBonusPolicy" (
 id TEXT PRIMARY KEY DEFAULT 'default' CHECK(id='default'),
 enabled BOOLEAN NOT NULL DEFAULT false,percent INTEGER NOT NULL DEFAULT 10 CHECK(percent BETWEEN 10 AND 100),
 "minCents" BIGINT NOT NULL DEFAULT 10000 CHECK("minCents" BETWEEN 100 AND 4320000),
 "maxBonusCents" BIGINT CHECK("maxBonusCents" BETWEEN 1 AND 4320000),
 "validityDays" INTEGER NOT NULL DEFAULT 7 CHECK("validityDays" BETWEEN 1 AND 365),
 "endsAt" TIMESTAMP(3),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "updatedBy" TEXT REFERENCES "user"(id) ON DELETE RESTRICT,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "DepositBonusLot" (
 "checkoutId" TEXT PRIMARY KEY REFERENCES "ChapaCheckout"(id) ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 "amountCents" BIGINT NOT NULL CHECK("amountCents">0),"policyVersion" INTEGER NOT NULL CHECK("policyVersion">0),
 "validityDays" INTEGER NOT NULL CHECK("validityDays" BETWEEN 1 AND 365),
 "journalId" TEXT NOT NULL UNIQUE REFERENCES "Journal"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"expiresAt" TIMESTAMP(3) NOT NULL,
 CHECK("expiresAt"="createdAt"+"validityDays"*interval '1 day'));
CREATE INDEX "DepositBonusLot_userId_expiresAt_idx" ON "DepositBonusLot"("userId","expiresAt");
CREATE INDEX "DepositBonusLot_expiresAt_checkoutId_idx" ON "DepositBonusLot"("expiresAt","checkoutId");
CREATE TABLE "DepositBonusUse" (
 id TEXT PRIMARY KEY,"checkoutId" TEXT NOT NULL REFERENCES "DepositBonusLot"("checkoutId") ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 "bidId" TEXT NOT NULL REFERENCES "Bid"(id) ON DELETE RESTRICT,
 "operationId" TEXT NOT NULL REFERENCES "Operation"(id) ON DELETE RESTRICT,
 "amountCents" BIGINT NOT NULL CHECK("amountCents">0),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("checkoutId","bidId"));
CREATE INDEX "DepositBonusUse_bidId_idx" ON "DepositBonusUse"("bidId");
CREATE INDEX "DepositBonusUse_userId_checkoutId_idx" ON "DepositBonusUse"("userId","checkoutId");
CREATE INDEX "DepositBonusUse_operationId_idx" ON "DepositBonusUse"("operationId");
CREATE TABLE "DepositBonusExpiry" (
 "checkoutId" TEXT PRIMARY KEY REFERENCES "DepositBonusLot"("checkoutId") ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 "amountCents" BIGINT NOT NULL CHECK("amountCents">=0),"journalId" TEXT UNIQUE REFERENCES "Journal"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(("amountCents"=0)=("journalId" IS NULL)));

CREATE FUNCTION guard_deposit_bonus_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q jsonb; p "DepositBonusPolicy"%ROWTYPE; expected bigint;quoted timestamp(3);
BEGIN
 q:=NEW.initialization->'depositBonus';IF q IS NULL OR q='null'::jsonb THEN RETURN NEW;END IF;
 quoted:=(q->>'quotedAt')::timestamptz AT TIME ZONE 'UTC';
 SELECT * INTO p FROM "DepositBonusPolicy" WHERE id='default' FOR SHARE;
 expected:=LEAST(NEW."amountCents"*p.percent/100,COALESCE(p."maxBonusCents",NEW."amountCents"));
 IF NEW.purpose<>'TOP_UP' OR NEW."flowVersion"<>4 OR p.id IS NULL OR NOT p.enabled OR NEW."amountCents"<p."minCents"
  OR quoted IS NULL OR quoted<date_trunc('milliseconds',transaction_timestamp() AT TIME ZONE 'UTC') OR quoted>clock_timestamp() AT TIME ZONE 'UTC'
  OR quoted<(clock_timestamp() AT TIME ZONE 'UTC')-interval '30 seconds' OR p."endsAt" IS NOT NULL AND p."endsAt"<=quoted
  OR (q->>'policyVersion')::integer IS DISTINCT FROM p.version OR (q->>'percent')::integer IS DISTINCT FROM p.percent
  OR (q->>'minAmountCents')::bigint IS DISTINCT FROM p."minCents" OR (q->>'maxBonusCents')::bigint IS DISTINCT FROM p."maxBonusCents"
  OR (q->>'validityDays')::integer IS DISTINCT FROM p."validityDays" OR (q->>'endsAt')::timestamp IS DISTINCT FROM p."endsAt"
  OR (q->>'amountCents')::bigint IS DISTINCT FROM expected OR expected<=0 OR q->>'quotedAt' IS NULL
 THEN RAISE EXCEPTION 'Deposit bonus quote does not match the active policy';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_bonus_quote BEFORE INSERT ON "ChapaCheckout" FOR EACH ROW EXECUTE FUNCTION guard_deposit_bonus_quote();

CREATE FUNCTION assert_deposit_bonus_wallet(uid text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE projected numeric; actual numeric;
BEGIN
 SELECT COALESCE((SELECT balance*100 FROM "LedgerAccount" WHERE name='user:'||uid||':bonus'),0) INTO projected;
 SELECT COALESCE(sum(l."amountCents"-COALESCE(u.used,0)-COALESCE(e."amountCents",0)),0) INTO actual
 FROM "DepositBonusLot" l LEFT JOIN LATERAL(SELECT sum("amountCents") AS used FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId") u ON true
 LEFT JOIN "DepositBonusExpiry" e ON e."checkoutId"=l."checkoutId" WHERE l."userId"=uid;
 IF projected<>actual OR EXISTS(SELECT 1 FROM "DepositBonusLot" l WHERE l."userId"=uid AND l."amountCents"<
  COALESCE((SELECT sum(u."amountCents") FROM "DepositBonusUse" u WHERE u."checkoutId"=l."checkoutId"),0)+COALESCE((SELECT e."amountCents" FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId"),0))
 THEN RAISE EXCEPTION 'Deposit bonus lot balance mismatch';END IF;
END $$;

CREATE FUNCTION guard_deposit_bonus_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text;
BEGIN
 IF NEW.kind='BONUS' OR NEW.name ~ '^user:.*:bonus$' THEN
  SELECT "userId" INTO uid FROM "Wallet" WHERE id=NEW."walletId";
  IF uid IS NULL OR NEW.kind<>'BONUS' OR NEW.name IS DISTINCT FROM 'user:'||uid||':bonus'
  THEN RAISE EXCEPTION 'Deposit bonus account must match its wallet owner';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bonus_account_identity BEFORE INSERT ON "LedgerAccount" FOR EACH ROW EXECUTE FUNCTION guard_deposit_bonus_account();

CREATE FUNCTION assert_deposit_bonus_proof(op_id text) RETURNS void LANGUAGE plpgsql AS $$
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
   OR NOT EXISTS(SELECT 1 FROM "Auction" a JOIN "AuctionTerms" t ON t."auctionId"=a.id JOIN "Product" p ON p.id=a."productId" WHERE a.id=b."auctionId" AND t."ruleVersion"='lowest-unique-v4' AND NOT a."isDemo" AND a."testRunId" IS NULL AND NOT p."isDemo")
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
   OR amount<>l."amountCents"-COALESCE((SELECT sum("amountCents") FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId"),0)
  THEN RAISE EXCEPTION 'Deposit bonus expiry does not match unused expired value';END IF;
 END IF;
 IF amount IS NULL OR amount<=0 OR (o.result->>'amountCents')::bigint IS DISTINCT FROM amount
  OR (SELECT count(*) FROM "Posting" WHERE "journalId"=j.id)<>2
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name=debit AND p.delta=-amount::numeric/100)
  OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name=credit AND p.delta=amount::numeric/100)
 THEN RAISE EXCEPTION 'Deposit bonus journal proof mismatch';END IF;
 PERFORM assert_deposit_bonus_wallet(uid);
END $$;

CREATE FUNCTION check_deposit_bonus() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op text;uid text;l "DepositBonusLot"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='Operation' THEN op:=NEW.id;
 ELSIF TG_TABLE_NAME='Journal' THEN op:=NEW."operationId";
 ELSIF TG_TABLE_NAME='LedgerAccount' THEN IF NEW.kind='BONUS' THEN SELECT "userId" INTO uid FROM "Wallet" WHERE id=NEW."walletId";PERFORM assert_deposit_bonus_wallet(uid);END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME='ChapaCheckout' THEN
  IF NEW."creditJournalId" IS NOT NULL AND NEW.initialization->'depositBonus' IS NOT NULL AND NEW.initialization->'depositBonus'<>'null'::jsonb THEN
   SELECT * INTO l FROM "DepositBonusLot" WHERE "checkoutId"=NEW.id;IF l."checkoutId" IS NULL THEN RAISE EXCEPTION 'Verified top-up is missing its promised bonus';END IF;
  END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME='DepositBonusUse' THEN op:=NEW."operationId";
 ELSE
  uid:=NEW."userId";
  IF NEW."journalId" IS NOT NULL THEN SELECT "operationId" INTO op FROM "Journal" WHERE id=NEW."journalId";
  ELSE
   SELECT * INTO l FROM "DepositBonusLot" WHERE "checkoutId"=NEW."checkoutId";
   IF NEW."userId" IS DISTINCT FROM l."userId" OR NEW."amountCents"<>0 OR NEW."createdAt"<l."expiresAt" OR NEW."createdAt">clock_timestamp() AT TIME ZONE 'UTC' OR l."amountCents"<>COALESCE((SELECT sum("amountCents") FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId"),0) THEN RAISE EXCEPTION 'Invalid exhausted bonus expiry';END IF;
  END IF;
  PERFORM assert_deposit_bonus_wallet(uid);
 END IF;
 IF op IS NOT NULL THEN PERFORM assert_deposit_bonus_proof(op);END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bonus_operation_proof AFTER INSERT ON "Operation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();
CREATE CONSTRAINT TRIGGER bonus_journal_proof AFTER INSERT ON "Journal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();
CREATE CONSTRAINT TRIGGER bonus_lot_proof AFTER INSERT ON "DepositBonusLot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();
CREATE CONSTRAINT TRIGGER bonus_use_proof AFTER INSERT ON "DepositBonusUse" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();
CREATE CONSTRAINT TRIGGER bonus_expiry_proof AFTER INSERT ON "DepositBonusExpiry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();
CREATE CONSTRAINT TRIGGER bonus_projection_proof AFTER INSERT OR UPDATE ON "LedgerAccount" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();
CREATE CONSTRAINT TRIGGER bonus_checkout_proof AFTER INSERT OR UPDATE ON "ChapaCheckout" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_deposit_bonus();

DO $$ DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['DepositBonusPolicy','DepositBonusLot','DepositBonusUse','DepositBonusExpiry'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER bonus_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change()',t);
  IF t='DepositBonusPolicy' THEN EXECUTE format('CREATE TRIGGER bonus_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',t);
  ELSE EXECUTE format('CREATE TRIGGER bonus_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',t);END IF;
  REVOKE ALL ON "DepositBonusPolicy","DepositBonusLot","DepositBonusUse","DepositBonusExpiry" FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);END IF;END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
   EXECUTE format('REVOKE ALL ON %I FROM lowwin_runtime',t);EXECUTE format('GRANT SELECT,INSERT ON %I TO lowwin_runtime',t);
   IF t='DepositBonusPolicy' THEN EXECUTE format('GRANT UPDATE ON %I TO lowwin_runtime',t);END IF;
   EXECUTE format('CREATE POLICY lowwin_server_access ON %I TO lowwin_runtime USING(true) WITH CHECK(true)',t);
  END IF;
 END LOOP;
END $$;
