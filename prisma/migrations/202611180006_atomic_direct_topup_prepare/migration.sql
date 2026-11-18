BEGIN;
SET LOCAL lock_timeout='10s';

-- Accelerate ordinary top-ups without changing replay or bonus quoting. A
-- zero-row result has made no writes and may use the existing transaction.
CREATE FUNCTION public.lowwin_prepare_direct_topup(binding jsonb, command jsonb)
RETURNS SETOF public."ChapaCheckout" LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' AS $$
DECLARE
  uid text := binding->>'userId';
  checkout_id text := command->>'checkoutId';
  initialization jsonb := command->'initialization';
  amount bigint;
  contact_cipher text;
  instant timestamp;
  bonus_policy record;
  limits_allowed boolean;
BEGIN
  IF NULLIF(uid,'') IS NULL OR NULLIF(checkout_id,'') IS NULL
    OR COALESCE(command->>'amountCents','') !~ '^[1-9][0-9]{0,6}$'
    OR COALESCE(command->>'minimumCents','') !~ '^[0-9]{1,16}$'
    OR COALESCE(command->>'maximumCents','') !~ '^[0-9]{1,16}$'
    OR COALESCE(command->>'approvedBonusCents','0')<>'0'
    OR COALESCE(initialization->>'paymentMethod','') NOT IN ('telebirr','cbebirr','mpesa')
    OR COALESCE(initialization->>'merchantReference','') !~ '^LW[a-f0-9]{18}$'
    OR initialization ?| ARRAY['depositBonus','batch'] THEN RETURN; END IF;
  amount := (command->>'amountCents')::bigint;
  IF amount NOT BETWEEN 500 AND 4320000
    OR amount NOT BETWEEN (command->>'minimumCents')::bigint AND (command->>'maximumCents')::bigint THEN RETURN; END IF;

  -- Preserve the writer's lock order. VOLATILE gives these post-lock queries
  -- fresh snapshots if maintenance, recovery, or another payment held a lock.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0));
  IF COALESCE((SELECT action='AUCTIONS_MAINTENANCE_HALTED' FROM public."AdminAudit"
    WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED')
    ORDER BY "createdAt" DESC,id DESC LIMIT 1),false) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:'||uid,0));

  SELECT c."phoneCipher" INTO contact_cipher FROM public."session" s JOIN public."user" u ON u.id=s."userId"
    JOIN public."TelegramOwnContact" c ON c."userId"=u.id AND c."telegramId"=u."telegramId"
    WHERE s.id=binding->>'sessionId' AND s.token=binding->>'sessionToken' AND s."userId"=uid
      AND s."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND u.role='member'
      AND s."telegramLaunchId"=u."telegramId" AND u."telegramId"=binding->>'telegramId'
      AND s."telegramAuthSource" IN ('MINI_APP','TELEGRAM_OIDC') AND s."telegramAuthSource"=binding->>'telegramAuthSource'
      AND c."botId"=binding->>'botId' AND c."revokedAt" IS NULL
      AND NOT EXISTS(SELECT 1 FROM public."StaffMember" WHERE "userId"=uid)
      AND NOT EXISTS(SELECT 1 FROM public."UserRestriction" WHERE "userId"=uid AND suspended);
  IF NULLIF(contact_cipher,'') IS NULL THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public."ChapaCheckout" WHERE "userId"=uid AND key=command->>'key') THEN RETURN; END IF;

  -- A qualifying bonus stays on the canonical quote path, including the
  -- user's approved offer. Ignore only an absent or ineligible current policy.
  SELECT enabled,"minCents","endsAt" INTO bonus_policy FROM public."DepositBonusPolicy" WHERE id='default' FOR SHARE;
  IF FOUND AND bonus_policy.enabled AND amount>=bonus_policy."minCents"
    AND (bonus_policy."endsAt" IS NULL OR bonus_policy."endsAt">clock_timestamp() AT TIME ZONE 'UTC') THEN RETURN; END IF;

  -- Match the regular creation and initialization scopes. Both budgets and
  -- the immutable leased insert share this statement's rollback boundary.
  WITH limits(key,maximum,window_ms) AS (VALUES
    ('app:chapa-inline-create:'||encode(sha256(convert_to(uid,'UTF8')),'hex'),24,3600000::bigint),
    ('app:chapa-inline-initialize:'||encode(sha256(convert_to(checkout_id,'UTF8')),'hex'),5,86400000::bigint)
  ), counted AS (
    INSERT INTO public."rateLimit" AS current(id,key,count,"lastRequest")
    SELECT gen_random_uuid()::text,key,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM limits ORDER BY key
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN current."lastRequest"<EXCLUDED."lastRequest"-(SELECT window_ms FROM limits WHERE key=EXCLUDED.key) THEN 1 ELSE LEAST(current.count+1,(SELECT maximum+1 FROM limits WHERE key=EXCLUDED.key)) END,
      "lastRequest"=CASE WHEN current."lastRequest"<EXCLUDED."lastRequest"-(SELECT window_ms FROM limits WHERE key=EXCLUDED.key) THEN EXCLUDED."lastRequest" ELSE current."lastRequest" END
    RETURNING key,count
  ) SELECT bool_and(counted.count<=limits.maximum) INTO limits_allowed FROM counted JOIN limits USING(key);
  IF limits_allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'LOWWIN_DIRECT_TOPUP_RATE_LIMITED'; END IF;

  instant := clock_timestamp() AT TIME ZONE 'UTC';
  RETURN QUERY INSERT INTO public."ChapaCheckout" (id,"userId",key,"requestHash",purpose,mode,"credentialFingerprint",initialization,
    "chargeType","flowVersion","payerPhoneCipher","phoneCipher","phoneBotId","merchantReference","amountCents",currency,"paymentMethod",
    status,reason,attempts,"leaseUntil","expiresAt","nextCheckAt","reconcileUntil","createdAt","updatedAt")
  VALUES(checkout_id,uid,command->>'key',command->>'requestHash','TOP_UP',command->>'mode',command->>'credentialFingerprint',
    initialization||jsonb_build_object('amountCents',amount::text),'DIRECT',5,command->>'payerPhoneCipher',contact_cipher,binding->>'botId',
    initialization->>'merchantReference',amount,'ETB',initialization->>'paymentMethod','SUBMITTING','AWAITING_PROVIDER',1,
    instant+interval '45 seconds',instant+interval '5 minutes',instant+interval '15 seconds',instant+interval '30 days',instant,instant)
  RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.lowwin_prepare_direct_topup(jsonb,jsonb) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.lowwin_prepare_direct_topup(jsonb,jsonb) FROM %I',browser_role); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN GRANT EXECUTE ON FUNCTION public.lowwin_prepare_direct_topup(jsonb,jsonb) TO lowwin_runtime; END IF;
END $$;
COMMIT;
