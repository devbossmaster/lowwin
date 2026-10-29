-- Existing attempts retain explicit historical flow version 1. New attempts
-- use event processing and never enter a periodic provider scan.
ALTER TABLE "ChapaCheckout" ADD COLUMN "flowVersion" integer NOT NULL DEFAULT 1,
  ADD COLUMN "providerStatus" text,
  ADD COLUMN "verificationState" text NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "initializationErrorCode" text,
  ADD COLUMN "initializationHttpStatus" integer;
ALTER TABLE "ChapaCheckout" ALTER COLUMN "flowVersion" SET DEFAULT 2;
ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_status_check";
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_status_check" CHECK (status IN ('SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED','CREDITED','BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED'));
DROP INDEX IF EXISTS chapa_active_bid_intent;
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_providerStatus_check" CHECK
  ("providerStatus" IS NULL OR "providerStatus" IN ('SUCCESS','PENDING','FAILED','CANCELLED','INCOMPLETE','AUTH_NEEDED','BLOCKED')),
  ADD CONSTRAINT "ChapaCheckout_verificationState_check" CHECK
  ("verificationState" IN ('UNVERIFIED','VERIFIED','UNAVAILABLE','MISMATCH')),
  ADD CONSTRAINT "ChapaCheckout_flowVersion_check" CHECK ("flowVersion" IN (1,2));
-- Jobs contain only allowlisted references. Historical delivered events are
-- retained without silently replaying them after deployment.
ALTER TABLE "ChapaWebhookEvent" ADD COLUMN "checkoutId" text REFERENCES "ChapaCheckout"(id) ON DELETE RESTRICT,
  ADD COLUMN status text NOT NULL DEFAULT 'LEGACY', ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseUntil" timestamp(3), ADD COLUMN "completedAt" timestamp(3);
ALTER TABLE "ChapaWebhookEvent" ALTER COLUMN status SET DEFAULT 'QUEUED';
CREATE INDEX "ChapaWebhookEvent_status_nextAttemptAt_idx" ON "ChapaWebhookEvent"(status,"nextAttemptAt");
-- Delivery identity remains immutable; only bounded job bookkeeping can change.
DROP TRIGGER IF EXISTS chapa_webhook_event_guard ON "ChapaWebhookEvent";
CREATE OR REPLACE FUNCTION protect_chapa_event_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.mode,NEW."configurationFingerprint",NEW."bodyHash",NEW."merchantReference",NEW."chapaReference",NEW.event,NEW."receivedAt",NEW."checkoutId") IS DISTINCT FROM
 (OLD.id,OLD.mode,OLD."configurationFingerprint",OLD."bodyHash",OLD."merchantReference",OLD."chapaReference",OLD.event,OLD."receivedAt",OLD."checkoutId") THEN RAISE EXCEPTION 'Chapa event identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_chapa_event_job BEFORE UPDATE OR DELETE ON "ChapaWebhookEvent" FOR EACH ROW EXECUTE FUNCTION protect_chapa_event_job();
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT UPDATE ON "ChapaWebhookEvent" TO lowwin_runtime;
 END IF;
END $$;
CREATE FUNCTION protect_chapa_flow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."flowVersion"<>OLD."flowVersion" OR OLD."creditJournalId" IS NOT NULL AND
 (NEW."providerStatus",NEW."verificationState",NEW."initializationErrorCode",NEW."initializationHttpStatus") IS DISTINCT FROM
 (OLD."providerStatus",OLD."verificationState",OLD."initializationErrorCode",OLD."initializationHttpStatus") THEN RAISE EXCEPTION 'Chapa flow and verified provider evidence are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chapa_flow_guard BEFORE UPDATE ON "ChapaCheckout" FOR EACH ROW EXECUTE FUNCTION protect_chapa_flow();
