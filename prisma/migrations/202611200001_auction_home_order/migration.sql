ALTER TABLE "Auction"
  ADD COLUMN "homeOrder" INTEGER,
  ADD CONSTRAINT "Auction_homeOrder_positive" CHECK ("homeOrder" > 0);
