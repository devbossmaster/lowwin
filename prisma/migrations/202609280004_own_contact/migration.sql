ALTER TABLE "BotUpdate" ADD COLUMN "botId" TEXT;
CREATE TABLE "TelegramOwnContact" (
 "id" TEXT PRIMARY KEY, "telegramId" TEXT NOT NULL, "botId" TEXT NOT NULL,
 "userId" TEXT UNIQUE REFERENCES "user"("id") ON DELETE RESTRICT,
 "phoneHash" TEXT NOT NULL UNIQUE, "phoneCipher" TEXT NOT NULL,
 "lastFour" TEXT NOT NULL CHECK ("lastFour" ~ '^[0-9]{4}$'),
 "verifiedAt" TIMESTAMP(3) NOT NULL, "sourceUpdateId" BIGINT NOT NULL UNIQUE,
 "revokedAt" TIMESTAMP(3), UNIQUE("botId","telegramId")
);
CREATE TABLE "ContactEvent" (
 "id" TEXT PRIMARY KEY,"botId" TEXT NOT NULL,"telegramId" TEXT NOT NULL,
 "updateId" BIGINT NOT NULL UNIQUE,"outcome" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "ContactEvent" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON "ContactEvent" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE "TelegramOwnContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactEvent" ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r TEXT; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "TelegramOwnContact","ContactEvent" FROM %I',r);
 END IF; END LOOP;
END $$;
