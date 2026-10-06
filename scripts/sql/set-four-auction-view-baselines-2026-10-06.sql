-- One-time production Supabase SQL Editor correction for views lost in the relist.
-- These owner-provided baselines are estimates, not recovered per-view records.
-- A count already above its baseline is preserved; new verified views add normally.
-- Run this whole file once. Do not rerun the relist or start-correction scripts.
BEGIN;
SET LOCAL search_path = public, pg_temp;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE "Auction", "AdminAudit" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _view_baselines (
  "publicCode" integer PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  target bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO _view_baselines ("publicCode", code, title, target) VALUES
  (1, 'LW-4300B65D-227', 'Samsung Galaxy A07 — 4GB RAM / 64GB — Black', 300),
  (2, 'LW-82326704-F19', 'Anker 20,000mAh 87W Power Bank with Built-in USB-C Cable — Black', 240),
  (3, 'LW-C3F0778E-A4E', 'HainoTeko FG-11 Android Smartwatch — Black', 230),
  (4, 'LW-28677DFD-55B', 'Sony WH-CH520 Wireless Headphones — Blue', 220);

DO $$
BEGIN
  IF (SELECT count(*) FROM _view_baselines) <> 4
     OR (SELECT count(*) FROM "Auction" a
         JOIN _view_baselines b ON b."publicCode" = a."publicCode" AND b.code = a.code
         JOIN "Product" p ON p.id = a."productId" AND p.title = b.title
         WHERE a.status IN ('SCHEDULED', 'LIVE') AND a."publishedAt" IS NOT NULL) <> 4
     OR EXISTS (SELECT 1 FROM "AdminAudit"
         WHERE "operationKey" LIKE 'auction-view-baseline:2026-10-06:%')
  THEN RAISE EXCEPTION 'Auction identity changed or view baselines were already applied; nothing changed'; END IF;
END $$;

CREATE TEMP TABLE _view_before ON COMMIT DROP AS
SELECT a.id, a.code, a."publicCode", a."publicViewCount" AS previous, b.target
FROM "Auction" a JOIN _view_baselines b
  ON b."publicCode" = a."publicCode" AND b.code = a.code;

UPDATE "Auction" a
SET "publicViewCount" = GREATEST(a."publicViewCount", v.target)
FROM _view_before v WHERE a.id = v.id;

INSERT INTO "AdminAudit" (id, "actorId", action, target, details, "operationKey", "createdAt")
SELECT gen_random_uuid()::text, 'system:sql-editor', 'AUCTION_VIEW_BASELINE', v.code,
  jsonb_build_object('publicCode', v."publicCode", 'previousViews', v.previous,
    'requestedBaseline', v.target, 'newViews', GREATEST(v.previous, v.target),
    'reason', 'Owner-provided estimate after catalog relist reset view counts'),
  'auction-view-baseline:2026-10-06:' || v.code,
  clock_timestamp() AT TIME ZONE 'UTC'
FROM _view_before v;

DO $$
BEGIN
  IF (SELECT count(*) FROM "Auction" a JOIN _view_before v ON v.id = a.id
      WHERE a."publicViewCount" = GREATEST(v.previous, v.target)) <> 4
  THEN RAISE EXCEPTION 'View validation failed; everything rolls back'; END IF;
END $$;

COMMIT;

SELECT a."publicCode", p.title, a."publicViewCount" AS views
FROM "Auction" a JOIN "Product" p ON p.id = a."productId"
WHERE a."publicCode" IN (1, 2, 3, 4)
ORDER BY a."publicCode";
