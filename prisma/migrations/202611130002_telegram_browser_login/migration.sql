-- A web login uses Telegram's signed OIDC phone proof, never an invented bot
-- update. Existing contact and session rows retain their original semantics.
ALTER TABLE "session" ADD COLUMN "telegramAuthSource" TEXT NOT NULL DEFAULT 'MINI_APP';
ALTER TABLE "session" ADD CONSTRAINT "session_telegram_auth_source" CHECK ("telegramAuthSource" IN ('MINI_APP','TELEGRAM_OIDC'));
ALTER TABLE "TelegramOwnContact" ALTER COLUMN "sourceUpdateId" DROP NOT NULL;
ALTER TABLE "TelegramOwnContact" ADD COLUMN "verificationSource" TEXT NOT NULL DEFAULT 'BOT_CONTACT';
ALTER TABLE "TelegramOwnContact" ADD COLUMN "oidcIssuer" TEXT;
ALTER TABLE "TelegramOwnContact" ADD COLUMN "oidcSubject" TEXT;
ALTER TABLE "TelegramOwnContact" ADD CONSTRAINT "telegram_contact_proof_source" CHECK (
 ("verificationSource"='BOT_CONTACT' AND "sourceUpdateId" IS NOT NULL AND "oidcIssuer" IS NULL AND "oidcSubject" IS NULL)
 OR
 ("verificationSource"='TELEGRAM_OIDC' AND "sourceUpdateId" IS NULL AND "oidcIssuer" IS NOT NULL AND "oidcIssuer"='https://oauth.telegram.org' AND "oidcSubject" IS NOT NULL AND length("oidcSubject") BETWEEN 1 AND 200)
);
