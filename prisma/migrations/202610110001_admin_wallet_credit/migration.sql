BEGIN;
-- Additive migration. Admin-issued funds are distinct from verified bank transfers.
CREATE TABLE "AdminWalletCredit" (
 id text PRIMARY KEY,
 "intentId" text NOT NULL UNIQUE REFERENCES "TopUpIntent"(id),
 "sourceIntentId" text NOT NULL UNIQUE REFERENCES "TopUpIntent"(id),
 "userId" text NOT NULL REFERENCES "user"(id),
 "actorId" text NOT NULL REFERENCES "user"(id),
 "amountCents" bigint NOT NULL CHECK ("amountCents" BETWEEN 1 AND 1000000),
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
 channel text, reference text,
 "operationId" text NOT NULL UNIQUE REFERENCES "Operation"(id),
 "journalId" text NOT NULL UNIQUE REFERENCES "Journal"(id),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(channel,reference),
 CHECK ((channel IS NULL AND reference IS NULL) OR (channel IN ('telebirr','cbe','mpesa') AND reference IS NOT NULL))
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "AdminWalletCredit" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON "AdminWalletCredit" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE "AdminWalletCredit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AdminWalletCredit" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON "AdminWalletCredit" FROM %I',role_name); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT,INSERT ON "AdminWalletCredit" TO lowwin_runtime;
  CREATE POLICY lowwin_server_access ON "AdminWalletCredit" TO lowwin_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;

CREATE FUNCTION validate_admin_wallet_credit(target_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 SELECT c.*, t.status,t.provider,t.points,t."expectedCents",t."journalId" AS "intentJournal",t."userId" AS "intentUser",
  t.reference AS "intentReference",s.status AS "sourceStatus",s."userId" AS "sourceUser",s."reasonCode" AS "sourceReason",s."journalId" AS "sourceJournal"
 INTO r FROM "TopUpIntent" t LEFT JOIN "AdminWalletCredit" c ON c."intentId"=t.id
 LEFT JOIN "TopUpIntent" s ON s.id=c."sourceIntentId" WHERE t.id=target_id;
 IF NOT FOUND OR r.id IS NULL OR r.provider<>'ADMIN_CREDIT' OR r.status<>'CREDITED'
  OR r."intentUser" IS DISTINCT FROM r."userId" OR r."sourceUser" IS DISTINCT FROM r."userId"
  OR r."expectedCents" IS DISTINCT FROM r."amountCents" OR r.points IS DISTINCT FROM (r."amountCents"::numeric/100)
  OR r."intentJournal" IS DISTINCT FROM r."journalId" OR r."intentReference" IS DISTINCT FROM r.reference
  OR r."sourceStatus" IS DISTINCT FROM 'REJECTED' OR r."sourceReason" IS DISTINCT FROM 'ADMIN_CREDIT_REPLACEMENT' OR r."sourceJournal" IS NOT NULL
  OR EXISTS(SELECT 1 FROM "PaymentClaim" WHERE "intentId" IN (target_id,r."sourceIntentId"))
 THEN RAISE EXCEPTION 'Admin credit receipt mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Journal" j JOIN "Operation" o ON o.id=j."operationId"
  JOIN "AdminAudit" a ON a."requestHash"=o."requestHash" AND a.target=r."sourceIntentId"
  WHERE j.id=r."journalId" AND j.kind='ADMIN_CREDIT' AND o.id=r."operationId" AND o.scope='ADMIN_CREDIT'
  AND o."userId"=r."userId" AND o.key=r."sourceIntentId" AND a."actorId"=r."actorId" AND a.action='PAYMENT_ADD_FUNDS')
 THEN RAISE EXCEPTION 'Admin credit journal or audit mismatch'; END IF;
 IF (SELECT COALESCE(SUM(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=r."journalId" AND a.name='user:'||r."userId"||':available')<>r.points OR
    (SELECT COALESCE(SUM(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=r."journalId" AND a.name='platform:issuance')<>-r.points OR
    (SELECT COUNT(*) FROM "Posting" WHERE "journalId"=r."journalId")<>2
 THEN RAISE EXCEPTION 'Admin credit postings mismatch'; END IF;
END $$;

CREATE OR REPLACE FUNCTION check_topup_credit() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r record; target_id text; BEGIN
 target_id := COALESCE(to_jsonb(NEW)->>'intentId',to_jsonb(NEW)->>'id');
 IF EXISTS(SELECT 1 FROM "TopUpIntent" WHERE id=target_id AND provider='ADMIN_CREDIT') THEN
  PERFORM validate_admin_wallet_credit(target_id); RETURN NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM "AdminWalletCredit" c JOIN "TopUpIntent" t ON t.id=c."sourceIntentId" WHERE t.id=target_id AND (t.status<>'REJECTED' OR t."journalId" IS NOT NULL OR t."reasonCode" IS DISTINCT FROM 'ADMIN_CREDIT_REPLACEMENT')) THEN
  RAISE EXCEPTION 'Deposit already resolved by admin credit';
 END IF;
 SELECT t.*,c.points AS "claimPoints",c."journalId" AS "claimJournal",c."userId" AS "claimUser",c."amountCents" AS "claimCents",c.channel AS "claimChannel",c.reference AS "claimReference",c."operationId" AS "claimOperation" INTO r
 FROM "TopUpIntent" t LEFT JOIN "PaymentClaim" c ON c."intentId"=t.id WHERE t.id=COALESCE(to_jsonb(NEW)->>'intentId',to_jsonb(NEW)->>'id');
 IF r.status='CREDITED' OR r."claimJournal" IS NOT NULL THEN
  IF r.status<>'CREDITED' OR r."journalId" IS DISTINCT FROM r."claimJournal" OR r.points IS DISTINCT FROM r."claimPoints" OR r."userId" IS DISTINCT FROM r."claimUser" OR r."expectedCents" IS DISTINCT FROM r."claimCents" OR r.channel IS DISTINCT FROM r."claimChannel" OR r.reference IS DISTINCT FROM r."claimReference" THEN RAISE EXCEPTION 'Top-up claim mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "Journal" j JOIN "Operation" o ON o.id=j."operationId" WHERE j.id=r."journalId" AND j.kind='TOPUP_CREDIT' AND o.id=r."claimOperation" AND o."userId"=r."userId" AND o.scope='TOPUP_CREDIT') THEN RAISE EXCEPTION 'Top-up journal mismatch'; END IF;
  IF (SELECT COALESCE(SUM(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=r."journalId" AND a.name='user:'||r."userId"||':available')<>r.points OR
     (SELECT COALESCE(SUM(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=r."journalId" AND a.name='platform:issuance')<>-r.points OR
     (SELECT COUNT(*) FROM "Posting" WHERE "journalId"=r."journalId")<>2 THEN RAISE EXCEPTION 'Top-up postings mismatch'; END IF;
 END IF; RETURN NULL;
END $$;

CREATE FUNCTION check_admin_wallet_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM validate_admin_wallet_credit(NEW."intentId"); RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER admin_credit_guard AFTER INSERT ON "AdminWalletCredit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_admin_wallet_credit();
CREATE OR REPLACE FUNCTION check_topup_journal_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='TOPUP_CREDIT' AND NOT EXISTS(SELECT 1 FROM "PaymentClaim" WHERE "journalId"=NEW.id) THEN RAISE EXCEPTION 'Top-up journal requires an immutable verified claim'; END IF;
 IF NEW.kind='ADMIN_CREDIT' AND NOT EXISTS(SELECT 1 FROM "AdminWalletCredit" WHERE "journalId"=NEW.id) THEN RAISE EXCEPTION 'Admin credit requires an immutable admin receipt'; END IF;
 RETURN NULL;
END $$;

-- Both paths share transfer locks and reject references already credited by the other.
CREATE FUNCTION protect_admin_credit_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bank text; ref text;
BEGIN
 bank := NEW.channel; ref := COALESCE(to_jsonb(NEW)->>'reference',to_jsonb(NEW)->>'alias');
 IF ref IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('transfer:'||bank||':'||ref,0));
 IF TG_TABLE_NAME='AdminWalletCredit' THEN
  IF EXISTS(SELECT 1 FROM "PaymentClaim" WHERE channel=bank AND reference=ref)
   OR EXISTS(SELECT 1 FROM "PaymentTransferAlias" WHERE channel=bank AND alias=ref)
  THEN RAISE EXCEPTION 'Transaction ID already credited'; END IF;
 ELSIF EXISTS(SELECT 1 FROM "AdminWalletCredit" WHERE channel=bank AND reference=ref) THEN
  RAISE EXCEPTION 'Transaction ID already credited by admin';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_credit_reference_guard BEFORE INSERT ON "AdminWalletCredit" FOR EACH ROW EXECUTE FUNCTION protect_admin_credit_reference();
CREATE TRIGGER claim_admin_reference_guard BEFORE INSERT ON "PaymentClaim" FOR EACH ROW EXECUTE FUNCTION protect_admin_credit_reference();
CREATE TRIGGER alias_admin_reference_guard BEFORE INSERT ON "PaymentTransferAlias" FOR EACH ROW EXECUTE FUNCTION protect_admin_credit_reference();

COMMIT;
