-- Separate OWNER procedure, only after the exact refund reset committed.
-- All data removal is atomic. Money, identities and authentication stay intact.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='120s';
DO $purge$
DECLARE c jsonb:=__CATALOG_CONFIG__; item jsonb; actual record; proof jsonb; triggers jsonb; t jsonb; already record;
 allowed text[]:=ARRAY['NotificationInbox','TelegramMessage','Outbox','FulfillmentCase','AuctionFavorite','SettlementMovement','AuctionSettlement','PublicAuctionResult','Bid','AuctionHold','AuctionControlRevision','AuctionFeeRevision','AuctionTerms','AuctionDraft','Auction','ProductImage','Product','Category','ManagedMedia','SupportCase'];
BEGIN
 IF c->>'executionAcknowledgement'<>'EXECUTE_REVIEWED_CATALOG_PURGE' OR c->>'backupAcknowledgement'<>'RESTORABLE_BACKUP_VERIFIED' OR c->>'workersAcknowledgement'<>'ALL_AUCTION_AND_NOTIFICATION_WORKERS_DRAINED' THEN RAISE EXCEPTION 'Purge review gate: verify backup, drain all auction/notification workers and approve this exact inventory'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lowwin:auction-maintenance',0));
 SELECT "requestHash" INTO already FROM "AdminAudit" WHERE "operationKey"='reset:'||(c->>'runId')||':catalog-purge';
 IF FOUND THEN
  IF already."requestHash"<>c->>'manifestHash' THEN RAISE EXCEPTION 'Purge run was reused with another manifest'; END IF;
  RAISE NOTICE 'This exact catalog purge already completed; no financial or catalog change.'; RETURN;
 END IF;
 IF clock_timestamp()-(c->>'snapshotAt')::timestamptz NOT BETWEEN interval '-1 minute' AND interval '24 hours' THEN RAISE EXCEPTION 'Purge inventory is stale; repeat the read-only audit'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "AdminAudit" WHERE "operationKey"='reset:'||(c->>'runId')||':complete' AND "requestHash"=c->>'refundManifestHash') THEN RAISE EXCEPTION 'Exact refund reset has not completed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM(SELECT action,details FROM "AdminAudit" WHERE action IN('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1)s WHERE action='AUCTIONS_MAINTENANCE_HALTED' AND details->>'runId'=c->>'runId') THEN RAISE EXCEPTION 'Matching maintenance must remain active'; END IF;
 -- Table locks cover the entire short deletion window. No foreign-key trigger
 -- or ledger guard is disabled; there is no CASCADE or replication-role bypass.
 FOR item IN SELECT value FROM jsonb_array_elements(c->'tables') ORDER BY value->>'name' LOOP
  IF NOT (item->>'name'=ANY(allowed)) THEN RAISE EXCEPTION 'Unapproved deletion table'; END IF;
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',item->>'name');
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(c->'protectedTables') ORDER BY value->>'name' LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',item->>'name');
 END LOOP;
 SELECT * INTO actual FROM (__SCHEMA_QUERY__) s;
 IF actual.fingerprint<>c->>'schemaFingerprint' THEN RAISE EXCEPTION 'Schema changed since purge review'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements((c->'tables')||(c->'protectedTables')) LOOP
  EXECUTE format('SELECT COUNT(*)::int AS count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE "C"),''[]''::jsonb)::text,''UTF8'')),''hex'') AS fingerprint FROM public.%I r',item->>'name') INTO actual;
  IF actual.count<>(item->>'count')::int OR actual.fingerprint<>item->>'fingerprint' THEN RAISE EXCEPTION 'Reviewed table % changed; re-audit without altering any user or balance',item->>'name'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM "Auction" a LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id WHERE a.status<>'CANCELLED' OR s.outcome IS DISTINCT FROM 'CANCELLED') OR EXISTS(SELECT 1 FROM "AuctionHold" WHERE points<>0) OR EXISTS(SELECT 1 FROM "LedgerAccount" WHERE kind='HELD' AND balance<>0) THEN RAISE EXCEPTION 'Only completely cancelled, refunded auctions with zero holds can be removed'; END IF;
 -- The compact sealed financial proof explains old money movements after the
 -- operational Bid/Auction rows go away. Ordinary customer history is cleared.
 proof:=jsonb_build_object('runId',c->>'runId','refundManifestHash',c->>'refundManifestHash');
 FOR item IN SELECT value FROM jsonb_array_elements(c->'tables') WHERE value->>'name'=ANY(ARRAY['Auction','AuctionTerms','AuctionFeeRevision','Bid','AuctionSettlement','SettlementMovement','Product','Category']) LOOP
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE "C"),''[]''::jsonb) AS snapshot FROM public.%I r',item->>'name') INTO actual;
  proof:=proof||jsonb_build_object(item->>'name',actual.snapshot);
 END LOOP;
 INSERT INTO "AdminAudit"(id,"actorId",action,target,"operationKey","requestHash",details,"createdAt") SELECT gen_random_uuid()::text,a."actorId",'RESET_CATALOG_FINANCIAL_PROOF',c->>'runId','reset:'||(c->>'runId')||':catalog-proof',c->>'manifestHash',proof,clock_timestamp() FROM "AdminAudit" a WHERE a."operationKey"='reset:'||(c->>'runId')||':complete';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('table',r.relname,'name',g.tgname,'mode',g.tgenabled)),'[]'::jsonb) INTO triggers FROM pg_trigger g JOIN pg_class r ON r.oid=g.tgrelid JOIN pg_proc p ON p.oid=g.tgfoid WHERE r.relnamespace='public'::regnamespace AND r.relname=ANY(allowed) AND NOT g.tgisinternal AND p.proname IN('reject_immutable_change','protect_settlement_outbox');
 FOR t IN SELECT value FROM jsonb_array_elements(triggers) LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I',t->>'table',t->>'name'); END LOOP;
 -- Dependency order is explicit. All retained financial foreign keys still run.
 FOR item IN SELECT value FROM jsonb_array_elements(c->'tables') LOOP
  EXECUTE format('DELETE FROM public.%I',item->>'name');
 END LOOP;
 FOR t IN SELECT value FROM jsonb_array_elements(triggers) LOOP
  EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I',t->>'table',CASE t->>'mode' WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'D' THEN 'DISABLE' ELSE 'ENABLE' END,t->>'name');
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(c->'protectedTables') LOOP
  EXECUTE format('SELECT COUNT(*)::int AS count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE "C"),''[]''::jsonb)::text,''UTF8'')),''hex'') AS fingerprint FROM public.%I r',item->>'name') INTO actual;
  IF actual.count<>(item->>'count')::int OR actual.fingerprint<>item->>'fingerprint' THEN RAISE EXCEPTION 'Protected identity, wallet or payment evidence changed'; END IF;
 END LOOP;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF EXISTS(SELECT 1 FROM "LedgerAccount" a LEFT JOIN LATERAL(SELECT COALESCE(SUM(delta),0) AS total FROM "Posting" WHERE "accountId"=a.id)p ON true WHERE a.balance<>p.total) THEN RAISE EXCEPTION 'Wallet reconciliation failed'; END IF;
 INSERT INTO "AdminAudit"(id,"actorId",action,target,"operationKey","requestHash",details,"createdAt") SELECT gen_random_uuid()::text,a."actorId",'RESET_CATALOG_PURGED',c->>'runId','reset:'||(c->>'runId')||':catalog-purge',c->>'manifestHash',jsonb_build_object('refundManifestHash',c->>'refundManifestHash','tables',c->'tables','financialProofRetained',true,'maintenanceRetained',true),clock_timestamp() FROM "AdminAudit" a WHERE a."operationKey"='reset:'||(c->>'runId')||':complete';
END $purge$;
COMMIT;
