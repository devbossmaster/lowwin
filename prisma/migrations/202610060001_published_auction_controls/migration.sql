BEGIN;

-- Published identity stays frozen. A deadline change or removal of a cancelled
-- public page must have the matching immutable control revision in this same
-- transaction; the admin command writes that revision before updating Auction.
CREATE OR REPLACE FUNCTION protect_published_auction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL THEN
    IF NEW."endsAt" IS DISTINCT FROM OLD."endsAt" AND NOT (
      OLD.status IN ('LIVE', 'SCHEDULED')
      AND NEW."endsAt" IS NOT NULL
      AND NEW."startsAt" IS NOT NULL
      AND NEW."endsAt" > NEW."startsAt"
      AND NEW."endsAt" >= (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '5 minutes'
      AND EXISTS (
        SELECT 1 FROM "AuctionTerms" t
        WHERE t."auctionId" = OLD.id
          AND NEW."endsAt" <= COALESCE(t."publishedEndsAt", OLD."endsAt")
            + t."maxExtensionMinutes" * INTERVAL '1 minute'
          AND (NEW."endsAt" >= OLD."endsAt" OR OLD."acceptedBidCount" = 0
            OR (t."allowPaidShortening" AND NEW."endsAt" >=
              (clock_timestamp() AT TIME ZONE 'UTC')
                + t."shortenNoticeMinutes" * INTERVAL '1 minute'))
      )
      AND NEW."controlVersion" = OLD."controlVersion" + 1
      AND EXISTS (
        SELECT 1 FROM "AuctionControlRevision" r
        WHERE r."auctionId" = OLD.id
          AND r.version = NEW."controlVersion"
          AND r.kind = 'DEADLINE'
          AND (r."before"->>'endsAt')::timestamptz = (OLD."endsAt" AT TIME ZONE 'UTC')
          AND (r."after"->>'endsAt')::timestamptz = (NEW."endsAt" AT TIME ZONE 'UTC')
      )
    ) THEN
      RAISE EXCEPTION 'Published auction deadline requires a matching control revision';
    END IF;

    IF NEW.slug IS DISTINCT FROM OLD.slug AND NOT (
      OLD.status = 'CANCELLED'
      AND NEW.status = 'CANCELLED'
      AND NEW.slug IS NULL
      AND NEW.featured = false
      AND NEW."controlVersion" = OLD."controlVersion" + 1
      AND EXISTS (
        SELECT 1 FROM "AuctionControlRevision" r
        WHERE r."auctionId" = OLD.id
          AND r.version = NEW."controlVersion"
          AND r.kind = 'PRESENTATION'
          AND r."before"->>'publicSlug' = OLD.slug
          AND r."after"->>'publicSlug' IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'Published auction public page requires a matching control revision';
    END IF;

    IF NEW.id <> OLD.id OR NEW.code <> OLD.code
      OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
      OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
      OR NEW."isDemo" <> OLD."isDemo"
      OR NEW."isSettlementFixture" <> OLD."isSettlementFixture"
      OR NEW."fulfillmentSummary" IS DISTINCT FROM OLD."fulfillmentSummary"
      OR NEW."fulfillmentRegion" IS DISTINCT FROM OLD."fulfillmentRegion"
    THEN
      RAISE EXCEPTION 'Published auction schedule and identity are immutable';
    END IF;
  END IF;

  IF OLD.status IN ('CLOSED', 'CANCELLED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Terminal auction cannot reopen or change outcome';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
