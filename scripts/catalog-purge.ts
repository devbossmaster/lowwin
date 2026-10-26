import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {Client} from 'pg';

// This is an owner-run, offline-prepared SQL procedure, never an HTTP command.
// Financial journals and identities are intentionally outside the deletion list.
export const CATALOG_PURGE_TABLES=['NotificationInbox','TelegramMessage','Outbox','FulfillmentCase','AuctionFavorite','SettlementMovement','AuctionSettlement','PublicAuctionResult','Bid','AuctionHold','AuctionControlRevision','AuctionFeeRevision','AuctionTerms','AuctionDraft','Auction','ProductImage','Product','Category','ManagedMedia','SupportCase'] as const;
export const CATALOG_KEEP_TABLES=['user','account','session','verification','TelegramOwnContact','StaffMember','StaffSession','StaffTrustedDevice','StaffToken','OwnerBootstrap','Wallet','LedgerAccount','Operation','Journal','Posting','CurrencyConversion','TopUpIntent','PaymentClaim','PaymentAttempt','PaymentTransferAlias','AdminWalletCredit','VerifyRequest','VerifyWebhookEvent','ArifPayCheckout','ChapaCheckout','ChapaWebhookEvent','ReferralPolicy','ReferralInvite','ReferralPendingSignup','ReferralRegistrationProof','ReferralSignup','ReferralCoupon','ReferralRedemption'] as const;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function ensure(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message)}
type Row=Record<string,any>;
export const CATALOG_SCHEMA_SQL=`SELECT encode(sha256(convert_to(jsonb_build_object(
 'columns',(SELECT jsonb_agg(to_jsonb(schema_column) ORDER BY table_name,ordinal_position) FROM information_schema.columns schema_column WHERE table_schema='public'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',schema_relation.relname,'name',schema_trigger.tgname,'enabled',schema_trigger.tgenabled,'definition',pg_get_triggerdef(schema_trigger.oid,true)) ORDER BY schema_relation.relname,schema_trigger.tgname) FROM pg_trigger schema_trigger JOIN pg_class schema_relation ON schema_relation.oid=schema_trigger.tgrelid WHERE schema_relation.relnamespace='public'::regnamespace AND NOT schema_trigger.tgisinternal),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'valid',convalidated,'definition',pg_get_constraintdef(oid,true)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace),
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'arguments',pg_get_function_identity_arguments(oid),'definition',pg_get_functiondef(oid)) ORDER BY proname,pg_get_function_identity_arguments(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
 'migrations',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum,'done',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM "_prisma_migrations")
 )::text,'UTF8')),'hex') AS fingerprint`;
export function catalogTableSql(name:string){return `SELECT COUNT(*)::int AS count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') AS fingerprint FROM public.${quote(name)} r`}

