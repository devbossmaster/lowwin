BEGIN;
SET LOCAL lock_timeout='10s';

-- The web handler validates the signed session cookie and builds the payment
-- command. Bind that token and commit the usual quota and intent in one call.
CREATE FUNCTION public.lowwin_prepare_direct_for_session(session_token text, bot_id text, purpose text, command jsonb)
RETURNS SETOF public."ChapaCheckout" LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' AS $$
DECLARE
  binding jsonb;
  mutation_count integer;
  prepared public."ChapaCheckout"%ROWTYPE;
BEGIN
  IF COALESCE(purpose,'') NOT IN ('BID','TOP_UP') OR NULLIF(command->>'checkoutId','') IS NULL THEN RETURN; END IF;

  SELECT jsonb_build_object('sessionId',s.id,'sessionToken',s.token,'userId',u.id,
    'telegramId',u."telegramId",'telegramAuthSource',s."telegramAuthSource",'botId',bot_id)
  INTO binding
  FROM public."session" s
  JOIN public."user" u ON u.id=s."userId"
  JOIN public."TelegramOwnContact" c ON c."userId"=u.id AND c."telegramId"=u."telegramId"
  WHERE s.token=session_token AND s."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    AND s."updatedAt">(clock_timestamp() AT TIME ZONE 'UTC')-INTERVAL '24 hours'
    AND u.role='member' AND s."telegramAuthSource" IN ('MINI_APP','TELEGRAM_OIDC')
    AND s."telegramLaunchId"=u."telegramId" AND s."telegramLaunchId"<>''
    AND c."botId"=bot_id AND c."revokedAt" IS NULL
    AND NOT EXISTS(SELECT 1 FROM public."StaffMember" WHERE "userId"=u.id)
    AND NOT EXISTS(SELECT 1 FROM public."ChapaCheckout" WHERE "userId"=u.id AND key=command->>'key');
  IF NOT FOUND THEN RETURN; END IF;

  BEGIN
    -- A failed shortcut leaves the canonical route to count the request and
    -- report the original error. Only a committed intent keeps this count.
    INSERT INTO public."rateLimit" AS current(id,key,count,"lastRequest")
    VALUES(gen_random_uuid()::text,'app:mutation:'||encode(sha256(convert_to(binding->>'userId','UTF8')),'hex'),1,
      (extract(epoch FROM clock_timestamp())*1000)::bigint)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN current."lastRequest"<(extract(epoch FROM clock_timestamp())*1000)::bigint-60000 THEN 1 ELSE LEAST(current.count+1,61) END,
      "lastRequest"=CASE WHEN current."lastRequest"<(extract(epoch FROM clock_timestamp())*1000)::bigint-60000
        THEN (extract(epoch FROM clock_timestamp())*1000)::bigint ELSE current."lastRequest" END
    RETURNING count INTO mutation_count;
    IF mutation_count>60 THEN RAISE EXCEPTION 'LOWWIN_DIRECT_SESSION_FALLBACK'; END IF;

    -- The existing commands retain their post-lock binding, pricing, replay,
    -- atomic checkout and first-dispatch lease checks.
    IF purpose='BID' THEN
      SELECT * INTO prepared FROM public.lowwin_prepare_direct_bid(binding,command);
    ELSE
      SELECT * INTO prepared FROM public.lowwin_prepare_direct_topup(binding,command);
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'LOWWIN_DIRECT_SESSION_FALLBACK'; END IF;
    RETURN NEXT prepared;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='LOWWIN_DIRECT_SESSION_FALLBACK'
      OR (purpose='BID' AND SQLERRM='LOWWIN_DIRECT_BID_RATE_LIMITED')
      OR (purpose='TOP_UP' AND SQLERRM='LOWWIN_DIRECT_TOPUP_RATE_LIMITED') THEN RETURN; END IF;
    RAISE;
  END;
END $$;

REVOKE ALL ON FUNCTION public.lowwin_prepare_direct_for_session(text,text,text,jsonb) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.lowwin_prepare_direct_for_session(text,text,text,jsonb) FROM %I',browser_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT EXECUTE ON FUNCTION public.lowwin_prepare_direct_for_session(text,text,text,jsonb) TO lowwin_runtime;
 END IF;
END $$;
COMMIT;
