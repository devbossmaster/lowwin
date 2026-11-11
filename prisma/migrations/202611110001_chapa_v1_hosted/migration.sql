-- Existing attempts and deliveries retain their original v2 contract. New v1
-- attempts are explicit; no payment, balance, journal or receipt is rewritten.
ALTER TABLE "ChapaCheckout" ADD COLUMN "apiVersion" integer NOT NULL DEFAULT 2
  CONSTRAINT chapa_checkout_api_version CHECK ("apiVersion" IN (1,2));
ALTER TABLE "ChapaCheckout" ADD CONSTRAINT chapa_v1_hosted_only
  CHECK ("apiVersion"<>1 OR "chargeType"='HOSTED');
ALTER TABLE "ChapaWebhookEvent" ADD COLUMN "apiVersion" integer NOT NULL DEFAULT 2
  CONSTRAINT chapa_event_api_version CHECK ("apiVersion" IN (1,2));

-- Delivery replay identities are isolated by API contract as well as secret
-- fingerprint and environment. Old rows remain v2 without being replayed.
ALTER TABLE "ChapaWebhookEvent" DROP CONSTRAINT "ChapaWebhookEvent_mode_configurationFingerprint_bodyHash_key";
CREATE UNIQUE INDEX "chapa_event_api_version_delivery_key"
  ON "ChapaWebhookEvent"("apiVersion",mode,"configurationFingerprint","bodyHash");

CREATE FUNCTION protect_chapa_api_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW."apiVersion"<>OLD."apiVersion" THEN
    RAISE EXCEPTION 'Chapa API version is immutable';
  END IF;
  IF NEW."apiVersion"=1 AND NEW."creditJournalId" IS NOT NULL
     AND (TG_OP='INSERT' OR OLD."creditJournalId" IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM "Journal" j JOIN "Operation" o ON o.id=j."operationId"
       WHERE j.id=NEW."creditJournalId" AND j.kind='CHAPA_RECEIPT'
         AND j.reference='chapa:'||NEW."merchantReference"
         AND o.scope='CHAPA_RECEIPT' AND o.key=NEW.id AND o."userId"=NEW."userId"
         AND o.result->>'apiVersion'='1'
         AND o.result->>'checkoutId'=NEW.id
         AND o.result->>'merchantReference'=NEW."merchantReference"
         AND o.result->>'chapaReference'=NEW."chapaReference"
         AND o.result->>'mode'=NEW.mode AND o.result->>'currency'=NEW.currency
         AND o.result->>'amountCents'=NEW."amountCents"::text
         AND o."requestHash"=NEW."evidenceHash"
     ) THEN RAISE EXCEPTION 'Chapa v1 credit requires its versioned receipt proof'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapa_api_version_guard BEFORE INSERT OR UPDATE ON "ChapaCheckout"
  FOR EACH ROW EXECUTE FUNCTION protect_chapa_api_version();

CREATE FUNCTION protect_chapa_event_api_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW."apiVersion"<>OLD."apiVersion" THEN
    RAISE EXCEPTION 'Chapa event API version is immutable';
  END IF;
  IF NEW."checkoutId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ChapaCheckout" c WHERE c.id=NEW."checkoutId"
      AND c."apiVersion"=NEW."apiVersion" AND c.mode=NEW.mode
  ) THEN RAISE EXCEPTION 'Chapa event must match the payment API version and mode'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chapa_event_api_version_guard BEFORE INSERT OR UPDATE ON "ChapaWebhookEvent"
  FOR EACH ROW EXECUTE FUNCTION protect_chapa_event_api_version();
