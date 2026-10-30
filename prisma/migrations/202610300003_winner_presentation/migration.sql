-- Announcement media can change without rewriting settled auction or money facts.
-- Existing immutable uploads remain catalog assets. Purpose cannot be changed
-- later because ManagedMedia's existing immutable_record trigger rejects UPDATE.
ALTER TABLE "ManagedMedia" ADD COLUMN purpose text NOT NULL DEFAULT 'CATALOG'
  CHECK (purpose IN ('CATALOG','WINNER_PHOTO'));
CREATE TABLE "WinnerPresentation" (
  "auctionId" text PRIMARY KEY REFERENCES "Auction"(id) ON DELETE RESTRICT,
  "imageId" text REFERENCES "ManagedMedia"(id) ON DELETE RESTRICT,
  "consentConfirmedAt" timestamp(3),
  "consentActorId" text REFERENCES "user"(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "WinnerPresentation_photo_consent_check" CHECK (
    ("imageId" IS NULL AND "consentConfirmedAt" IS NULL AND "consentActorId" IS NULL)
    OR ("imageId" IS NOT NULL AND "consentConfirmedAt" IS NOT NULL AND "consentActorId" IS NOT NULL)
  )
);
CREATE INDEX "WinnerPresentation_imageId_idx" ON "WinnerPresentation"("imageId");

CREATE FUNCTION guard_winner_presentation() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW."imageId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ManagedMedia" m WHERE m.id=NEW."imageId" AND m.purpose='WINNER_PHOTO'
  ) THEN RAISE EXCEPTION 'Winner announcements require purpose-bound winner media'; END IF;
  RETURN NEW;
END $$;

-- Purpose-bound personal photos must never gain a permanent public-product link.
CREATE FUNCTION guard_winner_photo_product_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE media_id text;
BEGIN
  media_id:=substring(NEW.path FROM '^/api/media/([0-9a-fA-F-]{36})');
  IF EXISTS (SELECT 1 FROM "ManagedMedia" m WHERE lower(m.id)=lower(media_id) AND m.purpose='WINNER_PHOTO') THEN
    RAISE EXCEPTION 'Winner photos cannot become catalog product images';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER winner_photo_product_link_guard BEFORE INSERT OR UPDATE ON "ProductImage"
  FOR EACH ROW EXECUTE FUNCTION guard_winner_photo_product_link();

CREATE FUNCTION guard_winner_photo_presentation_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE image jsonb; media_id text;
BEGIN
  IF jsonb_typeof(NEW.presentation->'images') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  FOR image IN SELECT value FROM jsonb_array_elements(NEW.presentation->'images') LOOP
    media_id:=substring(image->>'path' FROM '^/api/media/([0-9a-fA-F-]{36})');
    IF EXISTS (SELECT 1 FROM "ManagedMedia" m WHERE lower(m.id)=lower(media_id) AND m.purpose='WINNER_PHOTO') THEN
      RAISE EXCEPTION 'Winner photos cannot become frozen auction presentation images';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER winner_photo_presentation_link_guard BEFORE INSERT OR UPDATE OF presentation ON "Auction"
  FOR EACH ROW EXECUTE FUNCTION guard_winner_photo_presentation_link();
CREATE TRIGGER winner_presentation_guard BEFORE INSERT OR UPDATE OR DELETE ON "WinnerPresentation"
  FOR EACH ROW EXECUTE FUNCTION guard_winner_presentation();
ALTER TABLE "WinnerPresentation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "WinnerPresentation" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "WinnerPresentation" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "WinnerPresentation" FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON "WinnerPresentation" TO lowwin_runtime;
    CREATE POLICY lowwin_server_access ON "WinnerPresentation" TO lowwin_runtime USING (true) WITH CHECK (true);
  END IF;
END $$;
