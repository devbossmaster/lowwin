BEGIN;
SET LOCAL lock_timeout='10s';

-- The shared maintenance lock must be acquired in a separate statement from
-- the gate read. VOLATILE takes a fresh snapshot after a concurrent halt.
CREATE FUNCTION public.lowwin_gate_notification(command jsonb)
RETURNS TABLE(reason text,"renewedUntil" timestamp(3))
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public
SET lock_timeout='5s'
AS $$
DECLARE
 outbox_id text := command->>'outboxId';
 lease_token text := command->>'leaseToken';
 logical_key text := command->>'logicalKey';
 notification_kind text := command->>'kind';
 root_key text := command->>'rootKey';
 recipient_present boolean := COALESCE(jsonb_typeof(command->'recipient')='object',false);
 telegram_id text := command#>>'{recipient,telegramId}';
 chat_id text := command#>>'{recipient,chatId}';
 recipient_user_id text := command#>>'{recipient,userId}';
 exclude_staff boolean := COALESCE((command#>>'{recipient,excludeStaff}')::boolean,false) AND NULLIF(recipient_user_id,'') IS NOT NULL;
 payload_user_id text := command->>'payloadUserId';
 auction_id text := command->>'auctionId';
 settlement_id text := command->>'settlementId';
 batch_id text := command->>'batchId';
 bid_id text := command->>'bidId';
 checkout_id text := command->>'checkoutId';
 intent_id text := command->>'intentId';
 refund_id text := command->>'refundId';
 bot_id text := command->>'botId';
 chapa_mode text := command->>'chapaMode';
 scheduled_start_at text := command->>'scheduledStartAt';
 upcoming_lead_ms integer := (command->>'upcomingLeadMs')::integer;
 upcoming_grace_ms integer := (command->>'upcomingGraceMs')::integer;
 reminder_min_ms integer := (command->>'reminderMinMs')::integer;
 reminder_max_ms integer := (command->>'reminderMaxMs')::integer;
 checked_at timestamp;
 lease_until timestamp(3);
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Notification gate requires READ COMMITTED' USING ERRCODE='0A000';
 END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0));

 SELECT stamp.now,o."leaseUntil",CASE
  WHEN (SELECT action FROM public."AdminAudit" WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1)='AUCTIONS_MAINTENANCE_HALTED' THEN 'MAINTENANCE_PAUSED'
  WHEN o.id IS NULL OR o.state<>'PENDING' OR o."leaseToken" IS DISTINCT FROM lease_token OR o."leaseUntil" IS NULL OR o."leaseUntil"<=stamp.now THEN 'CLAIM_REPLACED'
  WHEN EXISTS(SELECT 1 FROM public."Outbox" root WHERE root.key=root_key AND root."lastError"='CAMPAIGN_STOPPED') THEN 'CAMPAIGN_STOPPED'
  WHEN logical_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."TelegramDeliveryLease" l WHERE l.key=logical_key AND l."leaseToken"=lease_token AND l."sentAt" IS NULL AND l."leaseUntil">stamp.now) THEN 'CLAIM_REPLACED'
  WHEN recipient_present AND EXISTS(SELECT 1 FROM public."BotChat" c WHERE c."telegramId"=telegram_id AND c.blocked) THEN 'CHAT_BLOCKED'
  WHEN recipient_present AND NOT EXISTS(SELECT 1 FROM public."BotChat" c WHERE c."telegramId"=telegram_id AND c."chatId"=chat_id AND NOT c.blocked) THEN 'CHAT_NOT_STARTED'
  WHEN exclude_staff AND NOT EXISTS(SELECT 1 FROM public."user" u LEFT JOIN public."StaffMember" s ON s."userId"=u.id WHERE u.id=recipient_user_id AND u."telegramId"=telegram_id AND u.role<>'admin' AND s."userId" IS NULL) THEN 'RECIPIENT_INELIGIBLE'
  WHEN recipient_present AND NOT EXISTS(SELECT 1 FROM public."user" u WHERE u.id=recipient_user_id AND u."telegramId"=telegram_id) THEN 'RECIPIENT_INELIGIBLE'
  WHEN recipient_present AND chat_id IS DISTINCT FROM telegram_id THEN 'PRIVATE_CHAT_REQUIRED'
  WHEN recipient_present AND EXISTS(SELECT 1 FROM public."NotificationPreference" n WHERE n."userId"=recipient_user_id AND NOT n.telegram) THEN 'RECIPIENT_UNSUBSCRIBED'
  WHEN notification_kind IN ('DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED') AND (payload_user_id IS NULL OR payload_user_id IS DISTINCT FROM recipient_user_id) THEN 'RECIPIENT_INELIGIBLE'
  WHEN notification_kind='DEPOSIT_CREDITED' AND NOT (
   EXISTS(SELECT 1 FROM public."ChapaCheckout" c JOIN public."Journal" j ON j.id=c."creditJournalId" WHERE c.id=checkout_id AND c."userId"=payload_user_id AND c.currency='ETB' AND c."amountCents">0 AND c."phoneBotId"=bot_id AND c.mode=chapa_mode AND c."providerStatus"='SUCCESS' AND c."verificationState"='VERIFIED' AND ((c.purpose='TOP_UP' AND c.status='CREDITED') OR (c.purpose='BID' AND c.status='NEEDS_REVIEW' AND c."bidId" IS NULL)))
   OR EXISTS(SELECT 1 FROM public."TopUpIntent" t JOIN public."Journal" j ON j.id=t."journalId" WHERE t.id=intent_id AND t."userId"=payload_user_id AND t.status='CREDITED' AND t.points>0)
  ) THEN 'DEPOSIT_NOT_CREDITED'
  WHEN notification_kind='BID_ACCEPTED' AND NOT (
   (NULLIF(batch_id,'') IS NOT NULL AND EXISTS(SELECT 1 FROM public."BidBatchOrder" b WHERE b.id=batch_id AND b."userId"=payload_user_id AND b."auctionId"=auction_id AND b.status='ACCEPTED' AND b.receipt IS NOT NULL))
   OR (NULLIF(batch_id,'') IS NULL AND EXISTS(SELECT 1 FROM public."Bid" b JOIN public."Operation" op ON op.id=b."operationId" WHERE b.id=bid_id AND b."userId"=payload_user_id AND b."auctionId"=auction_id AND op."userId"=b."userId" AND op.scope='BID'))
  ) THEN 'BID_NOT_ACCEPTED'
  WHEN notification_kind='AUCTION_FEE_REFUNDED' AND NOT EXISTS(
   SELECT 1 FROM public."AuctionRefund" r JOIN public."AuctionSettlement" s ON s.id=r."settlementId" JOIN public."Operation" op ON op.id=r."operationId" JOIN public."Journal" j ON j."operationId"=op.id
   WHERE r.id=refund_id AND r."userId"=payload_user_id AND s.id=settlement_id AND s."auctionId"=auction_id AND s.outcome='CANCELLED' AND r.status='COMPLETED' AND r."completedAt"<=stamp.now
    AND op."userId"=r."userId" AND op.scope='AUCTION_FEE_REFUND' AND op.key=r.id AND op.result->>'refundId'=r.id AND op.result->>'settlementId'=s.id AND j.kind='AUCTION_FEE_REFUND'
  ) THEN 'REFUND_NOT_COMMITTED'
  WHEN notification_kind='WINNER_CONGRATULATIONS' AND NOT EXISTS(
   SELECT 1 FROM public."AuctionSettlement" s JOIN public."Auction" a ON a.id=s."auctionId" JOIN public."ResultPublication" pub ON pub."settlementId"=s.id JOIN public."Bid" b ON b.id=s."winningBidId"
   WHERE s.id=settlement_id AND s."auctionId"=auction_id AND s.outcome='WINNER' AND s."winnerUserId"=payload_user_id AND b."userId"=s."winnerUserId" AND b."auctionId"=s."auctionId" AND b.amount=s."winningPoints" AND a.status='CLOSED' AND s.cutoff<=stamp.now AND s."completedAt"<=stamp.now AND pub."publishedAt"<=stamp.now
  ) THEN 'RESULT_NOT_PUBLISHED'
  WHEN notification_kind='AUCTION_ENDED' AND NOT EXISTS(SELECT 1 FROM public."Auction" a JOIN public."AuctionSettlement" s ON s."auctionId"=a.id JOIN public."ResultPublication" pub ON pub."settlementId"=s.id WHERE a.id=auction_id AND (settlement_id IS NULL OR s.id=settlement_id) AND a.status IN ('CLOSED','CANCELLED') AND s.cutoff<=stamp.now AND s."completedAt"<=stamp.now AND pub."publishedAt"<=stamp.now) THEN 'RESULT_NOT_PUBLISHED'
  WHEN notification_kind NOT IN ('AUCTION_ENDED','AUCTION_FEE_REFUNDED') AND (notification_kind='BROADCAST' OR left(notification_kind,8)='AUCTION_') AND NULLIF(auction_id,'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Auction" a JOIN public."Product" product ON product.id=a."productId" WHERE a.id=auction_id AND a.status IN ('LIVE','SCHEDULED') AND a."endsAt">stamp.now AND product.visible AND a."publishedAt"<=stamp.now AND NOT EXISTS(SELECT 1 FROM public."AuctionSettlement" s WHERE s."auctionId"=a.id)) THEN 'AUCTION_RETIRED'
  WHEN notification_kind IN ('BROADCAST','AUCTION_PUBLISHED') AND NULLIF(auction_id,'') IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public."Auction" a JOIN public."Product" product ON product.id=a."productId" JOIN public."Category" pc ON pc.id=product."categoryId" LEFT JOIN public."Category" ac ON ac.id=a."categoryId"
   WHERE a.id=auction_id AND a.status IN ('LIVE','SCHEDULED') AND a."startsAt"<=stamp.now AND a."endsAt">stamp.now AND a."publishedAt"<=stamp.now AND a."publicCode">0 AND a.slug IS NOT NULL AND product.visible AND pc.visible AND (ac.id IS NULL OR ac.visible) AND (notification_kind='AUCTION_PUBLISHED' OR NOT a."isDemo") AND a."testRunId" IS NULL
    AND NOT EXISTS(SELECT 1 FROM public."AuctionSettlement" s WHERE s."auctionId"=a.id) AND NOT EXISTS(SELECT 1 FROM public."PublicAuctionResult" r WHERE r."auctionId"=a.id)
  ) THEN 'AUCTION_RETIRED'
  WHEN notification_kind='AUCTION_UPCOMING' AND NOT EXISTS(SELECT 1 FROM public."Auction" a WHERE a.id=auction_id
   AND to_char(a."startsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=scheduled_start_at
   AND a."publishedAt"<=a."startsAt"-upcoming_lead_ms*interval '1 millisecond'
   AND a."startsAt"<=stamp.now+upcoming_lead_ms*interval '1 millisecond'
   AND a."startsAt">stamp.now+(upcoming_lead_ms-upcoming_grace_ms)*interval '1 millisecond') THEN 'AUCTION_RETIRED'
  WHEN reminder_min_ms IS NOT NULL AND NULLIF(auction_id,'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Auction" a WHERE a.id=auction_id
   AND a.status IN ('LIVE','SCHEDULED') AND a."startsAt"<=stamp.now AND a."endsAt">stamp.now+reminder_min_ms*interval '1 millisecond' AND a."endsAt"<=stamp.now+reminder_max_ms*interval '1 millisecond') THEN 'AUCTION_RETIRED'
  ELSE NULL END
 INTO checked_at,lease_until,reason
 FROM (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now) stamp LEFT JOIN public."Outbox" o ON o.id=outbox_id;

 IF reason IS NULL AND lease_until-date_trunc('milliseconds',checked_at)<interval '45 seconds' THEN
  -- This block is a subtransaction. If either token changed while acquiring
  -- its write lock, neither lease renewal survives.
  BEGIN
   "renewedUntil":=date_trunc('milliseconds',checked_at)+interval '120 seconds';
   UPDATE public."Outbox" o SET "leaseUntil"="renewedUntil"
    WHERE o.id=outbox_id AND o.state='PENDING' AND o."leaseToken"=lease_token;
   IF NOT FOUND THEN RAISE SQLSTATE 'LW101'; END IF;
   IF NULLIF(logical_key,'') IS NOT NULL THEN
    UPDATE public."TelegramDeliveryLease" l SET "leaseUntil"="renewedUntil"
     WHERE l.key=logical_key AND l."leaseToken"=lease_token AND l."sentAt" IS NULL;
    IF NOT FOUND THEN RAISE SQLSTATE 'LW101'; END IF;
   END IF;
  EXCEPTION WHEN SQLSTATE 'LW101' THEN
   reason:='CLAIM_REPLACED';
   "renewedUntil":=NULL;
  END;
 END IF;
 RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.lowwin_gate_notification(jsonb) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.lowwin_gate_notification(jsonb) FROM %I',browser_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN
  GRANT EXECUTE ON FUNCTION public.lowwin_gate_notification(jsonb) TO lowwin_runtime;
 END IF;
END $$;
COMMIT;