export async function collectCatalogPurgeAudit(db:Client,runId:string){
 const identity=(await db.query("SELECT current_setting('transaction_read_only') AS read_only,transaction_timestamp() AS snapshot_at,current_database() AS database")).rows[0];
 const stream=(db as unknown as {connection:{stream:{encrypted?:boolean;authorized?:boolean}}}).connection.stream;
 identity.verifiedTls=!!(stream.encrypted&&stream.authorized);
 ensure(identity.read_only==='on','Catalog inventory requires an explicit READ ONLY transaction');
 const present=new Set((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename));
 const tables:Row[]=[],protectedTables:Row[]=[];
 for(const name of CATALOG_PURGE_TABLES)if(present.has(name))tables.push({name,...(await db.query(catalogTableSql(name))).rows[0]});
 for(const name of CATALOG_KEEP_TABLES)if(present.has(name))protectedTables.push({name,...(await db.query(catalogTableSql(name))).rows[0]});
 const completion=(await db.query(`SELECT "requestHash",details FROM "AdminAudit" WHERE "operationKey"=$1`,['reset:'+runId+':complete'])).rows[0]??null;
 const maintenance=(await db.query(`SELECT action,details FROM "AdminAudit" WHERE action IN('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1`)).rows[0]??null;
 const auctions=(await db.query(`SELECT a.id,a.status,s.outcome FROM "Auction" a LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id ORDER BY a.id`)).rows;
 const refundedAuctionIds=completion?(await db.query(`SELECT target FROM "AdminAudit" WHERE action='RESET_AUCTION_CANCELLED' AND "requestHash"=$1 ORDER BY target`,[completion.requestHash])).rows.map(r=>r.target):[];
 const blockers:string[]=[];
 if(!completion)blockers.push('Refund reset has not completed');
 if(maintenance?.action!=='AUCTIONS_MAINTENANCE_HALTED'||maintenance.details?.runId!==runId)blockers.push('Matching maintenance halt is not active');
 if(auctions.some(a=>a.status!=='CANCELLED'||a.outcome!=='CANCELLED'))blockers.push('Every auction must have a completed cancellation');
 if(completion&&auctions.length!==completion.details.auctions)blockers.push('Catalog differs from the exact refunded auction set');
 if(completion&&JSON.stringify(auctions.map(a=>a.id).sort())!==JSON.stringify(refundedAuctionIds))blockers.push('Auction IDs differ from the completed refund audit');
 if((await db.query('SELECT 1 FROM "AdminAudit" WHERE "operationKey"=$1',['reset:'+runId+':catalog-purge'])).rowCount)blockers.push('This catalog purge already completed; do not prepare a different manifest for the same run');
 for(const name of ['ArifPayCheckout','ChapaCheckout'])if(present.has(name)&&Number((await db.query(`SELECT COUNT(*)::int AS n FROM ${quote(name)} WHERE "auctionId" IS NOT NULL`)).rows[0].n))blockers.push(name+' has linked payment records that need separate recovery review');
 if(present.has('ReferralSignup')&&Number((await db.query('SELECT COUNT(*)::int AS n FROM "ReferralSignup" WHERE "firstBidId" IS NOT NULL')).rows[0].n))blockers.push('Earned referral rewards reference accepted bids');
 if(present.has('ReferralRedemption')&&Number((await db.query('SELECT COUNT(*)::int AS n FROM "ReferralRedemption"')).rows[0].n))blockers.push('Referral redemptions must retain their source proof');
 if(present.has('SiteContent')&&Number((await db.query('SELECT COUNT(*)::int AS n FROM "SiteContent"')).rows[0].n))blockers.push('Published content must be checked before removing uploaded media');
 if((await db.query('SELECT 1 FROM "AuctionHold" WHERE points<>0 LIMIT 1')).rowCount)blockers.push('Auction holds have not been fully released');
 if((await db.query('SELECT 1 FROM "LedgerAccount" WHERE kind=\'HELD\' AND balance<>0 LIMIT 1')).rowCount)blockers.push('Wallet held balances have not been fully released');
 if((await db.query('SELECT 1 FROM "LedgerAccount" a LEFT JOIN LATERAL(SELECT COALESCE(SUM(delta),0) AS total FROM "Posting" WHERE "accountId"=a.id) p ON true WHERE a.balance<>p.total LIMIT 1')).rowCount)blockers.push('Wallet projection drift');
 if((await db.query('SELECT j.id FROM "Journal" j LEFT JOIN "Posting" p ON p."journalId"=j.id GROUP BY j.id HAVING COUNT(p.id)<2 OR SUM(p.delta)<>0 LIMIT 1')).rowCount)blockers.push('Unbalanced financial journal');
 return {identity,schemaFingerprint:(await db.query(CATALOG_SCHEMA_SQL)).rows[0].fingerprint,runId,completion,maintenance,auctions,refundedAuctionIds,tables,protectedTables,blockers};
}

