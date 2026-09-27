BEGIN;
CREATE TABLE "PlayerProfile" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "displayName" TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT player_display_length CHECK (char_length(trim("displayName")) BETWEEN 1 AND 60 AND char_length(bio)<=160)
);
CREATE TABLE "AuctionFavorite" (
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "auctionId" TEXT NOT NULL REFERENCES "Auction"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId","auctionId")
);
CREATE INDEX "AuctionFavorite_userId_createdAt_idx" ON "AuctionFavorite"("userId","createdAt");
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['PlayerProfile','AuctionFavorite'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',item); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',item); END IF;
  END LOOP;
END $$;
COMMIT;
