ALTER TABLE "TopUpIntent" DROP CONSTRAINT topup_status;
ALTER TABLE "TopUpIntent" ADD CONSTRAINT topup_status CHECK(status IN ('PENDING','VERIFYING','CREDITED','NEEDS_REVIEW','REJECTED','DUPLICATE_CONFLICT','PROVIDER_OUTAGE','FAILED','REVERSED'));
ALTER TABLE "TopUpIntent"
 ADD COLUMN channel text, ADD COLUMN "expectedCents" bigint, ADD COLUMN "receivingAccount" text,
 ADD COLUMN "accountName" text, ADD COLUMN "quoteSnapshot" jsonb, ADD COLUMN "requestHash" text,
 ADD COLUMN "expiresAt" timestamp(3), ADD COLUMN reference text, ADD COLUMN attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN "scanAttempts" integer NOT NULL DEFAULT 0, ADD COLUMN "nextAttemptAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "leaseToken" text, ADD COLUMN "leaseUntil" timestamp(3), ADD COLUMN "reasonCode" text,
 ADD COLUMN "caseState" text NOT NULL DEFAULT 'OPEN', ADD COLUMN "assignedTo" text;
CREATE INDEX "TopUpIntent_status_createdAt_idx" ON "TopUpIntent"(status,"createdAt");
CREATE INDEX "TopUpIntent_userId_createdAt_idx" ON "TopUpIntent"("userId","createdAt");
CREATE TABLE "PaymentPolicy" (id text PRIMARY KEY,channel text NOT NULL CHECK(channel IN ('telebirr','cbe')),version integer NOT NULL,
 enabled boolean NOT NULL,account text NOT NULL,"accountName" text NOT NULL,"pointsNumerator" bigint NOT NULL CHECK("pointsNumerator">0),
 "centsDenominator" bigint NOT NULL CHECK("centsDenominator">0),"minCents" bigint NOT NULL CHECK("minCents">0),"maxCents" bigint NOT NULL CHECK("maxCents">="minCents"),
 terms text NOT NULL,"reviewReference" text NOT NULL,"actorId" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(channel,version));
CREATE TABLE "PaymentClaim" (id text PRIMARY KEY,channel text NOT NULL,reference text NOT NULL,
 "intentId" text NOT NULL UNIQUE REFERENCES "TopUpIntent"(id),"userId" text NOT NULL REFERENCES "user"(id),
 "amountCents" bigint NOT NULL CHECK("amountCents">0),points bigint NOT NULL CHECK(points>0),"receiverSuffix" text NOT NULL,
 "transferredAt" timestamp(3) NOT NULL,"operationId" text NOT NULL UNIQUE REFERENCES "Operation"(id),"journalId" text NOT NULL UNIQUE REFERENCES "Journal"(id),
 "evidenceHash" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(channel,reference));

CREATE TABLE "PaymentAttempt" (id text PRIMARY KEY,"intentId" text NOT NULL REFERENCES "TopUpIntent"(id),key text NOT NULL,"requestHash" text NOT NULL,
 code text NOT NULL,evidence jsonb NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("intentId",key));
CREATE TABLE "PaymentStatementEntry" (id text PRIMARY KEY,channel text NOT NULL,reference text NOT NULL,"amountCents" bigint NOT NULL,
 "receiverSuffix" text NOT NULL,"transferredAt" timestamp(3) NOT NULL,"evidenceReference" text NOT NULL,status text NOT NULL,
 "intentId" text REFERENCES "TopUpIntent"(id),"actorId" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "PaymentStatementEntry_status_createdAt_idx" ON "PaymentStatementEntry"(status,"createdAt");
CREATE FUNCTION protect_topup_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Top-up records cannot be removed'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','journalId','reference','attempts','scanAttempts','nextAttemptAt','leaseToken','leaseUntil','reasonCode','caseState','assignedTo']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','journalId','reference','attempts','scanAttempts','nextAttemptAt','leaseToken','leaseUntil','reasonCode','caseState','assignedTo']) THEN
   RAISE EXCEPTION 'Top-up quote and identity are immutable'; END IF;
 IF OLD.reference IS NOT NULL AND NEW.reference IS DISTINCT FROM OLD.reference THEN RAISE EXCEPTION 'Top-up reference is immutable once submitted'; END IF;
 IF OLD."journalId" IS NOT NULL AND (NEW."journalId" IS DISTINCT FROM OLD."journalId" OR NEW.status<>OLD.status) THEN RAISE EXCEPTION 'Credited receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER topup_immutable BEFORE UPDATE OR DELETE ON "TopUpIntent" FOR EACH ROW EXECUTE FUNCTION protect_topup_intent();
CREATE TRIGGER topup_no_truncate BEFORE TRUNCATE ON "TopUpIntent" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION check_topup_credit() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r record; BEGIN
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
CREATE CONSTRAINT TRIGGER topup_credit_guard AFTER INSERT OR UPDATE ON "TopUpIntent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_topup_credit();
CREATE CONSTRAINT TRIGGER claim_credit_guard AFTER INSERT ON "PaymentClaim" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_topup_credit();
CREATE FUNCTION check_topup_journal_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='TOPUP_CREDIT' AND NOT EXISTS(SELECT 1 FROM "PaymentClaim" WHERE "journalId"=NEW.id) THEN RAISE EXCEPTION 'Top-up journal requires an immutable verified claim'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_claim_guard AFTER INSERT ON "Journal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_topup_journal_claim();
DO $$ DECLARE item text; BEGIN FOREACH item IN ARRAY ARRAY['PaymentPolicy','PaymentClaim','PaymentAttempt','PaymentStatementEntry'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',item);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change()',item);
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
 END LOOP; END $$;