export function prepareCatalogPurge(audit:Row,review?:Row,options:{fixture?:boolean}={}){
 ensure(audit.identity?.read_only==='on','Read-only source inventory required');
 ensure(options.fixture||audit.identity.verifiedTls===true,'Verified TLS production inventory required');
 ensure(/^[a-z0-9][a-z0-9-]{7,70}$/.test(audit.runId),'Stable reviewed refund run required');
 ensure(Array.isArray(audit.blockers)&&!audit.blockers.length,'Catalog purge blocked: '+(audit.blockers??[]).join('; '));
 ensure(audit.completion?.requestHash&&audit.maintenance?.details?.runId===audit.runId,'Completed refund proof and maintenance are required');
 ensure(audit.tables.every((t:Row)=>(CATALOG_PURGE_TABLES as readonly string[]).includes(t.name)),'Unexpected deletion table');
 ensure(CATALOG_PURGE_TABLES.filter(t=>t!=='SupportCase').every(name=>audit.tables.some((t:Row)=>t.name===name)),'Required catalog inventory is missing');
 ensure(audit.tables.map((t:Row)=>t.name).join('|')===CATALOG_PURGE_TABLES.filter(name=>audit.tables.some((t:Row)=>t.name===name)).join('|'),'Catalog deletion dependency order changed');
 ensure(audit.protectedTables.every((t:Row)=>(CATALOG_KEEP_TABLES as readonly string[]).includes(t.name)),'Unexpected protected table');
 const config:Row={version:1,action:'PURGE_REFUNDED_CATALOG',runId:audit.runId,snapshotAt:audit.identity.snapshot_at,refundManifestHash:audit.completion.requestHash,auctionIds:audit.auctions?.map((a:Row)=>a.id)??[],schemaFingerprint:audit.schemaFingerprint,tables:audit.tables,protectedTables:audit.protectedTables};
 config.manifestHash=createHash('sha256').update(JSON.stringify(config)).digest('hex');
 if(review?.executionAcknowledgement&&review.executionAcknowledgement!=='REVIEW_REQUIRED'){
  ensure(review.reviewedManifestHash===config.manifestHash,'Purge approval does not match the exact reviewed inventory');
  ensure(review.backupAcknowledgement==='RESTORABLE_BACKUP_VERIFIED','Restorable backup verification required');
  ensure(review.workersAcknowledgement==='ALL_AUCTION_AND_NOTIFICATION_WORKERS_DRAINED','All auction and notification workers must be drained');
  ensure(review.executionAcknowledgement==='EXECUTE_REVIEWED_CATALOG_PURGE','Explicit catalog purge acknowledgement required');
 }
 config.executionAcknowledgement=review?.executionAcknowledgement??'REVIEW_REQUIRED';
 config.backupAcknowledgement=review?.backupAcknowledgement??'REVIEW_REQUIRED';
 config.workersAcknowledgement=review?.workersAcknowledgement??'REVIEW_REQUIRED';
 return config;
}
export function writeCatalogPurge(config:Row,directory:string){
 const template=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'sql/catalog-purge-execute.sql'),'utf8');
 const encoded=`convert_from(decode('${Buffer.from(JSON.stringify(config)).toString('base64')}','base64'),'UTF8')::jsonb`;
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'04_catalog_purge.sql'),template.replace('__CATALOG_CONFIG__',()=>encoded).replace('__SCHEMA_QUERY__',()=>CATALOG_SCHEMA_SQL));
 fs.writeFileSync(path.join(directory,'catalog-purge-review.json'),JSON.stringify(config,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'catalog-purge-owner-review.template.json'),JSON.stringify({reviewedManifestHash:config.manifestHash,backupAcknowledgement:'REVIEW_REQUIRED',workersAcknowledgement:'REVIEW_REQUIRED',executionAcknowledgement:'REVIEW_REQUIRED'},null,2)+'\n');
 const counts=config.tables.map((table:Row)=>`SELECT '${table.name}' AS name,COUNT(*)::int AS rows FROM public.${quote(table.name)}`).join(' UNION ALL ');
 fs.writeFileSync(path.join(directory,'05_verify_catalog_purge.sql'),`-- Read only; run before the empty-table retirement migration.\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT jsonb_build_object('catalogRows',(SELECT jsonb_agg(to_jsonb(n) ORDER BY name) FROM (${counts})n),'purgeReceipt',(SELECT jsonb_agg(jsonb_build_object('action',action,'hash',\"requestHash\",'details',details)) FROM \"AdminAudit\" WHERE \"operationKey\"='reset:${config.runId}:catalog-purge'),'sealedProofs',(SELECT COUNT(*) FROM \"AdminAudit\" WHERE \"operationKey\"='reset:${config.runId}:catalog-proof'),'users',(SELECT COUNT(*) FROM \"user\"),'wallets',(SELECT COUNT(*) FROM \"Wallet\"),'walletTotals',(SELECT jsonb_agg(to_jsonb(t)) FROM(SELECT kind,SUM(balance) AS balance FROM \"LedgerAccount\" GROUP BY kind ORDER BY kind)t),'projectionDrift',(SELECT COUNT(*) FROM \"LedgerAccount\" a LEFT JOIN LATERAL(SELECT COALESCE(SUM(delta),0) AS total FROM \"Posting\" WHERE \"accountId\"=a.id)p ON true WHERE a.balance<>p.total)) AS cleanup_verification;\nROLLBACK;\n`);
}
