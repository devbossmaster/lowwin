BEGIN;
-- Match the journal's append protection: participant references can only be
-- attached in the same transaction that created the immutable decision.
ALTER TABLE "AuctionSettlement" ADD COLUMN "transactionId" BIGINT NOT NULL DEFAULT txid_current();
CREATE FUNCTION guard_settlement_movement_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AuctionSettlement" WHERE id=NEW."settlementId" AND "transactionId"=txid_current()) THEN
    RAISE EXCEPTION 'Cannot append movements to a committed settlement';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER settlement_movement_insert BEFORE INSERT ON "SettlementMovement" FOR EACH ROW EXECUTE FUNCTION guard_settlement_movement_insert();

-- Direct SQL hold writers must acquire the auction before the existing wallet
-- guard, too. This closes the race between a new hold and final settlement.
CREATE FUNCTION lock_hold_auction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auction_id text; terminal boolean;
BEGIN
  IF TG_OP='DELETE' THEN auction_id:=OLD."auctionId"; ELSE auction_id:=NEW."auctionId"; END IF;
  SELECT status IN ('CLOSED','CANCELLED') INTO terminal FROM "Auction" WHERE id=auction_id FOR UPDATE;
  IF TG_OP<>'DELETE' AND terminal AND NEW.points>0 THEN RAISE EXCEPTION 'Cannot hold points for a terminal auction'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
-- Alphabetical ordering places this before serialize_auction_hold.
CREATE TRIGGER auction_hold_auction_lock BEFORE INSERT OR UPDATE OR DELETE ON "AuctionHold" FOR EACH ROW EXECUTE FUNCTION lock_hold_auction();
COMMIT;
