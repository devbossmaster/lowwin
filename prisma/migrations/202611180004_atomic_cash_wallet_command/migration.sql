BEGIN;
SET LOCAL lock_timeout='10s';

-- The common cash-only command keeps the existing financial tables and every
-- acceptance, posting, hold, immutable-record and deferred proof trigger. Its
-- statements execute beside Postgres rather than requiring a remote RTT each.
-- VOLATILE is essential: reads after a waited lock need a fresh statement
-- snapshot. Never combine a lock wait and its mutable balance read in a CTE.
CREATE FUNCTION public.lowwin_cash_wallet_batch(binding jsonb,command jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' AS $$
DECLARE
 uid text:=binding->>'userId';
 a public."Auction"%ROWTYPE;
 terms public."AuctionTerms"%ROWTYPE;
 fee public."AuctionFeeRevision"%ROWTYPE;
 w public."Wallet"%ROWTYPE;
 available public."LedgerAccount"%ROWTYPE;
 held public."LedgerAccount"%ROWTYPE;
 fees public."LedgerAccount"%ROWTYPE;
 member record;
 child jsonb;
 inserted public."Bid"%ROWTYPE;
 notice jsonb:=command->'notice';
 own jsonb;
 receipts jsonb:='[]'::jsonb;
 public_receipts jsonb:='[]'::jsonb;
 bids jsonb:='[]'::jsonb;
 ids jsonb:='[]'::jsonb;
 entry jsonb;
 bid_json jsonb;
 stored_receipt jsonb;
 batch_json jsonb;
 wallet_json jsonb;
 total numeric;
 cash_after numeric;
 fee_text text;
 fee_fixed text;
 raw_product text;
 product text;
 title text;
 body text;
 batch_id text:=command->>'batchId';
 quote_hash text;
 n integer;
 i integer:=0;
 existing_count integer;
 revision text;
 halted boolean;
BEGIN
 IF uid IS NULL OR binding->>'sessionId' IS NULL OR binding->>'sessionToken' IS NULL
  OR binding->>'telegramId' IS NULL OR binding->>'botId' IS NULL
  OR binding->>'telegramAuthSource' NOT IN ('MINI_APP','TELEGRAM_OIDC')
 THEN RETURN jsonb_build_object('kind','error','code','UNAUTHORIZED'); END IF;
 IF command ? 'couponId' OR jsonb_typeof(command->'numbers')<>'array'
  OR jsonb_typeof(command->'children')<>'array' OR jsonb_typeof(command->'lines')<>'array'
 THEN RETURN NULL; END IF;
 n:=jsonb_array_length(command->'numbers');
 IF n<1 OR n>100 OR jsonb_array_length(command->'children')<>n OR jsonb_array_length(command->'lines')<>n THEN RETURN NULL; END IF;

 -- Same global writer order as every existing auction/wallet command.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0));
 SELECT COALESCE((SELECT action='AUCTIONS_MAINTENANCE_HALTED' FROM public."AdminAudit"
  WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1),false) INTO halted;
 SELECT * INTO a FROM public."Auction" WHERE slug=command->>'auctionSlug' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wallet:'||uid,0));

 SELECT s."telegramLaunchId",s."telegramAuthSource",u."telegramId",u.role,
  c."telegramId" AS contact_id,c."botId",c."revokedAt",staff."userId" AS staff_id,COALESCE(r.suspended,false) AS suspended
 INTO member FROM public."session" s JOIN public."user" u ON u.id=s."userId"
 LEFT JOIN public."TelegramOwnContact" c ON c."userId"=u.id
 LEFT JOIN public."StaffMember" staff ON staff."userId"=u.id
 LEFT JOIN public."UserRestriction" r ON r."userId"=u.id
 WHERE s.id=binding->>'sessionId' AND s.token=binding->>'sessionToken' AND s."userId"=uid
  AND s."expiresAt">clock_timestamp() AT TIME ZONE 'UTC';
 IF NOT FOUND OR member."telegramLaunchId" IS DISTINCT FROM binding->>'telegramId'
  OR member."telegramAuthSource" IS DISTINCT FROM binding->>'telegramAuthSource'
  OR member."telegramId" IS DISTINCT FROM binding->>'telegramId' OR member.staff_id IS NOT NULL
  OR member.contact_id IS DISTINCT FROM member."telegramId" OR member."revokedAt" IS NOT NULL
  OR member."botId" IS DISTINCT FROM binding->>'botId'
 THEN RETURN jsonb_build_object('kind','error','code','UNAUTHORIZED'); END IF;

 -- Replays/quoted originals keep the existing ownership, receipt projection,
 -- cross-adapter and immutable-hash checks. This branch has written nothing.
 IF EXISTS(SELECT 1 FROM public."BidBatchOrder" WHERE "userId"=uid AND key=command->>'key') THEN RETURN NULL; END IF;
 IF halted THEN RETURN jsonb_build_object('kind','error','code','AUCTIONS_PAUSED'); END IF;
 IF member.role<>'member' OR member.suspended THEN RETURN jsonb_build_object('kind','error','code','BIDDING_RESTRICTED'); END IF;
 SELECT * INTO terms FROM public."AuctionTerms" WHERE "auctionId"=a.id;
 IF NOT FOUND OR terms."ruleVersion" NOT IN ('lowest-unique-v4','lowest-unique-v5') OR terms."minPoints"<>1 OR terms."stepPoints"<>0.01 OR terms."maxPoints" IS NOT NULL
  OR a."isDemo" OR a."testRunId" IS NOT NULL THEN RETURN NULL; END IF;
 SELECT COALESCE(NULLIF(a.presentation->>'titleAm',''),NULLIF(p."titleAm",''),NULLIF(a.presentation->>'title',''),p.title)
 INTO raw_product FROM public."Product" p JOIN public."Category" pc ON pc.id=p."categoryId"
 JOIN public."Category" ac ON ac.id=a."categoryId"
 WHERE p.id=a."productId" AND p.visible AND pc.visible AND ac.visible AND NOT p."isDemo";
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- A deliberately bounded presentation path reuses the exact copy template.
 -- Titles needing HTML/control/format cleanup keep the original TS helper.
 IF raw_product IS NULL OR raw_product !~ '^[[:alnum:]ሀ-፼[:space:].,''’/()+&!?:–—#-]+$' THEN RETURN NULL; END IF;
 product:=left(btrim(regexp_replace(normalize(raw_product,NFC),'[[:space:]]+',' ','g')),140);
 IF product='' THEN RETURN NULL; END IF;
 SELECT * INTO fee FROM public."AuctionFeeRevision" WHERE "auctionId"=a.id ORDER BY "effectiveAt" DESC,version DESC LIMIT 1;
 IF NOT FOUND OR fee.version<>(command->>'feeVersion')::integer OR fee."effectiveAt">clock_timestamp() AT TIME ZONE 'UTC' THEN RETURN NULL; END IF;
 total:=fee."feePoints"*n;
 IF total<>(command->>'approvedTotal')::numeric OR total*100>4320000 THEN RETURN NULL; END IF;
 IF total>0 AND NOT COALESCE((command->>'walletEnabled')::boolean,false) THEN RETURN NULL; END IF;
 -- First-paid referral qualification remains entirely in its existing code.
 IF EXISTS(SELECT 1 FROM public."ReferralSignup" WHERE "referredUserId"=uid AND "firstBidId" IS NULL) THEN RETURN NULL; END IF;
 SELECT * INTO w FROM public."Wallet" WHERE "userId"=uid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Lock only: unlike lock_wallet_hold_state, this does not advance a revision
 -- on unsupported/replayed/declined requests. Read balances AFTER any wait.
 PERFORM 1 FROM public."WalletHoldGuard" WHERE "walletId"=w.id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO available FROM public."LedgerAccount" WHERE "walletId"=w.id AND kind='AVAILABLE';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO held FROM public."LedgerAccount" WHERE "walletId"=w.id AND kind='HELD';
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public."LedgerAccount" WHERE "walletId"=w.id AND kind='BONUS' AND balance<>0)
  OR EXISTS(SELECT 1 FROM public."DepositBonusLot" WHERE "userId"=uid AND "expiresAt">clock_timestamp() AT TIME ZONE 'UTC')
  OR EXISTS(SELECT 1 FROM public."AuctionHold" WHERE "walletId"=w.id AND "auctionId"=a.id AND points<>0)
 THEN RETURN NULL; END IF;
 SELECT * INTO fees FROM public."LedgerAccount" WHERE name='platform:fees';
 IF total>0 AND NOT FOUND THEN RETURN NULL; END IF;
 -- Preserve the original validation precedence before insufficient-funds copy.
 IF available.balance<total THEN RETURN NULL; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'amount',trim_scale(amount)::text,
  'acceptedAt',to_char("acceptedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY "acceptedAt",id),'[]'::jsonb),count(*)
 INTO own,existing_count FROM public."Bid" WHERE "auctionId"=a.id AND "userId"=uid;
 -- Keep the original public validation/error contract for an already accepted
 -- number. The canonical unique constraint remains enabled on every INSERT.
 IF EXISTS(SELECT 1 FROM public."Bid" b WHERE b."auctionId"=a.id AND b."userId"=uid
  AND b.amount IN (SELECT value::numeric FROM jsonb_array_elements_text(command->'numbers'))) THEN RETURN NULL; END IF;
 fee_text:=trim_scale(fee."feePoints")::text;
 fee_fixed:=to_char(fee."feePoints",'FM999999999999999990.00');
 quote_hash:=command->'quoteHashes'->>terms."ruleVersion";
 IF quote_hash IS NULL OR quote_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;

 -- From here, all failures abort the entire autocommit command. No fallback is
 -- permitted after a transport/trigger/constraint failure. Number bounds,
 -- precision, uniqueness, cap, fee revision and actual acceptance timestamp
 -- remain owned by the SAME Bid triggers used by the original command.
 PERFORM public.lock_wallet_hold_state(w.id);
 INSERT INTO public."BidBatchOrder"(id,"userId",key,"requestHash","quoteHash","auctionId","auctionSlug","ruleVersion","feeVersion",lines,"totalCents","grossCents","discountCents",status,"updatedAt")
 VALUES(batch_id,uid,command->>'key',command->>'requestHash',quote_hash,a.id,a.slug,terms."ruleVersion",fee.version,command->'lines',(total*100)::bigint,(total*100)::bigint,0,'QUOTED',clock_timestamp() AT TIME ZONE 'UTC');
 FOR child IN SELECT value FROM jsonb_array_elements(command->'children') LOOP
  INSERT INTO public."Bid"(id,"userId","auctionId",amount,"termsVersion","feePoints","feeRevisionId","operationId")
  VALUES(child->>'id',uid,a.id,(command->'numbers'->>i)::numeric,fee.version,fee."feePoints",fee.id,child->>'operationId') RETURNING * INTO inserted;
  bid_json:=jsonb_build_object('id',inserted.id,'auctionCode',a.code,'auctionSlug',a.slug,'amount',trim_scale(inserted.amount)::text,
   'acceptedAt',to_char(inserted."acceptedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'termsVersion',fee.version,'feePoints',fee_text);
  own:=own||jsonb_build_array(jsonb_build_object('id',inserted.id,'amount',trim_scale(inserted.amount)::text,'acceptedAt',bid_json->>'acceptedAt'));
  cash_after:=available.balance-fee."feePoints"*(i+1);
  entry:=jsonb_build_object('bid',bid_json,'hold',jsonb_build_object('previousMax','0','newMax','0','extraReserved','0'),
   'charge',jsonb_build_object('feePoints',fee_text,'newlyUnavailable',fee_text),
   'wallet',jsonb_build_object('available',trim_scale(cash_after)::text,'held',trim_scale(held.balance)::text,'cashAvailable',trim_scale(cash_after)::text,'bonusAvailable','0','bonusExpiresAt',NULL),
   'remainingSubmissions',terms."maxDistinctBids"-existing_count-i-1,'ownBids',own);
  INSERT INTO public."Operation"(id,"userId",scope,key,"requestHash",result)
  VALUES(child->>'operationId',uid,'BID',child->>'key',child->>'requestHash',entry);
  IF fee."feePoints">0 THEN
   INSERT INTO public."Journal"(id,"operationId",kind,reference) VALUES(child->>'journalId',child->>'operationId','BID_FEE','bid:'||inserted.id);
   INSERT INTO public."Posting"(id,"journalId","accountId",delta) VALUES
    (child->'postingIds'->>0,child->>'journalId',available.id,-fee."feePoints"),
    (child->'postingIds'->>1,child->>'journalId',fees.id,fee."feePoints");
  END IF;
  receipts:=receipts||jsonb_build_array(entry);
  public_receipts:=public_receipts||jsonb_build_array(jsonb_build_object('bid',bid_json,'charge',entry->'charge'));
  bids:=bids||jsonb_build_array(bid_json);ids:=ids||jsonb_build_array(inserted.id);i:=i+1;
 END LOOP;
 UPDATE public."Auction" SET "acceptedBidCount"="acceptedBidCount"+n WHERE id=a.id;
 stored_receipt:=entry||jsonb_build_object('bid',receipts->0->'bid','bids',bids,'receipts',receipts,'batchId',batch_id,
  'total',to_char(total,'FM999999999999999990.00'),'charge',jsonb_build_object('feePoints',to_char(total,'FM999999999999999990.00'),
   'discountPoints','0.00','netFeePoints',to_char(total,'FM999999999999999990.00'),'newlyUnavailable',to_char(total,'FM999999999999999990.00')));
 UPDATE public."BidBatchOrder" SET status='ACCEPTED',receipt=stored_receipt,"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=batch_id;
 INSERT INTO public."Outbox"(id,key,kind,payload) VALUES(command->>'outboxId','bid-batch:'||batch_id||':accepted','BID_ACCEPTED',
  jsonb_build_object('auctionId',a.id,'recipientUserId',uid,'batchId',batch_id,'bidId',receipts->0->'bid'->>'id'));
 IF notice IS NOT NULL AND COALESCE((SELECT "inApp" FROM public."NotificationPreference" WHERE "userId"=uid),true) THEN
  title:=notice->>'title';body:=replace(notice->>'body',command->>'productMarker',product);
  INSERT INTO public."NotificationInbox"(id,key,"userId",kind,title,body,href)
  VALUES(command->>'inboxId','bid-batch:'||batch_id||':accepted',uid,'BID_ACCEPTED',title,body,'/my-bids') ON CONFLICT(key) DO NOTHING;
 END IF;
 SELECT g.revision::text INTO revision FROM public."WalletHoldGuard" g WHERE g."walletId"=w.id;
 wallet_json:=jsonb_build_object('available',to_char(cash_after,'FM999999999999999990.00'),'held',to_char(held.balance,'FM999999999999999990.00'),
  'cashAvailable',trim_scale(cash_after)::text,'bonusAvailable','0','bonusExpiresAt',NULL,'revision',revision);
 batch_json:=jsonb_build_object('id',batch_id,'quoteHash',quote_hash,'auctionSlug',a.slug,'ruleVersion',terms."ruleVersion",'feeVersion',fee.version,
  'lines',command->'lines','entryCount',n,'total',to_char(total,'FM999999999999999990.00'),'totalCents',(total*100)::bigint::text,
  'grossTotal',to_char(total,'FM999999999999999990.00'),'discountTotal','0.00','status','ACCEPTED');
 RETURN jsonb_build_object('kind','receipt','receipt',jsonb_build_object('batch',batch_json,'receipts',public_receipts,'wallet',wallet_json,
  'payment',jsonb_build_object('method','wallet','gateway','INTERNAL_WALLET','total',to_char(total,'FM999999999999999990.00'),'acceptedBidIds',ids)));
END $$;
REVOKE ALL ON FUNCTION public.lowwin_cash_wallet_batch(jsonb,jsonb) FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
 FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.lowwin_cash_wallet_batch(jsonb,jsonb) FROM %I',browser_role); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lowwin_runtime') THEN GRANT EXECUTE ON FUNCTION public.lowwin_cash_wallet_batch(jsonb,jsonb) TO lowwin_runtime; END IF;
END $$;
COMMIT;
