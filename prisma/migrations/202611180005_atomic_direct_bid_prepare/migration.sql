BEGIN;
SET LOCAL lock_timeout='10s';

-- Safe acceleration for an existing ordinary quote. NULL-equivalent (zero
-- rows) means no writes and leaves decisions/errors to the original command.
-- VOLATILE gives the post-lock reads fresh snapshots after a waited writer.
CREATE FUNCTION public.lowwin_prepare_direct_bid(binding jsonb, command jsonb)
RETURNS SETOF public."ChapaCheckout" LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' AS $$
DECLARE
  uid text := binding->>'userId';
  checkout_id text := command->>'checkoutId';
  auction_id text;
  contact_cipher text;
  quoted public."BidBatchOrder"%ROWTYPE;
  price record;
  line record;
  numbers numeric[] := ARRAY[]::numeric[];
  bid_number numeric;
  bid_text text;
  fee_text text;
  amount bigint;
  entries integer;
  instant timestamp;
  limits_allowed boolean;
  initialization jsonb;
BEGIN
  IF uid IS NULL OR checkout_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0));
  IF COALESCE((SELECT action='AUCTIONS_MAINTENANCE_HALTED' FROM public."AdminAudit"
    WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED')
    ORDER BY "createdAt" DESC,id DESC LIMIT 1),false) THEN RETURN; END IF;

  SELECT a.id INTO auction_id FROM public."BidBatchOrder" b JOIN public."Auction" a ON a.id=b."auctionId"
    WHERE b.id=command->>'batchId' AND b."userId"=uid FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN; END IF;
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

  SELECT * INTO quoted FROM public."BidBatchOrder" b
    WHERE b.id=command->>'batchId' AND b."userId"=uid AND b."auctionId"=auction_id
      AND b."quoteHash"=command->>'quoteHash' AND b.status='QUOTED' AND b."couponId" IS NULL;
  IF NOT FOUND OR jsonb_typeof(quoted.lines) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public."ChapaCheckout" c WHERE c."batchId"=quoted.id OR (c."userId"=uid AND c.key=command->>'key')) THEN RETURN; END IF;
  entries := jsonb_array_length(quoted.lines);
  IF entries<1 OR entries>100 THEN RETURN; END IF;

  instant := clock_timestamp() AT TIME ZONE 'UTC';
  SELECT t."minPoints",t."maxPoints",t."stepPoints",t."maxDistinctBids",fee."feePoints" INTO price
    FROM public."Auction" a
    JOIN public."AuctionTerms" t ON t."auctionId"=a.id
    JOIN public."Product" p ON p.id=a."productId" AND p.visible AND NOT p."isDemo"
    JOIN public."Category" product_category ON product_category.id=p."categoryId" AND product_category.visible
    JOIN public."Category" auction_category ON auction_category.id=a."categoryId" AND auction_category.visible
    JOIN LATERAL (SELECT f.version,f."feePoints" FROM public."AuctionFeeRevision" f WHERE f."auctionId"=a.id
      ORDER BY f."effectiveAt" DESC,f.version DESC LIMIT 1) fee ON fee.version=quoted."feeVersion"
    WHERE a.id=auction_id AND a.slug=quoted."auctionSlug" AND a.status IN ('SCHEDULED','LIVE')
      AND a."publishedAt"<=instant AND a."startsAt"<=instant AND a."endsAt">instant
      AND NOT a."isDemo" AND a."testRunId" IS NULL
      AND t."ruleVersion" IN ('lowest-unique-v4','lowest-unique-v5') AND t."ruleVersion"=quoted."ruleVersion"
      AND t."stepPoints">0 AND fee."feePoints">0 AND fee."feePoints"=trunc(fee."feePoints",2)
      AND fee."feePoints"*100*entries BETWEEN 100 AND 4320000;
  IF NOT FOUND THEN RETURN; END IF;
  amount := (price."feePoints"*100*entries)::bigint;
  IF amount<>quoted."totalCents" OR amount<>quoted."grossCents" OR quoted."discountCents"<>0
    OR amount<(command->>'minimumCents')::bigint OR amount>(command->>'maximumCents')::bigint THEN RETURN; END IF;
  fee_text := to_char(price."feePoints",'FM999999999999990.00');

  FOR line IN SELECT value,ordinality FROM jsonb_array_elements(quoted.lines) WITH ORDINALITY LOOP
    bid_text := line.value->>'number';
    IF bid_text IS NULL OR bid_text !~ '^(0|[1-9][0-9]{0,15})\.[0-9]{2}$' THEN RETURN; END IF;
    bid_number := bid_text::numeric;
    IF bid_number<1 OR bid_number<price."minPoints" OR bid_number>price."maxPoints"
      OR mod(bid_number-price."minPoints",price."stepPoints")<>0 OR bid_number=ANY(numbers)
      OR line.value<>jsonb_build_object('position',line.ordinality-1,'number',bid_text,'grossFee',fee_text,'discount','0.00','netFee',fee_text)
    THEN RETURN; END IF;
    numbers := array_append(numbers,bid_number);
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM public."Bid" b WHERE b."userId"=uid AND b."auctionId"=auction_id
    HAVING count(*)+entries>price."maxDistinctBids" OR bool_or(b.amount=ANY(numbers))
  ) THEN RETURN; END IF;

  initialization := (command->'initialization') || jsonb_build_object('amountCents',amount::text,'batch',jsonb_build_object(
    'id',quoted.id,'quoteHash',quoted."quoteHash",'auctionSlug',quoted."auctionSlug",'ruleVersion',quoted."ruleVersion",
    'feeVersion',quoted."feeVersion",'lines',quoted.lines,'entryCount',entries,
    'total',to_char(amount::numeric/100,'FM999999999999990.00'),'totalCents',amount::text,
    'grossTotal',to_char(amount::numeric/100,'FM999999999999990.00'),'discountTotal','0.00','status',quoted.status));

  -- Consume the ordinary Direct5 creation + first dispatch budgets together.
  -- The statement rolls back both counters if either is exhausted, or the
  -- immutable insert fails. Match the original windows and sorted lock order.
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
  IF limits_allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'LOWWIN_DIRECT_BID_RATE_LIMITED'; END IF;

  instant := clock_timestamp() AT TIME ZONE 'UTC';
  RETURN QUERY INSERT INTO public."ChapaCheckout" (id,"userId",key,"requestHash",purpose,mode,"credentialFingerprint",initialization,
    "chargeType","flowVersion","batchId","payerPhoneCipher","phoneCipher","phoneBotId","merchantReference","amountCents",currency,"paymentMethod",
    "auctionId","auctionSlug","bidNumber","feeVersion","grossFee","discountPoints",status,reason,attempts,
    "leaseUntil","expiresAt","nextCheckAt","reconcileUntil","createdAt","updatedAt")
  VALUES(checkout_id,uid,command->>'key',command->>'requestHash','BID',command->>'mode',command->>'credentialFingerprint',initialization,
    'DIRECT',5,quoted.id,command->>'payerPhoneCipher',contact_cipher,binding->>'botId',initialization->>'merchantReference',amount,'ETB',initialization->>'paymentMethod',
    auction_id,quoted."auctionSlug",numbers[1],quoted."feeVersion",amount::numeric/100,0,'SUBMITTING','AWAITING_PROVIDER',1,
    instant+interval '45 seconds',instant+interval '5 minutes',instant+interval '15 seconds',instant+interval '30 days',instant,instant)
  RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.lowwin_prepare_direct_bid(jsonb,jsonb) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.lowwin_prepare_direct_bid(jsonb,jsonb) FROM %I',browser_role); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN GRANT EXECUTE ON FUNCTION public.lowwin_prepare_direct_bid(jsonb,jsonb) TO lowwin_runtime; END IF;
END $$;
COMMIT;
