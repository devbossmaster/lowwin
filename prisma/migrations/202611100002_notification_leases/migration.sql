BEGIN;

ALTER TABLE "Outbox" ADD COLUMN "leaseToken" text, ADD COLUMN "leaseUntil" timestamp(3), ADD COLUMN "claimedAt" timestamp(3);
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_lease_pair_check" CHECK (("leaseToken" IS NULL)=("leaseUntil" IS NULL));
CREATE TABLE "TelegramRateBudget" (
 "botId" text PRIMARY KEY, "nextSendAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "nextBulkAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "cooldownUntil" timestamp(3),
 "highStreak" integer NOT NULL DEFAULT 0 CHECK ("highStreak">=0), "bulkWaitingUntil" timestamp(3)
);
CREATE TABLE "TelegramChatRateBudget" (
 "botId" text NOT NULL, "chatId" text NOT NULL, "nextSendAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("botId","chatId")
);
CREATE TABLE "TelegramDeliveryLease" (
 key text PRIMARY KEY, "botId" text NOT NULL, "outboxId" text NOT NULL,
 "leaseToken" text NOT NULL, "leaseUntil" timestamp(3) NOT NULL, "sentAt" timestamp(3), "messageId" bigint
);
CREATE TABLE "TelegramMediaCache" (
 "botId" text NOT NULL, "contentKey" text NOT NULL, "fileId" text, "uploadToken" text,
 "uploadLeaseUntil" timestamp(3), "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("botId","contentKey"),
 CONSTRAINT "TelegramMediaCache_lease_pair_check" CHECK (("uploadToken" IS NULL)=("uploadLeaseUntil" IS NULL))
);

-- The existing partial Outbox_pending_due_idx already supports bounded claims.
-- Keep browser roles away from coordination state and any Telegram file IDs.
ALTER TABLE "TelegramRateBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelegramChatRateBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelegramDeliveryLease" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelegramMediaCache" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TelegramRateBudget","TelegramChatRateBudget","TelegramDeliveryLease","TelegramMediaCache" FROM PUBLIC;
DO $acl$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "TelegramRateBudget","TelegramChatRateBudget","TelegramDeliveryLease","TelegramMediaCache" FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  FOREACH table_name IN ARRAY ARRAY['TelegramRateBudget','TelegramChatRateBudget','TelegramDeliveryLease','TelegramMediaCache'] LOOP
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO lowwin_runtime',table_name);
   EXECUTE format('CREATE POLICY lowwin_server_access ON %I TO lowwin_runtime USING(true) WITH CHECK(true)',table_name);
  END LOOP;
 END IF;
END $acl$;
-- One client round trip per reservation; the bot row serializes all processes.
-- SECURITY INVOKER keeps the same runtime RLS and table privileges as the caller.
CREATE OR REPLACE FUNCTION public.reserve_telegram_send(
 p_bot_id text,p_chat_id text,p_priority text,
 p_global_ms integer,p_bulk_ms integer,p_chat_ms integer
) RETURNS TABLE(granted boolean,"waitMs" integer,"retryAt" timestamp(3))
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public,pg_temp
SET lock_timeout = '3s'
AS $$
DECLARE
 budget public."TelegramRateBudget"%ROWTYPE;
 recipient_next timestamp(3);
 current_time_utc timestamp(3);
 due timestamp(3);
 bulk_turn boolean;
BEGIN
 IF p_bot_id !~ '^[0-9]+$' OR p_chat_id IS NULL OR length(p_chat_id)>33
    OR p_priority NOT IN ('high','bulk')
    OR p_global_ms NOT BETWEEN 35 AND 500
    OR p_bulk_ms NOT BETWEEN 36 AND 1000 OR p_bulk_ms<=p_global_ms
    OR p_chat_ms NOT BETWEEN 1000 AND 60000 THEN
  RAISE EXCEPTION 'Invalid Telegram rate reservation';
 END IF;
 current_time_utc:=date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC');
 INSERT INTO public."TelegramRateBudget" ("botId","nextSendAt","nextBulkAt","highStreak")
  VALUES (p_bot_id,current_time_utc,current_time_utc,0)
  ON CONFLICT ("botId") DO NOTHING;
 SELECT b.* INTO STRICT budget FROM public."TelegramRateBudget" b
  WHERE b."botId"=p_bot_id FOR UPDATE;
 -- Every path takes bot then chat; no sender reserves future capacity.
 INSERT INTO public."TelegramChatRateBudget" ("botId","chatId","nextSendAt")
  VALUES (p_bot_id,p_chat_id,current_time_utc)
  ON CONFLICT ("botId","chatId") DO NOTHING;
 SELECT c."nextSendAt" INTO STRICT recipient_next FROM public."TelegramChatRateBudget" c
  WHERE c."botId"=p_bot_id AND c."chatId"=p_chat_id FOR UPDATE;
 -- Measure time after waiting for both locks, not before.
 current_time_utc:=date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC');
 bulk_turn:=p_priority='high' AND budget."highStreak">=4
  AND budget."bulkWaitingUntil">current_time_utc AND budget."nextBulkAt"<=current_time_utc;
 due:=GREATEST(current_time_utc,budget."nextSendAt",recipient_next,budget."cooldownUntil",
  CASE WHEN p_priority='bulk' THEN budget."nextBulkAt" ELSE current_time_utc END,
  CASE WHEN bulk_turn THEN current_time_utc+p_global_ms*interval '1 millisecond' ELSE current_time_utc END);
 IF due>current_time_utc THEN
  -- Only an eligible destination may announce short-lived bulk demand.
  IF p_priority='bulk' AND recipient_next<=current_time_utc
     AND (budget."cooldownUntil" IS NULL OR budget."cooldownUntil"<=current_time_utc) THEN
   UPDATE public."TelegramRateBudget" b SET "bulkWaitingUntil"=current_time_utc+interval '1 second'
    WHERE b."botId"=p_bot_id;
  END IF;
  RETURN QUERY SELECT false,
   LEAST(2147483647::numeric,GREATEST(1::numeric,ceil(extract(epoch FROM due-current_time_utc)*1000)))::integer,due;
  RETURN;
 END IF;
 IF p_priority='bulk' THEN
  UPDATE public."TelegramRateBudget" b SET
   "nextSendAt"=current_time_utc+p_global_ms*interval '1 millisecond',
   "nextBulkAt"=current_time_utc+p_bulk_ms*interval '1 millisecond',
   "highStreak"=0,"bulkWaitingUntil"=NULL WHERE b."botId"=p_bot_id;
 ELSE
  UPDATE public."TelegramRateBudget" b SET
   "nextSendAt"=current_time_utc+p_global_ms*interval '1 millisecond',
   "highStreak"=LEAST(b."highStreak"+1,4) WHERE b."botId"=p_bot_id;
 END IF;
 UPDATE public."TelegramChatRateBudget" c SET "nextSendAt"=current_time_utc+p_chat_ms*interval '1 millisecond'
  WHERE c."botId"=p_bot_id AND c."chatId"=p_chat_id;
 RETURN QUERY SELECT true,0,current_time_utc;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_telegram_send(text,text,text,integer,integer,integer) FROM PUBLIC;

DO $function_acl$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.reserve_telegram_send(text,text,text,integer,integer,integer) FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT EXECUTE ON FUNCTION public.reserve_telegram_send(text,text,text,integer,integer,integer) TO lowwin_runtime;
 END IF;
END $function_acl$;

COMMIT;
