BEGIN;
ALTER TABLE "StaffMember" DROP CONSTRAINT "StaffMember_role_check";
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_role_check" CHECK(role IN ('OWNER','CATALOG_MANAGER','SUPPORT','FULFILLMENT','PAYMENTS_OPERATOR','AUDITOR'));
ALTER TABLE "StaffToken" ADD COLUMN role text NOT NULL DEFAULT 'OWNER' CHECK(role IN ('OWNER','CATALOG_MANAGER','SUPPORT','FULFILLMENT','PAYMENTS_OPERATOR','AUDITOR'));
ALTER TABLE "Outbox" ADD COLUMN state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENT','SKIPPED','FAILED')),
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), ADD COLUMN "nextAttemptAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "lastError" text;
CREATE INDEX "Outbox_dispatch_idx" ON "Outbox"(state,"nextAttemptAt");
CREATE TABLE "UserRestriction" ("userId" text PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT,suspended boolean NOT NULL DEFAULT false,reason text NOT NULL,"updatedAt" timestamp(3) NOT NULL);
CREATE TABLE "SupportCase" (id text PRIMARY KEY,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,subject text NOT NULL,message text NOT NULL,status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','INVESTIGATING','RESOLVED')),resolution text NOT NULL DEFAULT '',"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamp(3) NOT NULL);
CREATE INDEX "SupportCase_userId_createdAt_idx" ON "SupportCase"("userId","createdAt");
CREATE TABLE "FulfillmentCase" ("auctionId" text PRIMARY KEY REFERENCES "Auction"(id) ON DELETE RESTRICT,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,"assignedTo" text REFERENCES "StaffMember"("userId") ON DELETE RESTRICT,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CLAIMED','PACKING','SHIPPED','DELIVERED','DISPUTED')),"contactCipher" text,tracking text NOT NULL DEFAULT '',note text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,"deliveredAt" timestamp(3),"contactDeleteAt" timestamp(3),"updatedAt" timestamp(3) NOT NULL);
CREATE TABLE "NotificationPreference" ("userId" text PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT,"inApp" boolean NOT NULL DEFAULT true,telegram boolean NOT NULL DEFAULT false,"auctionStart" boolean NOT NULL DEFAULT true,"favoriteEnding" boolean NOT NULL DEFAULT true,fulfillment boolean NOT NULL DEFAULT true);
CREATE TABLE "NotificationInbox" (id text PRIMARY KEY,key text NOT NULL UNIQUE,"userId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,kind text NOT NULL,title text NOT NULL,body text NOT NULL,href text NOT NULL,"readAt" timestamp(3),"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "NotificationInbox_userId_createdAt_idx" ON "NotificationInbox"("userId","createdAt");
CREATE TABLE "BotChat" ("telegramId" text PRIMARY KEY,"chatId" text NOT NULL UNIQUE,"startedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,blocked boolean NOT NULL DEFAULT false,CHECK("telegramId"="chatId" AND "telegramId" ~ '^[1-9][0-9]*$'));
-- All intents, including new bid and fulfillment intents, retain immutable identity/content.
CREATE OR REPLACE FUNCTION protect_settlement_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.key<>OLD.key OR NEW.kind<>OLD.kind OR NEW.payload<>OLD.payload OR NEW."createdAt"<>OLD."createdAt" OR NEW."settlementId" IS DISTINCT FROM OLD."settlementId" THEN RAISE EXCEPTION 'Notification intent is immutable'; END IF;
 RETURN NEW;
END $$;
-- Serialized last-Owner protection also covers accidental direct runtime SQL.
CREATE FUNCTION protect_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.role='OWNER' AND OLD.active AND (TG_OP='DELETE' OR NEW.role<>'OWNER' OR NOT NEW.active) THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('admin:team',0)); END IF;
 IF OLD.role='OWNER' AND OLD.active AND (TG_OP='DELETE' OR NEW.role<>'OWNER' OR NOT NEW.active) AND NOT EXISTS(SELECT 1 FROM "StaffMember" WHERE role='OWNER' AND active AND "userId"<>OLD."userId") THEN RAISE EXCEPTION 'Cannot remove last active Owner'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_last_owner BEFORE UPDATE OR DELETE ON "StaffMember" FOR EACH ROW EXECUTE FUNCTION protect_last_owner();
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['UserRestriction','SupportCase','FulfillmentCase','NotificationPreference','NotificationInbox','BotChat'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
 END LOOP;
END $$;
COMMIT;
