BEGIN;
SET LOCAL lock_timeout='10s';

ALTER TABLE public."TelegramRateBudget"
 ADD COLUMN "recentSendsAt" timestamp(3)[] NOT NULL DEFAULT ARRAY[]::timestamp(3)[],
 ADD COLUMN "highWaitingUntil" timestamp(3);

-- All senders share this bot row. At the 30/s setting, up to three nearby
-- grants can absorb network jitter, while the rolling window stays strict.
CREATE FUNCTION public.lowwin_reserve_telegram_send(
 p_bot_id text,p_chat_id text,p_priority text,p_global_ms integer,p_bulk_ms integer,p_chat_ms integer
) RETURNS TABLE(granted boolean,"waitMs" integer,"retryAt" timestamp(3))
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public
SET lock_timeout='3s'
AS $$
DECLARE
 budget public."TelegramRateBudget"%ROWTYPE;
 recipient_next timestamp(3);
 now_utc timestamp(3);
 due timestamp(3);
 recent timestamp(3)[];
 bulk_turn boolean;
 high_turn boolean;
BEGIN
 IF p_bot_id IS NULL OR p_bot_id !~ '^[0-9]+$' OR p_chat_id IS NULL OR length(p_chat_id)>33
  OR p_priority IS NULL OR p_priority NOT IN ('high','bulk')
  OR p_global_ms IS NULL OR p_global_ms NOT BETWEEN 33 AND 500
  OR p_bulk_ms IS NULL OR p_bulk_ms NOT BETWEEN p_global_ms AND 1000
  OR p_chat_ms IS NULL OR p_chat_ms NOT BETWEEN 1000 AND 60000 THEN
  RAISE EXCEPTION 'Invalid Telegram rate reservation';
 END IF;
 now_utc:=date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC');
 INSERT INTO public."TelegramRateBudget" ("botId","nextSendAt","nextBulkAt","highStreak")
 VALUES(p_bot_id,now_utc,now_utc,0) ON CONFLICT("botId") DO NOTHING;
 SELECT b.* INTO STRICT budget FROM public."TelegramRateBudget" b
 WHERE b."botId"=p_bot_id FOR UPDATE;
 -- Keep the bot -> chat lock order shared by the old and new API paths.
 INSERT INTO public."TelegramChatRateBudget" ("botId","chatId","nextSendAt")
 VALUES(p_bot_id,p_chat_id,now_utc) ON CONFLICT("botId","chatId") DO NOTHING;
 SELECT c."nextSendAt" INTO STRICT recipient_next FROM public."TelegramChatRateBudget" c
 WHERE c."botId"=p_bot_id AND c."chatId"=p_chat_id FOR UPDATE;
 now_utc:=date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC');
 recent:=ARRAY(SELECT previous FROM unnest(budget."recentSendsAt") AS slot(previous)
  WHERE previous>now_utc-interval '1 second' ORDER BY previous);

 -- At equal rates bulk may fill idle slots. A waiting eligible personal
 -- sender gets priority, with the existing four-send fairness for bulk.
 bulk_turn:=p_priority='high' AND budget."highStreak">=4
  AND budget."bulkWaitingUntil">now_utc AND budget."nextBulkAt"<=now_utc;
 high_turn:=p_priority='bulk' AND p_bulk_ms=p_global_ms
  AND budget."highWaitingUntil">now_utc AND budget."highStreak"<4;
 due:=GREATEST(now_utc,recipient_next,budget."cooldownUntil",
  budget."nextSendAt"-CASE WHEN p_global_ms=33 THEN interval '66 milliseconds' ELSE interval '0' END,
  CASE WHEN p_priority='bulk' THEN budget."nextBulkAt"-CASE WHEN p_bulk_ms=33 THEN interval '66 milliseconds' ELSE interval '0' END ELSE now_utc END,
  CASE WHEN cardinality(recent)>=30 THEN recent[1]+interval '1 second' END,
  CASE WHEN bulk_turn OR high_turn THEN now_utc+p_global_ms*interval '1 millisecond' ELSE now_utc END);
 IF due>now_utc THEN
  IF recipient_next<=now_utc AND (budget."cooldownUntil" IS NULL OR budget."cooldownUntil"<=now_utc) THEN
   IF p_priority='bulk' THEN
    UPDATE public."TelegramRateBudget" b SET "bulkWaitingUntil"=now_utc+interval '1 second'
    WHERE b."botId"=p_bot_id;
   ELSE
    UPDATE public."TelegramRateBudget" b SET "highWaitingUntil"=now_utc+interval '350 milliseconds'
    WHERE b."botId"=p_bot_id;
   END IF;
  END IF;
  RETURN QUERY SELECT false,
   LEAST(2147483647::numeric,GREATEST(1::numeric,ceil(extract(epoch FROM due-now_utc)*1000)))::integer,due;
  RETURN;
 END IF;

 UPDATE public."TelegramRateBudget" b SET
  "nextSendAt"=(CASE WHEN p_global_ms=33 THEN GREATEST(now_utc,b."nextSendAt") ELSE now_utc END)+p_global_ms*interval '1 millisecond',
  "nextBulkAt"=CASE WHEN p_priority='bulk' THEN (CASE WHEN p_bulk_ms=33 THEN GREATEST(now_utc,b."nextBulkAt") ELSE now_utc END)+p_bulk_ms*interval '1 millisecond' ELSE b."nextBulkAt" END,
  "highStreak"=CASE WHEN p_priority='bulk' THEN 0 ELSE LEAST(b."highStreak"+1,4) END,
  "bulkWaitingUntil"=CASE WHEN p_priority='bulk' THEN NULL ELSE b."bulkWaitingUntil" END,
  "highWaitingUntil"=CASE WHEN p_priority='high' THEN NULL ELSE b."highWaitingUntil" END,
  "recentSendsAt"=array_append(recent,now_utc) WHERE b."botId"=p_bot_id;
 UPDATE public."TelegramChatRateBudget" c SET "nextSendAt"=now_utc+p_chat_ms*interval '1 millisecond'
 WHERE c."botId"=p_bot_id AND c."chatId"=p_chat_id;
 RETURN QUERY SELECT true,0,now_utc;
