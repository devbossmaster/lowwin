ALTER TABLE "LedgerAccount" ADD CONSTRAINT account_kind CHECK (
  (kind IN ('AVAILABLE','HELD') AND "walletId" IS NOT NULL) OR
  (kind IN ('ISSUANCE','FEES','SETTLEMENT') AND "walletId" IS NULL)
);
ALTER TABLE "LedgerAccount" ADD CONSTRAINT nonnegative_user_balance CHECK ("walletId" IS NULL OR balance >= 0);
ALTER TABLE "Posting" ADD CONSTRAINT nonzero_posting CHECK (delta <> 0);
ALTER TABLE "AuctionHold" ADD CONSTRAINT nonnegative_hold CHECK (points >= 0);
ALTER TABLE "TopUpIntent" ADD CONSTRAINT positive_topup CHECK (points > 0);
ALTER TABLE "TopUpIntent" ADD CONSTRAINT topup_status CHECK (status IN ('PENDING','CREDITED','FAILED','REVERSED'));
ALTER TABLE "TopUpIntent" ADD CONSTRAINT topup_journal_fk FOREIGN KEY ("journalId") REFERENCES "Journal"(id);
ALTER TABLE "VerifiedPhoneIdentity" ADD CONSTRAINT e164_phone CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$');

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable audit record cannot be changed'; END;
$$;
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON "Journal" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_posting BEFORE UPDATE OR DELETE ON "Posting" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_operation BEFORE UPDATE OR DELETE ON "Operation" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_wallet BEFORE UPDATE OR DELETE ON "Wallet" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION protect_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Accounts cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> 0 THEN RAISE EXCEPTION 'New accounts must start at zero'; END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW.name <> OLD.name OR NEW.kind <> OLD.kind OR NEW."walletId" IS DISTINCT FROM OLD."walletId" THEN
      RAISE EXCEPTION 'Account identity is immutable';
    END IF;
    IF NEW.balance <> OLD.balance AND pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Only postings can change balances'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_guard BEFORE INSERT OR UPDATE OR DELETE ON "LedgerAccount" FOR EACH ROW EXECUTE FUNCTION protect_account();

CREATE FUNCTION apply_posting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Journal" WHERE id = NEW."journalId" AND "transactionId" = txid_current()) THEN
    RAISE EXCEPTION 'Cannot append postings to a committed journal';
  END IF;
  UPDATE "LedgerAccount" SET balance = balance + NEW.delta WHERE id = NEW."accountId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER projection_after_posting AFTER INSERT ON "Posting" FOR EACH ROW EXECUTE FUNCTION apply_posting();

CREATE FUNCTION check_balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_id text; total numeric; entries integer;
BEGIN
  IF TG_TABLE_NAME = 'Journal' THEN journal_id := NEW.id; ELSE journal_id := NEW."journalId"; END IF;
  SELECT COALESCE(SUM(delta),0), COUNT(*) INTO total, entries FROM "Posting" WHERE "journalId" = journal_id;
  IF entries < 2 OR total <> 0 THEN RAISE EXCEPTION 'Journal must contain at least two balanced postings'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON "Journal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced_journal();
CREATE CONSTRAINT TRIGGER balanced_postings AFTER INSERT ON "Posting" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_balanced_journal();

-- Keep Supabase's REST/anon roles away from identity, money and inbox data.
-- Application connections use a dedicated server role; never expose its password.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', item.tablename); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', item.tablename); END IF;
  END LOOP;
END $$;
