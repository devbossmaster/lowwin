CREATE INDEX "AuctionFavorite_auctionId_idx" ON "AuctionFavorite"("auctionId");
CREATE INDEX "Outbox_pending_due_idx" ON "Outbox"("nextAttemptAt",id) WHERE state='PENDING';
CREATE INDEX "Auction_pending_end_idx" ON "Auction"("endsAt",id) WHERE "publishedAt" IS NOT NULL AND status IN ('LIVE','SCHEDULED');
