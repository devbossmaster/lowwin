-- Preserve the authenticated delivery audit contract for the new allowlisted
-- feedback. Only worker bookkeeping may change after a delivery is inserted.
CREATE OR REPLACE FUNCTION protect_chapa_event_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
 (NEW.id,NEW.mode,NEW."configurationFingerprint",NEW."bodyHash",NEW."merchantReference",NEW."chapaReference",NEW.event,NEW."receivedAt",NEW."checkoutId",NEW."providerReasonCode",NEW."cancelledBy",NEW."providerUpdatedAt",NEW."paymentMethod") IS DISTINCT FROM
 (OLD.id,OLD.mode,OLD."configurationFingerprint",OLD."bodyHash",OLD."merchantReference",OLD."chapaReference",OLD.event,OLD."receivedAt",OLD."checkoutId",OLD."providerReasonCode",OLD."cancelledBy",OLD."providerUpdatedAt",OLD."paymentMethod")
 THEN RAISE EXCEPTION 'Chapa event identity and authenticated feedback are immutable'; END IF;
 RETURN NEW;
END $$;

-- Cancellation attribution is committed with the privately verified outcome.
-- Like the existing provider status, it cannot change after a wallet credit.
CREATE OR REPLACE FUNCTION protect_chapa_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."flowVersion"<>OLD."flowVersion" OR OLD."creditJournalId" IS NOT NULL AND
 (NEW."providerStatus",NEW."verificationState",NEW."initializationErrorCode",NEW."initializationHttpStatus",NEW."providerCancelledBy") IS DISTINCT FROM
 (OLD."providerStatus",OLD."verificationState",OLD."initializationErrorCode",OLD."initializationHttpStatus",OLD."providerCancelledBy")
 THEN RAISE EXCEPTION 'Chapa flow and verified provider evidence are immutable'; END IF;
 RETURN NEW;
END $$;
-- Public completion is retained only as a scheduling hint. It never changes
-- providerStatus or authorizes fulfillment before private verification.
ALTER TABLE "ChapaCheckout" ADD COLUMN "verificationCompletionStatus" TEXT
 CHECK ("verificationCompletionStatus" IS NULL OR "verificationCompletionStatus" IN ('SUCCESS','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED'));

