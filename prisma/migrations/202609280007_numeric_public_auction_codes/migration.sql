ALTER TABLE "Auction" ADD COLUMN "publicCode" SERIAL NOT NULL;

CREATE UNIQUE INDEX "Auction_publicCode_key" ON "Auction"("publicCode");
