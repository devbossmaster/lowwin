BEGIN;
ALTER TABLE "Category" ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE "StaffMember" (
 "userId" text PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 role text NOT NULL DEFAULT 'OWNER' CHECK(role='OWNER'), active boolean NOT NULL DEFAULT true,
 secret text, "lastCounter" bigint NOT NULL DEFAULT -1, "recoveryHashes" text[] NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "StaffSession" (
 "sessionId" text PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "credentialAt" timestamp(3) NOT NULL,"mfaAt" timestamp(3),"expiresAt" timestamp(3) NOT NULL,"pendingSecret" text,
 CHECK("expiresAt">"credentialAt"), CHECK("mfaAt" IS NULL OR "mfaAt">="credentialAt")
);
CREATE TABLE "StaffToken" (
 "tokenHash" text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('INVITE','RESET')),email text NOT NULL,
 "expiresAt" timestamp(3) NOT NULL,"usedAt" timestamp(3),"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StaffToken_email_kind_idx" ON "StaffToken"(email,kind);
CREATE TABLE "OwnerBootstrap" (id text PRIMARY KEY CHECK(id='owner'),"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "AdminAudit" (
 id text PRIMARY KEY,"actorId" text NOT NULL,action text NOT NULL,target text NOT NULL,details jsonb NOT NULL,
 "operationKey" text UNIQUE,"requestHash" text,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
CREATE TABLE "AuctionDraft" (
 "auctionId" text PRIMARY KEY REFERENCES "Auction"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version integer NOT NULL DEFAULT 1,body jsonb NOT NULL,"updatedAt" timestamp(3) NOT NULL
);
CREATE TABLE "ManagedMedia" (
 id text PRIMARY KEY,bytes bytea NOT NULL,mime text NOT NULL CHECK(mime='image/png'),
 "sourceType" text NOT NULL CHECK("sourceType" IN ('ORIGINAL','LICENSED','SUPPLIED')),
 "sourceCredit" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(octet_length(bytes) BETWEEN 1 AND 2097152)
);
CREATE TABLE "SiteContent" (id text PRIMARY KEY CHECK(id IN ('home','faq')),version integer NOT NULL DEFAULT 1,body jsonb NOT NULL,"updatedAt" timestamp(3) NOT NULL);
CREATE FUNCTION protect_admin_draft() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM "Auction" WHERE id=OLD."auctionId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "Auction" WHERE id=OLD."auctionId" AND "publishedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Published draft is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_admin_draft BEFORE UPDATE OR DELETE ON "AuctionDraft" FOR EACH ROW EXECUTE FUNCTION protect_admin_draft();
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['AdminAudit','OwnerBootstrap','ManagedMedia'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',item);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change()',item);
 END LOOP;
 FOREACH item IN ARRAY ARRAY['StaffMember','StaffSession','StaffToken','OwnerBootstrap','AdminAudit','AuctionDraft','ManagedMedia','SiteContent'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
 END LOOP;
END $$;
COMMIT;
