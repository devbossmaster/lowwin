-- A v2 TEST hosted URL ends in a session token, while merchant verification
-- supplies the final payment reference after payment. Repair an older token
-- only while attaching its matching, balanced receipt in the same transaction.
-- All live references and all credited outcomes remain immutable.
CREATE OR REPLACE FUNCTION protect_chapa_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE test_session_receipt boolean := false;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Chapa payment audit records cannot be deleted'; END IF;
  IF (NEW.id,NEW."userId",NEW.purpose,NEW.mode,NEW."credentialFingerprint",NEW.key,NEW."requestHash",NEW.initialization,NEW."phoneCipher",NEW."phoneBotId",NEW."merchantReference",NEW."amountCents",NEW.currency,NEW."auctionId",NEW."auctionSlug",NEW."bidNumber",NEW."feeVersion",NEW."grossFee",NEW."discountPoints",NEW."couponId",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."userId",OLD.purpose,OLD.mode,OLD."credentialFingerprint",OLD.key,OLD."requestHash",OLD.initialization,OLD."phoneCipher",OLD."phoneBotId",OLD."merchantReference",OLD."amountCents",OLD.currency,OLD."auctionId",OLD."auctionSlug",OLD."bidNumber",OLD."feeVersion",OLD."grossFee",OLD."discountPoints",OLD."couponId",OLD."createdAt") THEN RAISE EXCEPTION 'Chapa checkout intent is immutable'; END IF;
  IF OLD.mode='test' AND OLD."creditJournalId" IS NULL AND NEW."creditJournalId" IS NOT NULL
     AND OLD."chapaReference" ~ '^TEST[A-Za-z0-9_-]+$'
     AND split_part(OLD."checkoutUrl",'?',1) IN (
       'https://checkout.chapa.global/test/payment/hosted/'||OLD."chapaReference",
       'https://checkout.chapa.global/test/payment/hosted/'||OLD."chapaReference"||'/')
     AND NEW."chapaReference" IS NOT NULL AND NEW."evidenceHash" IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM "Journal" j JOIN "Operation" o ON o.id=j."operationId"
      WHERE j.id=NEW."creditJournalId" AND j.kind='CHAPA_RECEIPT'
        AND o.scope='CHAPA_RECEIPT' AND o."userId"=OLD."userId" AND o.key=OLD.id
        AND o.result->>'checkoutId'=OLD.id
        AND o.result->>'merchantReference'=OLD."merchantReference"
        AND o.result->>'chapaReference'=NEW."chapaReference"
        AND o.result->>'mode'=OLD.mode AND o.result->>'currency'=OLD.currency
        AND o.result->>'amountCents'=OLD."amountCents"::text
    ) INTO test_session_receipt;
  END IF;
  IF (OLD."chapaReference" IS NOT NULL AND NEW."chapaReference" IS DISTINCT FROM OLD."chapaReference" AND NOT test_session_receipt) OR
     (OLD."checkoutUrl" IS NOT NULL AND NEW."checkoutUrl" IS DISTINCT FROM OLD."checkoutUrl") OR
     (OLD."creditJournalId" IS NOT NULL AND NEW."creditJournalId" IS DISTINCT FROM OLD."creditJournalId") OR
     (OLD."bidId" IS NOT NULL AND NEW."bidId" IS DISTINCT FROM OLD."bidId") THEN RAISE EXCEPTION 'Chapa payment evidence is immutable'; END IF;
  IF OLD."checkoutUrl" IS NOT NULL AND (NEW."expiresAt",NEW."providerCreatedAt") IS DISTINCT FROM (OLD."expiresAt",OLD."providerCreatedAt") THEN RAISE EXCEPTION 'Chapa checkout validity is immutable'; END IF;
  IF OLD."creditJournalId" IS NOT NULL AND (NEW.status,NEW.reason,NEW.receipt,NEW."evidenceHash",NEW."expiresAt",NEW."providerCreatedAt",NEW."paymentMethod",NEW."processorReference",NEW."serviceFeeCents") IS DISTINCT FROM (OLD.status,OLD.reason,OLD.receipt,OLD."evidenceHash",OLD."expiresAt",OLD."providerCreatedAt",OLD."paymentMethod",OLD."processorReference",OLD."serviceFeeCents") THEN RAISE EXCEPTION 'Verified Chapa outcome is immutable'; END IF;
  RETURN NEW;
END $$;
