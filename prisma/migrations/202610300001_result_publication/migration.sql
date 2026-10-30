-- Preserve all results that were publicly visible before this deployment.
-- This backfill deliberately creates no notification or campaign intents.
CREATE TABLE "ResultPublication" (
  "settlementId" TEXT NOT NULL PRIMARY KEY REFERENCES "AuctionSettlement"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "publishedAt" TIMESTAMP(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  "actorId" TEXT,
  "proofHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "historical" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "ResultPublication" ("settlementId","publishedAt","proofHash",reason,historical)
SELECT id,"completedAt",'historical','Preserved previously public result',true FROM "AuctionSettlement";

CREATE TRIGGER result_publication_immutable BEFORE UPDATE OR DELETE ON "ResultPublication"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER result_publication_no_truncate BEFORE TRUNCATE ON "ResultPublication"
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

ALTER TABLE "ResultPublication" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ResultPublication" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ResultPublication" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ResultPublication" FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT,INSERT ON "ResultPublication" TO lowwin_runtime;
  CREATE POLICY lowwin_server_access ON "ResultPublication" TO lowwin_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;