END;
$$;

-- Old app revisions retain their validated inputs and share the same durable
-- quota during deploy overlap, including ordinary bot and Chapa replies.
CREATE OR REPLACE FUNCTION public.reserve_telegram_send(
 p_bot_id text,p_chat_id text,p_priority text,p_global_ms integer,p_bulk_ms integer,p_chat_ms integer
) RETURNS TABLE(granted boolean,"waitMs" integer,"retryAt" timestamp(3))
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public
SET lock_timeout='3s'
AS $$
BEGIN
 IF p_global_ms NOT BETWEEN 35 AND 500 OR p_bulk_ms NOT BETWEEN 36 AND 1000 OR p_bulk_ms<=p_global_ms THEN
  RAISE EXCEPTION 'Invalid Telegram rate reservation';
 END IF;
 RETURN QUERY SELECT * FROM public.lowwin_reserve_telegram_send(p_bot_id,p_chat_id,p_priority,p_global_ms,p_bulk_ms,p_chat_ms);
END;
$$;

-- Acquire the maintenance barrier before touching the shared rate budget.
-- A granted slot then runs the final gate with fresh state. A rejected gate
-- rolls back the reservation, and a denied slot does not run the gate.
CREATE FUNCTION public.lowwin_reserve_notification_send(
 p_command jsonb,p_bot_id text,p_chat_id text,p_priority text,p_global_ms integer,p_bulk_ms integer,p_chat_ms integer
) RETURNS TABLE(granted boolean,"waitMs" integer,"retryAt" timestamp(3),reason text,"renewedUntil" timestamp(3))
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public
SET lock_timeout='5s'
AS $$
DECLARE
 slot record;
 gate record;
 rejected text;
 renewed timestamp(3);
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Notification gate requires READ COMMITTED' USING ERRCODE='0A000';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0));
 BEGIN
  SELECT * INTO STRICT slot FROM public.lowwin_reserve_telegram_send(p_bot_id,p_chat_id,p_priority,p_global_ms,p_bulk_ms,p_chat_ms);
  IF slot.granted THEN
   SELECT * INTO STRICT gate FROM public.lowwin_gate_notification(p_command);
   IF gate.reason IS NOT NULL THEN
    rejected:=gate.reason;
    RAISE SQLSTATE 'LW102';
   END IF;
   renewed:=gate."renewedUntil";
  END IF;
 EXCEPTION WHEN SQLSTATE 'LW102' THEN
  RETURN QUERY SELECT false,0,slot."retryAt",rejected,NULL::timestamp;
  RETURN;
 END;
 RETURN QUERY SELECT slot.granted,slot."waitMs",slot."retryAt",NULL::text,renewed;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_telegram_send(text,text,text,integer,integer,integer),
 public.lowwin_reserve_telegram_send(text,text,text,integer,integer,integer),
 public.lowwin_reserve_notification_send(jsonb,text,text,text,integer,integer,integer) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.reserve_telegram_send(text,text,text,integer,integer,integer),public.lowwin_reserve_telegram_send(text,text,text,integer,integer,integer),public.lowwin_reserve_notification_send(jsonb,text,text,text,integer,integer,integer) FROM %I',browser_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT EXECUTE ON FUNCTION public.reserve_telegram_send(text,text,text,integer,integer,integer),
   public.lowwin_reserve_telegram_send(text,text,text,integer,integer,integer),
   public.lowwin_reserve_notification_send(jsonb,text,text,text,integer,integer,integer) TO lowwin_runtime;
 END IF;
END $$;
COMMIT;
