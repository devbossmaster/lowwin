-- Generated with an explicit, immutable review manifest. Never edit target IDs,
-- money, hashes or source rows by hand. Re-audit and regenerate on drift.
-- Two commits by design: a durable halt remains if the financial transaction fails.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='60s';
DO $halt$
DECLARE c jsonb := __RESET_CONFIG_JSON__; owner_row record;
BEGIN
 IF c->>'rolloutAcknowledgement'<>'MATCHING_WEB_AND_WORKERS_DEPLOYED' OR c->>'backupAcknowledgement'<>'RESTORABLE_BACKUP_VERIFIED' THEN
  RAISE EXCEPTION 'Review gate: confirm matching web/workers and a restorable backup in the generated review configuration first';
 END IF;
 IF c->>'executionAcknowledgement'<>'EXECUTE_REVIEWED_RESET' THEN RAISE EXCEPTION 'Production execution has not been approved'; END IF;
 SELECT s."userId",s.role,s.active,md5(COALESCE(s.secret,'')||COALESCE(s."recoveryHashes"::text,'')) AS mfa,md5(COALESCE(a.password,'')) AS credential INTO owner_row
 FROM "StaffMember" s JOIN "account" a ON a."userId"=s."userId" AND a."providerId"='credential' WHERE s."userId"=c->>'ownerId';
 IF owner_row."userId" IS NULL OR owner_row.role<>'OWNER' OR NOT owner_row.active OR owner_row.mfa<>c->>'ownerMfaFingerprint' OR owner_row.credential<>c->>'ownerCredentialFingerprint' THEN RAISE EXCEPTION 'Owner identity, credential or MFA changed: stop'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lowwin:auction-maintenance',0));
 IF EXISTS(SELECT 1 FROM(SELECT action,details FROM "AdminAudit" WHERE action IN('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1) latest WHERE action='AUCTIONS_MAINTENANCE_HALTED' AND details->>'runId'<>c->>'runId') THEN RAISE EXCEPTION 'Another maintenance run is active'; END IF;
 INSERT INTO "AdminAudit"(id,"actorId",action,target,"operationKey","requestHash",details,"createdAt")
 SELECT gen_random_uuid()::text,c->>'ownerId','AUCTIONS_MAINTENANCE_HALTED',c->>'runId','reset:'||(c->>'runId')||':halt:'||(c->>'manifestHash'),c->>'manifestHash',jsonb_build_object('runId',c->>'runId','manifestHash',c->>'manifestHash','reason',c->>'reason'),clock_timestamp()
 WHERE NOT EXISTS(SELECT 1 FROM "AdminAudit" WHERE "operationKey"='reset:'||(c->>'runId')||':halt:'||(c->>'manifestHash'));
END $halt$;
COMMIT;

BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='120s';
SET LOCAL idle_in_transaction_session_timeout='30s';
DO $reset$
DECLARE c jsonb := __RESET_CONFIG_JSON__; a jsonb; m jsonb; expected jsonb; current_row record; auction_row "Auction"%ROWTYPE; terms_row "AuctionTerms"%ROWTYPE;
 uid text; sid text; release_op text; refund_op text; release_journal text; refund_journal text; op text; journal_id text; available_id text; held_id text; fees_id text;
 gross numeric; discount numeric; prior numeric; compensation numeric; release_amount numeric; available_before numeric; held_before numeric; refs jsonb; distribution jsonb; proof jsonb; revisions jsonb;
 total_compensation numeric:=0; audit_row record; snapshot_age interval;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lowwin:auction-maintenance',0));
 SELECT "requestHash",details INTO audit_row FROM "AdminAudit" WHERE "operationKey"='reset:'||(c->>'runId')||':complete';
 IF FOUND THEN
  IF audit_row."requestHash"<>c->>'manifestHash' THEN RAISE EXCEPTION 'Run identity was reused with a different manifest'; END IF;
  IF (SELECT COUNT(*) FROM "Operation" WHERE scope IN ('AUCTION_RESET_COMPENSATION','AUCTION_FEE_REFUND') AND result->>'runId'=c->>'runId')<>(audit_row.details->>'compensationOperations')::int THEN RAISE EXCEPTION 'Previously completed reset evidence is inconsistent'; END IF;
  RAISE NOTICE 'This exact reset already committed. No second credit or cancellation was performed.'; RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM(SELECT action,details FROM "AdminAudit" WHERE action IN('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1)latest WHERE action='AUCTIONS_MAINTENANCE_HALTED' AND details->>'runId'=c->>'runId' AND details->>'manifestHash'=c->>'manifestHash') THEN RAISE EXCEPTION 'The reviewed maintenance halt must be active'; END IF;
 snapshot_age:=clock_timestamp()-(c->>'snapshotAt')::timestamptz;
 IF snapshot_age<interval '-1 minute' OR snapshot_age>interval '24 hours' THEN RAISE EXCEPTION 'Snapshot is stale: perform a new read-only audit'; END IF;
 IF jsonb_array_length(c->'blockingExceptions')<>0 THEN RAISE EXCEPTION 'Manifest contains unresolved financial exceptions'; END IF;
 -- Verify migration checksums and the actual guard functions/triggers, without
 -- creating or replacing any public database object.
 IF (SELECT COALESCE(jsonb_agg(to_jsonb(col) ORDER BY col.table_name,col.ordinal_position),'[]'::jsonb) FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,numeric_precision,numeric_scale,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public') col) IS DISTINCT FROM c->'columns' THEN RAISE EXCEPTION 'Column definitions or monetary types changed'; END IF;
 IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)<>jsonb_array_length(c->'migrations') THEN RAISE EXCEPTION 'Migration baseline changed'; END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements(c->'migrations') LOOP
  IF NOT EXISTS(SELECT 1 FROM "_prisma_migrations" WHERE migration_name=expected->>'name' AND checksum=expected->>'checksum' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
 END LOOP;
 FOR expected IN SELECT value FROM jsonb_array_elements(c->'functions') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=expected->>'name' AND pg_get_function_identity_arguments(p.oid)=expected->>'arguments' AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=expected->>'hash') THEN RAISE EXCEPTION 'A production guard function changed'; END IF;
 END LOOP;
 FOR expected IN SELECT value FROM jsonb_array_elements(c->'triggers') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname=expected->>'table' AND t.tgname=expected->>'name' AND t.tgenabled::text=expected->>'enabled' AND encode(sha256(convert_to(pg_get_triggerdef(t.oid,true),'UTF8')),'hex')=expected->>'hash') THEN RAISE EXCEPTION 'A production trigger changed or is disabled'; END IF;
 END LOOP;
 FOR expected IN SELECT value FROM jsonb_array_elements(c->'constraints') LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND k.conname=expected->>'name' AND k.conrelid::regclass::text=expected->>'table' AND k.convalidated=(expected->>'validated')::boolean AND pg_get_constraintdef(k.oid,true)=expected->>'definition') THEN RAISE EXCEPTION 'A production constraint changed'; END IF;
 END LOOP;
 -- Stable auction -> all participant wallet keys -> hold guards -> projections.
 FOR a IN SELECT value FROM jsonb_array_elements(c->'auctions') ORDER BY value->>'id' COLLATE "C" LOOP
  PERFORM id FROM "Auction" WHERE id=a->>'id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target auction disappeared'; END IF;
 END LOOP;
 IF (SELECT COUNT(*) FROM "user")<>(c->>'userCount')::int OR (SELECT md5(string_agg(id||':'||COALESCE("telegramId"::text,''),'|' ORDER BY id)) FROM "user")<>c->>'userFingerprint' THEN RAISE EXCEPTION 'Customer identity baseline changed; regenerate without deleting any account'; END IF;
 FOR uid IN SELECT id FROM(SELECT DISTINCT value->>'userId' AS id FROM jsonb_array_elements(c->'participants')) users ORDER BY id COLLATE "C" LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:'||uid,0));
  PERFORM lock_wallet_hold_state(id) FROM "Wallet" WHERE "userId"=uid;
 END LOOP;
 PERFORM id FROM "LedgerAccount" WHERE "walletId" IN(SELECT value->>'walletId' FROM jsonb_array_elements(c->'participants')) ORDER BY id FOR UPDATE;
 SELECT id INTO fees_id FROM "LedgerAccount" WHERE name='platform:fees' FOR UPDATE;
 IF fees_id IS NULL THEN RAISE EXCEPTION 'Platform fee account missing'; END IF;
 IF EXISTS(SELECT 1 FROM "LedgerAccount" la LEFT JOIN LATERAL(SELECT COALESCE(SUM(delta),0) AS amount FROM "Posting" WHERE "accountId"=la.id)p ON true WHERE la.balance<>p.amount) THEN RAISE EXCEPTION 'Account projection drift'; END IF;
 IF EXISTS(SELECT 1 FROM "Journal" j LEFT JOIN "Posting" p ON p."journalId"=j.id GROUP BY j.id HAVING COUNT(p.id)<2 OR SUM(p.delta)<>0) THEN RAISE EXCEPTION 'Unbalanced journal'; END IF;
 IF EXISTS(SELECT 1 FROM "Wallet" w JOIN "LedgerAccount" la ON la."walletId"=w.id AND la.kind='HELD' LEFT JOIN "AuctionHold" h ON h."walletId"=w.id GROUP BY w.id,la.balance HAVING la.balance<>COALESCE(SUM(h.points),0)) THEN RAISE EXCEPTION 'Hold projection drift'; END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements(c->'walletBaseline') LOOP
  IF NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=expected->>'id' AND balance=(expected->>'balance')::numeric AND name=expected->>'name') THEN RAISE EXCEPTION 'Wallet baseline changed; include late verified credits in a new manifest'; END IF;
 END LOOP;
 IF (SELECT COUNT(*) FROM "PaymentClaim")<>(c->>'claimCount')::int OR (SELECT COUNT(*) FROM "TopUpIntent")<>(c->>'intentCount')::int THEN RAISE EXCEPTION 'Payment inventory changed; reconcile late confirmations before regenerating'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(c->'auctions') ORDER BY value->>'id' COLLATE "C" LOOP
  SELECT * INTO auction_row FROM "Auction" WHERE id=a->>'id'; SELECT * INTO terms_row FROM "AuctionTerms" WHERE "auctionId"=auction_row.id;
  IF row_to_json(terms_row)::jsonb IS DISTINCT FROM a->'terms' OR auction_row.status<>a->>'status' OR auction_row."controlVersion"<>(a->>'controlVersion')::int OR auction_row.slug IS DISTINCT FROM a->>'slug' OR auction_row."acceptedBidCount"<>(a->>'acceptedBidCount')::int OR auction_row."bidSequence"<>(a->>'bidSequence')::bigint OR to_char(auction_row."endsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>a->>'endsAt' THEN RAISE EXCEPTION 'Auction terms, controls or accepted bids changed'; END IF;
  IF EXISTS(SELECT 1 FROM "AuctionSettlement" WHERE "auctionId"=auction_row.id) OR EXISTS(SELECT 1 FROM "PublicAuctionResult" WHERE "auctionId"=auction_row.id) OR NOT auction_row.status=ANY(ARRAY['LIVE','SCHEDULED']) THEN RAISE EXCEPTION 'Settled/illustrative/terminal auction requires separate review'; END IF;
  IF (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'userId',b."userId",'operationId',b."operationId",'amount',trim_scale(b.amount)::text,'feePoints',trim_scale(b."feePoints")::text,'termsVersion',b."termsVersion",'acceptanceOrder',b."acceptanceOrder"::text,'acceptedAt',to_char(b."acceptedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY b.id),'[]'::jsonb) FROM "Bid" b WHERE b."auctionId"=auction_row.id) IS DISTINCT FROM a->'bids' THEN RAISE EXCEPTION 'Exact source bid snapshot changed'; END IF;
 END LOOP;
 -- Validate every amount against balanced source journal postings, referral
 -- contra-fees and attributable earlier compensation. Never use the bid number.
 FOR m IN SELECT value FROM jsonb_array_elements(c->'participants') ORDER BY value->>'auctionId',value->>'userId' COLLATE "C" LOOP
  SELECT COALESCE(SUM(b."feePoints"),0) INTO gross FROM "Bid" b WHERE b."auctionId"=m->>'auctionId' AND b."userId"=m->>'userId';
  IF EXISTS(SELECT 1 FROM "Bid" b LEFT JOIN "Operation" o ON o.id=b."operationId" LEFT JOIN "Journal" j ON j."operationId"=o.id WHERE b."auctionId"=m->>'auctionId' AND b."userId"=m->>'userId' AND (o."userId"<>b."userId" OR o.scope<>'BID' OR b."feePoints">0 AND (j.kind IS DISTINCT FROM 'BID_FEE' OR (SELECT COUNT(*) FROM "Posting" WHERE "journalId"=j.id)<>2 OR NOT EXISTS(SELECT 1 FROM "Posting" WHERE "journalId"=j.id AND "accountId"=fees_id AND delta=b."feePoints") OR NOT EXISTS(SELECT 1 FROM "Posting" p JOIN "LedgerAccount" la ON la.id=p."accountId" WHERE p."journalId"=j.id AND la.name='user:'||b."userId"||':available' AND p.delta=-b."feePoints")))) THEN RAISE EXCEPTION 'Source fee journal mismatch'; END IF;
  SELECT COALESCE(SUM(-p.delta),0) INTO discount FROM "Operation" o JOIN "Journal" j ON j."operationId"=o.id JOIN "Posting" p ON p."journalId"=j.id WHERE o.scope='REFERRAL_DISCOUNT' AND o."userId"=m->>'userId' AND o.result->>'auctionId'=m->>'auctionId' AND p."accountId"=fees_id;
  SELECT COALESCE(SUM(p.delta),0) INTO prior FROM "Operation" o JOIN "Journal" j ON j."operationId"=o.id JOIN "Posting" p ON p."journalId"=j.id JOIN "LedgerAccount" la ON la.id=p."accountId" WHERE o.scope IN ('AUCTION_FEE_REFUND','AUCTION_RESET_COMPENSATION') AND o."userId"=m->>'userId' AND o.result->>'auctionId'=m->>'auctionId' AND la.name='user:'||o."userId"||':available';
  IF gross<>(m->>'grossFee')::numeric OR discount<>(m->>'discount')::numeric OR prior<>(m->>'priorRefund')::numeric OR gross-discount-prior<>(m->>'compensation')::numeric OR gross-discount-prior<0 THEN RAISE EXCEPTION 'Net compensation changed or is ambiguous'; END IF;
  IF COALESCE((SELECT points FROM "AuctionHold" WHERE "walletId"=m->>'walletId' AND "auctionId"=m->>'auctionId'),0)<>(m->>'holdRelease')::numeric THEN RAISE EXCEPTION 'Auction hold changed'; END IF;
 END LOOP;
 FOR a IN SELECT value FROM jsonb_array_elements(c->'auctions') ORDER BY value->>'id' COLLATE "C" LOOP
  sid:=a->>'settlementId';SELECT * INTO auction_row FROM "Auction" WHERE id=a->>'id';SELECT * INTO terms_row FROM "AuctionTerms" WHERE "auctionId"=auction_row.id;
  FOR m IN SELECT value FROM jsonb_array_elements(c->'participants') WHERE value->>'auctionId'=auction_row.id ORDER BY value->>'userId' COLLATE "C" LOOP
   SELECT id,balance INTO available_id,available_before FROM "LedgerAccount" WHERE "walletId"=m->>'walletId' AND kind='AVAILABLE';SELECT id,balance INTO held_id,held_before FROM "LedgerAccount" WHERE "walletId"=m->>'walletId' AND kind='HELD';
   release_amount:=(m->>'holdRelease')::numeric;compensation:=(m->>'compensation')::numeric;
   IF release_amount>0 THEN
    op:=m->>'releaseOperationId';journal_id:=m->>'releaseJournalId';
    INSERT INTO "Operation"(id,"userId",scope,key,"requestHash",result,"createdAt") VALUES(op,m->>'userId','HOLD_ADJUST','settlement:'||sid,c->>'manifestHash',jsonb_build_object('operationId',op,'auctionId',auction_row.id,'direction','RELEASE','points',trim_scale(release_amount)::text,'auctionHeld','0','available',trim_scale(available_before+release_amount)::text,'held',trim_scale(held_before-release_amount)::text),clock_timestamp());
    UPDATE "AuctionHold" SET points=0 WHERE "walletId"=m->>'walletId' AND "auctionId"=auction_row.id;
    INSERT INTO "Journal"(id,"operationId",kind,reference) VALUES(journal_id,op,'HOLD_RELEASE',jsonb_build_object('holdId',m->>'holdId','auctionId',auction_row.id,'reference','settlement:'||sid||':auction:'||auction_row.id)::text);
    INSERT INTO "Posting"(id,"journalId","accountId",delta) VALUES(gen_random_uuid()::text,journal_id,held_id,-release_amount),(gen_random_uuid()::text,journal_id,available_id,release_amount);
   END IF;
   IF compensation>0 THEN
    op:=m->>'compensationOperationId';journal_id:=m->>'compensationJournalId';
    INSERT INTO "Operation"(id,"userId",scope,key,"requestHash",result,"createdAt") VALUES(op,m->>'userId',CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 'AUCTION_RESET_COMPENSATION' ELSE 'AUCTION_FEE_REFUND' END,CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 'reset:'||(c->>'runId')||':'||auction_row.id||':'||(m->>'userId') ELSE sid END,c->>'manifestHash',jsonb_build_object('runId',c->>'runId','settlementId',sid,'auctionId',auction_row.id,'grossFeePoints',m->>'grossFee','discountPoints',m->>'discount','priorRefundPoints',m->>'priorRefund','refundedFees',m->>'compensation','feeJournalIds',m->'feeJournalIds','sourceBidIds',m->'bidIds','manifestHash',c->>'manifestHash'),clock_timestamp());
    INSERT INTO "Journal"(id,"operationId",kind,reference) VALUES(journal_id,op,CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 'AUCTION_RESET_COMPENSATION' ELSE 'AUCTION_FEE_REFUND' END,CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 'reset:'||(c->>'runId')||':auction:'||auction_row.id ELSE 'settlement:'||sid||':auction:'||auction_row.id END);
    INSERT INTO "Posting"(id,"journalId","accountId",delta) VALUES(gen_random_uuid()::text,journal_id,fees_id,-compensation),(gen_random_uuid()::text,journal_id,available_id,compensation);
    total_compensation:=total_compensation+compensation;
   END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('amount',trim_scale(amount)::text,'count',n) ORDER BY amount),'[]'::jsonb) INTO distribution FROM(SELECT amount,COUNT(*) n FROM "Bid" WHERE "auctionId"=auction_row.id GROUP BY amount)f;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'feePoints',trim_scale("feePoints")::text,'acceptedCount',n) ORDER BY version),'[]'::jsonb) INTO revisions FROM(SELECT r.version,r."feePoints",COUNT(b.id)::int n FROM "AuctionFeeRevision" r JOIN "Bid" b ON b."feeRevisionId"=r.id WHERE r."auctionId"=auction_row.id GROUP BY r.id,r.version,r."feePoints")f;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',value->>'movementId','userId',value->>'userId','walletId',value->>'walletId','holdBefore',value->>'holdRelease','chargedPoints','0','releasedPoints',value->>'holdRelease','refundedFees',CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN '0' ELSE value->>'compensation' END,'chargeOperationId',null,'releaseOperationId',CASE WHEN (value->>'holdRelease')::numeric>0 THEN value->>'releaseOperationId' ELSE null END,'refundOperationId',CASE WHEN terms_row."ruleVersion"<>'lowest-unique-v4' AND (value->>'compensation')::numeric>0 THEN value->>'compensationOperationId' ELSE null END,'chargeJournalId',null,'releaseJournalId',CASE WHEN (value->>'holdRelease')::numeric>0 THEN value->>'releaseJournalId' ELSE null END,'refundJournalId',CASE WHEN terms_row."ruleVersion"<>'lowest-unique-v4' AND (value->>'compensation')::numeric>0 THEN value->>'compensationJournalId' ELSE null END,'feeJournalIds',value->'feeJournalIds') ORDER BY value->>'userId' COLLATE "C"),'[]'::jsonb) INTO refs FROM jsonb_array_elements(c->'participants') WHERE value->>'auctionId'=auction_row.id;
  proof:=jsonb_build_object('ruleVersion',terms_row."ruleVersion",'termsVersion',terms_row.version,'cutoff',to_char(auction_row."endsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'acceptedCount',auction_row."acceptedBidCount",'amountFrequencies',distribution,'outcome','CANCELLED','winner',null,'feePolicy',CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 'NON_REFUNDABLE_SUBMISSION_FEES' ELSE 'REFUND_ALL_ENTRY_FEES' END,'feeRevisions',revisions,'settlementId',sid,'references',refs,'cancellation',jsonb_build_object('actorId',c->>'ownerId','reason',c->>'reason','key',a->>'cancelKey'));
  IF terms_row."ruleVersion"<>'lowest-unique-v1' THEN proof:=proof||jsonb_build_object('minParticipants',terms_row."minParticipants",'participantCount',(SELECT COUNT(DISTINCT "userId") FROM "Bid" WHERE "auctionId"=auction_row.id),'acceptanceCutoff',auction_row."bidSequence"::text,'decision','OWNER_CANCELLED'); END IF;
  IF terms_row."ruleVersion" IN('lowest-unique-v3','lowest-unique-v4') THEN proof:=proof||jsonb_build_object('amountPolicy',jsonb_build_object('currency',CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 'NONE' ELSE 'ETB' END,'minimum','1','step','0.01','maxDecimalPlaces',2,'maxConsecutive',3)); END IF;
  UPDATE "Auction" SET status='CANCELLED',"nextCloseAttemptAt"=null,"closeErrorCode"=null WHERE id=auction_row.id;
  INSERT INTO "AuctionSettlement"(id,"auctionId",outcome,"ruleVersion","termsVersion",cutoff,"acceptedCount","actorId",reason,key,"requestHash",proof,decision,"participantCount","acceptanceCutoff") VALUES(sid,auction_row.id,'CANCELLED',terms_row."ruleVersion",terms_row.version,auction_row."endsAt",auction_row."acceptedBidCount",c->>'ownerId',c->>'reason',a->>'cancelKey',a->>'cancelRequestHash',proof,CASE WHEN terms_row."ruleVersion"='lowest-unique-v1' THEN null ELSE 'OWNER_CANCELLED' END,CASE WHEN terms_row."ruleVersion"='lowest-unique-v1' THEN null ELSE (SELECT COUNT(DISTINCT "userId")::int FROM "Bid" WHERE "auctionId"=auction_row.id) END,CASE WHEN terms_row."ruleVersion"='lowest-unique-v1' THEN null ELSE auction_row."bidSequence" END);
  INSERT INTO "SettlementMovement"(id,"settlementId","userId","walletId","holdBefore","chargedPoints","releasedPoints","refundedFees","releaseOperationId","refundOperationId") SELECT value->>'movementId',sid,value->>'userId',value->>'walletId',(value->>'holdRelease')::numeric,0,(value->>'holdRelease')::numeric,CASE WHEN terms_row."ruleVersion"='lowest-unique-v4' THEN 0 ELSE (value->>'compensation')::numeric END,CASE WHEN (value->>'holdRelease')::numeric>0 THEN value->>'releaseOperationId' ELSE null END,CASE WHEN terms_row."ruleVersion"<>'lowest-unique-v4' AND (value->>'compensation')::numeric>0 THEN value->>'compensationOperationId' ELSE null END FROM jsonb_array_elements(c->'participants') WHERE value->>'auctionId'=auction_row.id;
  -- The audited production constraint requires a slug on every published row.
  -- Retain that identity, archive the catalog and record a presentation revision.
  INSERT INTO "AuctionControlRevision"(id,"auctionId",version,kind,before,after,"actorId",reason,"operationKey") VALUES(a->>'controlRevisionId',auction_row.id,auction_row."controlVersion"+1,'PRESENTATION',jsonb_build_object('publicSlug',auction_row.slug,'featured',auction_row.featured),jsonb_build_object('publicSlug',auction_row.slug,'featured',false,'catalogArchived',true),c->>'ownerId',c->>'reason','reset:'||(c->>'runId')||':archive:'||auction_row.id);
  UPDATE "Auction" SET featured=false,"controlVersion"="controlVersion"+1 WHERE id=auction_row.id;
  UPDATE "Outbox" SET state='SKIPPED',"sentAt"=clock_timestamp(),"lastError"='AUCTION_RETIRED' WHERE payload->>'auctionId'=auction_row.id AND kind IN('AUCTION_PUBLISHED','AUCTION_UPCOMING','AUCTION_STARTING_SOON','AUCTION_ENDING','AUCTION_ENDING_SOON','GLOBAL_CAMPAIGN') AND state='PENDING';
  INSERT INTO "AdminAudit"(id,"actorId",action,target,"operationKey","requestHash",details,"createdAt") VALUES(gen_random_uuid()::text,c->>'ownerId','RESET_AUCTION_CANCELLED',auction_row.id,'reset:'||(c->>'runId')||':cancel:'||auction_row.id,c->>'manifestHash',jsonb_build_object('settlementId',sid,'reason',c->>'reason','manifestHash',c->>'manifestHash','catalogArchived',true,'slugPreserved',true),clock_timestamp());
 END LOOP;
 -- Archive only the explicit historical inventory. Never remove relational or
 -- financial evidence; no hard deletion is needed for this production baseline.
 UPDATE "Product" SET visible=false,version=version+1 WHERE id IN(SELECT value->>'id' FROM jsonb_array_elements(c->'products')) AND visible;
 UPDATE "Category" SET visible=false,version=version+1 WHERE id IN(SELECT value->>'id' FROM jsonb_array_elements(c->'categories')) AND visible;
 IF total_compensation<>(c->>'totalCompensation')::numeric THEN RAISE EXCEPTION 'Committed compensation total would differ from reviewed manifest'; END IF;
 IF EXISTS(SELECT 1 FROM "Auction" WHERE "publishedAt" IS NOT NULL AND status IN('LIVE','SCHEDULED') AND slug IS NOT NULL AND "testRunId" IS NULL AND NOT "isDemo") THEN RAISE EXCEPTION 'Unexpected active public catalog remains: stop'; END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements(c->'walletExpected') LOOP
  IF NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=expected->>'id' AND balance=(expected->>'balance')::numeric) THEN RAISE EXCEPTION 'Expected wallet balance failed'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM "LedgerAccount" la LEFT JOIN LATERAL(SELECT COALESCE(SUM(delta),0) AS amount FROM "Posting" WHERE "accountId"=la.id)p ON true WHERE la.balance<>p.amount) THEN RAISE EXCEPTION 'Post-run ledger projection mismatch'; END IF;
 INSERT INTO "AdminAudit"(id,"actorId",action,target,"operationKey","requestHash",details,"createdAt") VALUES(gen_random_uuid()::text,c->>'ownerId','RESET_COMPLETED',c->>'runId','reset:'||(c->>'runId')||':complete',c->>'manifestHash',jsonb_build_object('manifestHash',c->>'manifestHash','compensation',trim_scale(total_compensation)::text,'compensationOperations',(SELECT COUNT(*) FROM "Operation" WHERE scope IN ('AUCTION_RESET_COMPENSATION','AUCTION_FEE_REFUND') AND result->>'runId'=c->>'runId'),'auctions',jsonb_array_length(c->'auctions'),'maintenanceRetained',true),clock_timestamp());
 -- Fire every deferred financial/settlement guard before committing.
 SET CONSTRAINTS ALL IMMEDIATE;
 RAISE NOTICE 'Reset committed atomically: % ETB compensation. Maintenance remains active.',total_compensation;
END $reset$;
COMMIT;
