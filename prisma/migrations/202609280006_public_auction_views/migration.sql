-- Public auction impressions are aggregate-only. No viewer identity, IP address,
-- user agent, or Telegram identifier is stored.
ALTER TABLE "Auction"
ADD COLUMN "publicViewCount" BIGINT NOT NULL DEFAULT 0;
