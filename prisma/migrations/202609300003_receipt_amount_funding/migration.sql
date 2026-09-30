BEGIN;
ALTER TABLE "TopUpIntent" ADD COLUMN "amountFromReceipt" boolean NOT NULL DEFAULT false;
ALTER TABLE "TopUpIntent" DROP CONSTRAINT positive_topup;
ALTER TABLE "TopUpIntent" ADD CONSTRAINT positive_topup CHECK (
 points>0 OR ("amountFromReceipt" AND provider='CHECK_ET' AND points=0 AND "expectedCents" IS NULL AND status<>'CREDITED' AND "journalId" IS NULL)
);
ALTER TABLE "TopUpIntent" ADD CONSTRAINT receipt_amount_state CHECK (NOT "amountFromReceipt" OR (
 provider='CHECK_ET' AND "quoteSnapshot" IS NOT NULL AND "receivingAccount" IS NOT NULL AND "expiresAt" IS NOT NULL AND
 "quoteSnapshot" ?& ARRAY['minCents','maxCents','earliestTransferAt'] AND
 (("expectedCents" IS NULL AND points=0 AND "journalId" IS NULL AND status<>'CREDITED') OR
 (status='CREDITED' AND "journalId" IS NOT NULL AND "expectedCents">0 AND points="expectedCents"::numeric/100 AND
 "expectedCents">=("quoteSnapshot"->>'minCents')::bigint AND "expectedCents"<=("quoteSnapshot"->>'maxCents')::bigint))
));
CREATE OR REPLACE FUNCTION protect_topup_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[]:=ARRAY['status','journalId','reference','attempts','scanAttempts','nextAttemptAt','leaseToken','leaseUntil','reasonCode','caseState','assignedTo'];
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Top-up records cannot be removed'; END IF;
 -- New receipt-derived intents acquire an amount once, with a balanced claim
 -- in the same transaction. Previously published quotes remain immutable.
 IF OLD."amountFromReceipt" AND OLD."expectedCents" IS NULL AND OLD.points=0 AND OLD."journalId" IS NULL AND NEW.status='CREDITED' AND NEW."journalId" IS NOT NULL THEN
  mutable:=mutable||ARRAY['expectedCents','points'];
 END IF;
 IF (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable) THEN RAISE EXCEPTION 'Top-up quote and identity are immutable'; END IF;
 IF OLD.reference IS NOT NULL AND NEW.reference IS DISTINCT FROM OLD.reference THEN RAISE EXCEPTION 'Top-up reference is immutable once submitted'; END IF;
 IF OLD."journalId" IS NOT NULL AND (NEW."journalId" IS DISTINCT FROM OLD."journalId" OR NEW.status<>OLD.status) THEN RAISE EXCEPTION 'Credited receipt is immutable'; END IF;
 RETURN NEW;
END $$;
COMMIT;
