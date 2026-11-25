BEGIN;

ALTER TABLE "AuctionControlRevision" DROP CONSTRAINT auction_control_revision_check;
ALTER TABLE "AuctionControlRevision" ADD CONSTRAINT auction_control_revision_check
  CHECK (version >= 1 AND kind IN ('FEE','DEADLINE','PRESENTATION','BIDDING_POLICY','START_TIME'));

CREATE OR REPLACE FUNCTION protect_published_auction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  checked_at timestamp;
BEGIN
  IF OLD."publishedAt" IS NOT NULL THEN
    IF NEW."startsAt" IS DISTINCT FROM OLD."startsAt" THEN
      checked_at := clock_timestamp() AT TIME ZONE 'UTC';
      IF NOT (
        OLD.status IN ('SCHEDULED', 'LIVE')
        AND NEW.status = OLD.status
        AND OLD."publishedAt" <= checked_at
        AND OLD."startsAt" IS NOT NULL
        AND OLD."startsAt" > checked_at
        AND OLD."endsAt" IS NOT NULL
        AND OLD."endsAt" > OLD."startsAt"
        AND NEW."startsAt" IS NOT NULL
        AND NEW."startsAt" > checked_at
        AND NEW."startsAt" < OLD."startsAt"
        AND NEW."endsAt" IS NOT DISTINCT FROM OLD."endsAt"
        AND OLD."acceptedBidCount" = 0
        AND NEW."acceptedBidCount" = OLD."acceptedBidCount"
        AND NEW."controlVersion" = OLD."controlVersion" + 1
        AND NOT EXISTS (SELECT 1 FROM "AuctionSettlement" WHERE "auctionId" = OLD.id)
        AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId" = OLD.id)
        AND EXISTS (
          SELECT 1 FROM "AuctionControlRevision" r
          JOIN "user" u ON u.id = r."actorId"
          JOIN "StaffMember" s ON s."userId" = u.id
          WHERE r."auctionId" = OLD.id
            AND r.version = NEW."controlVersion"
            AND r.kind = 'START_TIME'
            AND (r."before"->>'startsAt')::timestamptz = (OLD."startsAt" AT TIME ZONE 'UTC')
            AND (r."after"->>'startsAt')::timestamptz = (NEW."startsAt" AT TIME ZONE 'UTC')
            AND length(btrim(r.reason)) > 0
            AND u.role = 'admin' AND u."emailVerified" AND u."telegramId" IS NULL AND s.active
        )
      ) THEN
        RAISE EXCEPTION 'Published auction start time requires a matching control revision while upcoming';
      END IF;
    END IF;

    IF NEW."endsAt" IS DISTINCT FROM OLD."endsAt" THEN
      checked_at := clock_timestamp() AT TIME ZONE 'UTC';
      IF NOT (
        OLD.status IN ('LIVE', 'SCHEDULED')
        AND NEW."endsAt" IS NOT NULL
        AND NEW."startsAt" IS NOT NULL
        AND NEW."endsAt" > NEW."startsAt"
        AND NEW."endsAt" >= checked_at + INTERVAL '5 minutes'
        AND NEW."controlVersion" = OLD."controlVersion" + 1
        AND EXISTS (
          SELECT 1 FROM "AuctionTerms" t
          JOIN "AuctionControlRevision" r ON r."auctionId" = t."auctionId"
          WHERE t."auctionId" = OLD.id
            AND NEW."endsAt" <= COALESCE(t."publishedEndsAt", OLD."endsAt")
              + t."maxExtensionMinutes" * INTERVAL '1 minute'
            AND r.version = NEW."controlVersion"
            AND r.kind = 'DEADLINE'
            AND (r."before"->>'endsAt')::timestamptz = (OLD."endsAt" AT TIME ZONE 'UTC')
            AND (r."after"->>'endsAt')::timestamptz = (NEW."endsAt" AT TIME ZONE 'UTC')
            AND (
              NEW."endsAt" >= OLD."endsAt" OR OLD."acceptedBidCount" = 0
              OR (t."allowPaidShortening" AND NEW."endsAt" >=
                checked_at + t."shortenNoticeMinutes" * INTERVAL '1 minute')
              OR (
                NOT t."allowPaidShortening"
                AND OLD."endsAt" > checked_at
                AND r."after" @> '{"paidShorteningOverride":true}'::jsonb
                AND r."after"->>'overrideConfirmation' = OLD.code
                AND length(btrim(r.reason)) > 0
                AND NOT EXISTS (SELECT 1 FROM "AuctionSettlement" WHERE "auctionId" = OLD.id)
                AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId" = OLD.id)
                AND EXISTS (
                  SELECT 1 FROM "user" u
                  JOIN "StaffMember" s ON s."userId" = u.id
                  WHERE u.id = r."actorId" AND u.role = 'admin' AND u."emailVerified"
                    AND u."telegramId" IS NULL AND s.active
                )
              )
            )
        )
      ) THEN
        RAISE EXCEPTION 'Published auction deadline requires a matching control revision';
      END IF;
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
