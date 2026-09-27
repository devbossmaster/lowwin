BEGIN;

-- Block concurrent writers while validating existing data and installing both guards.
LOCK TABLE "Wallet", "LedgerAccount", "AuctionHold", "Posting" IN SHARE ROW EXCLUSIVE MODE;

-- A real row write, not only an advisory lock, also forces stale REPEATABLE READ
-- transactions to abort instead of checking an old aggregate snapshot.
CREATE TABLE "WalletHoldGuard" (
  "walletId" TEXT PRIMARY KEY REFERENCES "Wallet"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE "WalletHoldGuard" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "WalletHoldGuard" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "WalletHoldGuard" FROM authenticated; END IF;
END $$;

CREATE FUNCTION lock_wallet_hold_state(wallet_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "WalletHoldGuard" ("walletId", revision) VALUES (wallet_id, 1)
  ON CONFLICT ("walletId") DO UPDATE SET revision = "WalletHoldGuard".revision + 1;
END;
$$;

CREATE FUNCTION serialize_hold_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet_id text;
BEGIN
  IF TG_TABLE_NAME = 'AuctionHold' THEN
    IF TG_OP = 'UPDATE' AND (NEW."walletId" <> OLD."walletId" OR NEW."auctionId" <> OLD."auctionId" OR NEW.id <> OLD.id) THEN
      RAISE EXCEPTION 'Hold ownership and identity are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN wallet_id := OLD."walletId"; ELSE wallet_id := NEW."walletId"; END IF;
  ELSIF TG_TABLE_NAME = 'Posting' THEN
    SELECT "walletId" INTO wallet_id FROM "LedgerAccount" WHERE id = NEW."accountId";
  ELSE
    wallet_id := NEW."walletId";
  END IF;
  IF wallet_id IS NOT NULL THEN PERFORM lock_wallet_hold_state(wallet_id); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER serialize_auction_hold BEFORE INSERT OR UPDATE OR DELETE ON "AuctionHold"
FOR EACH ROW EXECUTE FUNCTION serialize_hold_state();
-- Acquire the guard before the projection trigger locks/updates the account row.
CREATE TRIGGER serialize_posting_wallet BEFORE INSERT ON "Posting"
FOR EACH ROW EXECUTE FUNCTION serialize_hold_state();
CREATE TRIGGER serialize_account_wallet BEFORE INSERT OR UPDATE ON "LedgerAccount"
FOR EACH ROW EXECUTE FUNCTION serialize_hold_state();

CREATE FUNCTION assert_wallet_hold_total(wallet_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE held_points numeric; hold_points numeric;
BEGIN
  SELECT COALESCE((SELECT balance FROM "LedgerAccount" WHERE "walletId" = wallet_id AND kind = 'HELD'), 0)
    INTO held_points;
  SELECT COALESCE(SUM(points), 0) INTO hold_points FROM "AuctionHold" WHERE "walletId" = wallet_id;
  IF held_points <> hold_points THEN
    RAISE EXCEPTION 'HELD balance must equal auction hold total' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION check_wallet_hold_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN wallet_id := OLD."walletId"; ELSE wallet_id := NEW."walletId"; END IF;
  IF wallet_id IS NOT NULL THEN PERFORM assert_wallet_hold_total(wallet_id); END IF;
  RETURN NULL;
END;
$$;

-- No WHEN predicate: every queued event checks the final state, including a
-- zero hold which is made positive later, and every HELD projection update.
CREATE CONSTRAINT TRIGGER auction_hold_total AFTER INSERT OR UPDATE OR DELETE ON "AuctionHold"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_wallet_hold_total();
CREATE CONSTRAINT TRIGGER account_hold_total AFTER INSERT OR UPDATE ON "LedgerAccount"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_wallet_hold_total();
CREATE TRIGGER forbid_hold_truncate BEFORE TRUNCATE ON "AuctionHold"
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER forbid_account_truncate BEFORE TRUNCATE ON "LedgerAccount"
FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

-- Do not silently repair pre-existing money discrepancies during migration.
DO $$ DECLARE wallet_row record; BEGIN
  FOR wallet_row IN SELECT id FROM "Wallet" LOOP
    PERFORM assert_wallet_hold_total(wallet_row.id);
  END LOOP;
END $$;
COMMIT;
