-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "acceptedBidCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fulfillmentRegion" TEXT,
ADD COLUMN     "fulfillmentSummary" TEXT,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "requiresEligibilityReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "sourceCredit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionTerms" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ruleVersion" TEXT NOT NULL DEFAULT 'lowest-unique-v1',
    "minPoints" BIGINT NOT NULL,
    "maxPoints" BIGINT NOT NULL,
    "stepPoints" BIGINT NOT NULL,
    "entryFeePoints" BIGINT NOT NULL DEFAULT 0,
    "maxDistinctBids" INTEGER NOT NULL DEFAULT 100,
    "noWinnerTerms" TEXT NOT NULL,
    "cancellationTerms" TEXT NOT NULL,
    "fulfillmentSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicAuctionResult" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "winningPoints" BIGINT,
    "winnerLabel" TEXT,
    "explanation" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicAuctionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Category_visible_sortOrder_idx" ON "Category"("visible", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_categoryId_visible_idx" ON "Product"("categoryId", "visible");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_sortOrder_key" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionTerms_auctionId_key" ON "AuctionTerms"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicAuctionResult_auctionId_key" ON "PublicAuctionResult"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_slug_key" ON "Auction"("slug");

-- CreateIndex
CREATE INDEX "Auction_status_startsAt_endsAt_idx" ON "Auction"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Auction_categoryId_status_idx" ON "Auction"("categoryId", "status");

-- CreateIndex
CREATE INDEX "Auction_publishedAt_endsAt_idx" ON "Auction"("publishedAt", "endsAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionTerms" ADD CONSTRAINT "AuctionTerms_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicAuctionResult" ADD CONSTRAINT "PublicAuctionResult_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep published inventory coherent while allowing legacy Phase 1.5 auction rows.
ALTER TABLE "Auction" ADD CONSTRAINT auction_status_check CHECK (status IN ('DRAFT', 'SCHEDULED', 'LIVE', 'CLOSED', 'CANCELLED'));
ALTER TABLE "Auction" ADD CONSTRAINT auction_timing_check CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt");
ALTER TABLE "Auction" ADD CONSTRAINT auction_bid_count_check CHECK ("acceptedBidCount" >= 0 AND "acceptedBidCount" <= 100);
ALTER TABLE "Auction" ADD CONSTRAINT published_auction_complete CHECK (
  "publishedAt" IS NULL OR (status <> 'DRAFT' AND slug IS NOT NULL AND "productId" IS NOT NULL
  AND "categoryId" IS NOT NULL AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL
  AND "fulfillmentSummary" IS NOT NULL AND "fulfillmentRegion" IS NOT NULL)
);
ALTER TABLE "AuctionTerms" ADD CONSTRAINT auction_terms_range_check CHECK (
  version >= 1 AND "minPoints" >= 1 AND "maxPoints" >= "minPoints" AND "stepPoints" >= 1
  AND ("maxPoints" - "minPoints") % "stepPoints" = 0 AND "entryFeePoints" >= 0
  AND "maxDistinctBids" = 100
);
ALTER TABLE "ProductImage" ADD CONSTRAINT product_image_source_check CHECK ("sourceType" IN ('ORIGINAL', 'LICENSED', 'SUPPLIED'));
ALTER TABLE "PublicAuctionResult" ADD CONSTRAINT public_result_check CHECK (
  (outcome = 'WINNER' AND "winningPoints" IS NOT NULL AND "winningPoints" >= 1 AND "winnerLabel" IS NOT NULL)
  OR (outcome = 'NO_WINNER' AND "winningPoints" IS NULL AND "winnerLabel" IS NULL)
);

-- Snapshot terms and public result records cannot be silently rewritten.
CREATE TRIGGER immutable_auction_terms BEFORE UPDATE OR DELETE ON "AuctionTerms"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_public_result BEFORE UPDATE OR DELETE ON "PublicAuctionResult"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY['Category','Product','ProductImage','AuctionTerms','PublicAuctionResult'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', item); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', item); END IF;
  END LOOP;
END $$;
