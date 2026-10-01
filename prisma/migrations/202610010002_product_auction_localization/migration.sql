ALTER TABLE "Product"
  ADD COLUMN "titleAm" TEXT,
  ADD COLUMN "descriptionAm" TEXT,
  ADD COLUMN "conditionAm" TEXT;

ALTER TABLE "Auction"
  ADD COLUMN "fulfillmentSummaryAm" TEXT,
  ADD COLUMN "fulfillmentRegionAm" TEXT;
