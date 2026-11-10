BEGIN;

-- This immutable database-clock cutover prevents historical mass broadcasts.
CREATE TABLE "ResultPublicationPolicy" (
  id text PRIMARY KEY CHECK (id='auto'),
  "automaticFrom" timestamp(6) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
INSERT INTO "ResultPublicationPolicy" (id) VALUES ('auto');
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON "ResultPublicationPolicy"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON "ResultPublicationPolicy"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE "ResultPublicationPolicy" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ResultPublicationPolicy" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ResultPublicationPolicy" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ResultPublicationPolicy" FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT SELECT ON "ResultPublicationPolicy" TO lowwin_runtime;
  CREATE POLICY lowwin_server_read ON "ResultPublicationPolicy" TO lowwin_runtime USING (true);
 END IF;
END $$;
ALTER TABLE "Auction" ADD COLUMN "publicationAttempts" integer NOT NULL DEFAULT 0 CHECK ("publicationAttempts">=0),
 ADD COLUMN "nextPublicationAttemptAt" timestamp(3), ADD COLUMN "publicationErrorCode" text;
CREATE INDEX "Auction_status_nextPublicationAttemptAt_idx" ON "Auction"(status,"nextPublicationAttemptAt");

-- Historical imageId records retain their right-hand photograph semantics.
ALTER TABLE "WinnerPresentation" ADD COLUMN "presentationMode" text NOT NULL DEFAULT 'PHOTO'
 CHECK ("presentationMode" IN ('PRODUCT','PHOTO','BANNER')),
 ADD COLUMN "bannerImageId" text REFERENCES "ManagedMedia"(id) ON DELETE RESTRICT,
 ADD COLUMN "bannerConsentConfirmedAt" timestamp(3),
 ADD COLUMN "bannerConsentActorId" text REFERENCES "user"(id) ON DELETE RESTRICT,
 ADD CONSTRAINT "WinnerPresentation_banner_consent_check" CHECK (
  ("bannerImageId" IS NULL AND "bannerConsentConfirmedAt" IS NULL AND "bannerConsentActorId" IS NULL AND "presentationMode"<>'BANNER')
  OR ("bannerImageId" IS NOT NULL AND "bannerConsentConfirmedAt" IS NOT NULL AND "bannerConsentActorId" IS NOT NULL AND "presentationMode"='BANNER')
 );
CREATE INDEX "WinnerPresentation_bannerImageId_idx" ON "WinnerPresentation"("bannerImageId");
ALTER TABLE "ManagedMedia" DROP CONSTRAINT "ManagedMedia_purpose_check", DROP CONSTRAINT "ManagedMedia_mime_check";
ALTER TABLE "ManagedMedia" ADD CONSTRAINT "ManagedMedia_purpose_check" CHECK (purpose IN ('CATALOG','WINNER_PHOTO','WINNER_BANNER')),
 ADD CONSTRAINT "ManagedMedia_mime_check" CHECK ((purpose='WINNER_BANNER' AND mime='image/webp') OR (purpose IN ('CATALOG','WINNER_PHOTO') AND mime='image/png'));

CREATE OR REPLACE FUNCTION guard_winner_presentation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Winner presentation history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW."auctionId"<>OLD."auctionId" OR NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION 'Winner presentation identity is immutable and version must advance';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM "Auction" a JOIN "AuctionSettlement" s ON s."auctionId"=a.id
  WHERE a.id=NEW."auctionId" AND a.status='CLOSED' AND NOT a."isDemo" AND a."testRunId" IS NULL
   AND a."publishedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND s.outcome='WINNER' AND s."winnerUserId" IS NOT NULL
   AND s."completedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
 ) THEN RAISE EXCEPTION 'A genuine settled winner is required for announcement media'; END IF;
 IF NEW."imageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ManagedMedia" m WHERE m.id=NEW."imageId" AND m.purpose='WINNER_PHOTO') THEN
  RAISE EXCEPTION 'Historical winner photos require purpose-bound media';
 END IF;
 IF NEW."bannerImageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ManagedMedia" m WHERE m.id=NEW."bannerImageId" AND m.purpose='WINNER_BANNER' AND m.mime='image/webp') THEN
  RAISE EXCEPTION 'Winner banners require validated purpose-bound WebP media';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_winner_photo_product_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE media_id text;
BEGIN
 media_id:=substring(NEW.path FROM '^/api/media/([0-9a-fA-F-]{36})');
 IF EXISTS (SELECT 1 FROM "ManagedMedia" m WHERE lower(m.id)=lower(media_id) AND m.purpose IN ('WINNER_PHOTO','WINNER_BANNER')) THEN
  RAISE EXCEPTION 'Winner presentation media cannot become catalog product images';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_winner_photo_presentation_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE image jsonb; media_id text;
BEGIN
 IF jsonb_typeof(NEW.presentation->'images') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
 FOR image IN SELECT value FROM jsonb_array_elements(NEW.presentation->'images') LOOP
  media_id:=substring(image->>'path' FROM '^/api/media/([0-9a-fA-F-]{36})');
  IF EXISTS (SELECT 1 FROM "ManagedMedia" m WHERE lower(m.id)=lower(media_id) AND m.purpose IN ('WINNER_PHOTO','WINNER_BANNER')) THEN
   RAISE EXCEPTION 'Winner presentation media cannot become frozen auction images';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

COMMIT;
