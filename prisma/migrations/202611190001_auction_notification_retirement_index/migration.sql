-- Match the auction cleanup predicate without blocking delivery writes while
-- PostgreSQL builds the index across existing outbox history.
CREATE INDEX CONCURRENTLY "Outbox_auction_payload_kind_idx"
  ON "Outbox" ((payload->>'auctionId'), kind)
  WHERE payload ? 'auctionId';
