BEGIN;
SET LOCAL lock_timeout='10s';

CREATE FUNCTION public.lowwin_claim_notifications(
  p_lease_token text,p_limit integer,p_priority text,p_kind text,p_expansion boolean
) RETURNS TABLE(claimed public."Outbox", "broadcastRecipient" jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public
SET lock_timeout='5s' AS $$
DECLARE
  -- Keep the lane membership aligned with the legacy claim in leases.ts.
  expansion_kinds CONSTANT text[] := ARRAY['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS','BROADCAST_DELETE'];
  high_kinds CONSTANT text[] := ARRAY['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED'];
  claim_limit integer := CASE WHEN p_expansion THEN 1 ELSE GREATEST(1,LEAST(32,COALESCE(p_limit,12))) END;
  mixed boolean := NOT p_expansion AND p_priority IS NULL AND p_kind IS NULL AND claim_limit>1;
  bulk_slots integer := GREATEST(1,claim_limit/4);
  include_recipient boolean := NOT p_expansion AND p_priority IS DISTINCT FROM 'high' AND (p_kind IS NULL OR p_kind='BROADCAST');
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Notification claim requires READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  -- VOLATILE takes a fresh READ COMMITTED snapshot for the claim after this
  -- lock statement finishes, including any halt committed while we waited.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0));

  RETURN QUERY
  WITH running AS MATERIALIZED (
    SELECT NOT COALESCE((SELECT action='AUCTIONS_MAINTENANCE_HALTED' FROM public."AdminAudit"
      WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED')
      ORDER BY "createdAt" DESC,id DESC LIMIT 1),false) AS allowed
  ), preferred AS MATERIALIZED (
    SELECT candidate.id
    FROM (VALUES (true,claim_limit-bulk_slots),(false,bulk_slots)) AS lane(high_priority,slots)
    CROSS JOIN LATERAL (
      SELECT o.id FROM public."Outbox" o
      WHERE (SELECT allowed FROM running) AND o.state='PENDING'
        AND o."nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
        AND (o."leaseUntil" IS NULL OR o."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
        AND o.kind<>ALL(expansion_kinds) AND (o.kind=ANY(high_kinds))=lane.high_priority
      ORDER BY o."nextAttemptAt",o.id FOR UPDATE SKIP LOCKED
      LIMIT CASE WHEN mixed THEN lane.slots ELSE 0 END
    ) AS candidate
  ), additional AS MATERIALIZED (
    SELECT o.id FROM public."Outbox" o
    WHERE (SELECT allowed FROM running) AND o.state='PENDING'
      AND o."nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC')
      AND (o."leaseUntil" IS NULL OR o."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
      AND (o.kind=ANY(expansion_kinds))=p_expansion
      AND (p_kind IS NULL OR o.kind=p_kind)
      AND CASE p_priority WHEN 'high' THEN o.kind=ANY(high_kinds) WHEN 'bulk' THEN o.kind<>ALL(high_kinds) ELSE true END
      AND o.id NOT IN (SELECT id FROM preferred)
    ORDER BY o."nextAttemptAt",o.id FOR UPDATE SKIP LOCKED
    LIMIT claim_limit-(SELECT count(*) FROM preferred)
  ), picked AS (
    SELECT id FROM preferred UNION ALL SELECT id FROM additional
  ), leased AS (
    UPDATE public."Outbox" o
    SET "leaseToken"=p_lease_token,"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '120 seconds',
      "claimedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
    FROM picked WHERE o.id=picked.id
    RETURNING o AS claimed_row
  )
  SELECT l.claimed_row,CASE WHEN u.id IS NOT NULL THEN jsonb_build_object(
    'telegramId',u."telegramId",'name',u.name,'chatId',c."chatId",'blocked',c.blocked) END
  FROM leased l LEFT JOIN public."user" u
    ON include_recipient AND (l.claimed_row).kind='BROADCAST'
    AND u.id=(l.claimed_row).payload->>'recipientUserId' AND u."telegramId" IS NOT NULL
  LEFT JOIN public."BotChat" c ON c."telegramId"=u."telegramId";
END $$;

REVOKE ALL ON FUNCTION public.lowwin_claim_notifications(text,integer,text,text,boolean) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.lowwin_claim_notifications(text,integer,text,text,boolean) FROM %I',browser_role);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.lowwin_claim_notifications(text,integer,text,text,boolean) TO lowwin_runtime;
  END IF;
END $$;
COMMIT;
