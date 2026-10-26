import fs from 'node:fs';
import {createHash} from 'node:crypto';
import type {Client} from 'pg';
import {types} from 'pg';
// Prisma timestamps are stored as UTC without a zone. pg's default parser uses
// the operator PC timezone, which would shift frozen cutoffs on this machine.
types.setTypeParser(1114,value=>new Date(value.replace(' ','T')+'Z'));
type Row=Record<string,any>;
export async function schemaInventory(db:Client,identity:Row){
 const tables=(await db.query("SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")).rows;
 const columns=(await db.query("SELECT table_name,column_name,ordinal_position,data_type,udt_name,numeric_precision,numeric_scale,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
 const constraints=(await db.query("SELECT c.conname AS name,c.conrelid::regclass::text AS table_name,c.contype AS type,c.convalidated AS validated,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY c.conrelid::regclass::text,c.conname")).rows;
 const triggers=(await db.query("SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition,p.proname AS function_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
 const functions=(await db.query("SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef AS security_definer,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)")).rows;
 const grants=(await db.query("SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type")).rows;
 const routineGrants=(await db.query("SELECT grantee,routine_name,specific_name,privilege_type,is_grantable FROM information_schema.routine_privileges WHERE routine_schema='public' ORDER BY routine_name,specific_name,grantee,privilege_type")).rows;
 const policies=(await db.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
 const indexes=(await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
 const migrations=(await db.query('SELECT migration_name,checksum,started_at,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY started_at')).rows;
 const local=migrations.map(m=>{const file=`prisma/migrations/${m.migration_name}/migration.sql`;if(!fs.existsSync(file))return {name:m.migration_name,match:'missing-local'};const raw=fs.readFileSync(file,'utf8'),lf=raw.replace(/\r\n/g,'\n'),versions={raw,lf,crlf:lf.replace(/\n/g,'\r\n')};return {name:m.migration_name,match:Object.entries(versions).find(([,text])=>createHash('sha256').update(text).digest('hex')===m.checksum)?.[0]??'checksum-drift'}});
 const schemaHash=createHash('sha256').update(JSON.stringify({columns,constraints,triggers,functions,indexes})).digest('hex');
 return {identity,tables,columns,constraints,triggers,functions,grants,routineGrants,policies,indexes,migrations,migrationComparison:local,schemaHash};
}
export async function domainInventory(db:Client,identity:Row,schema:Row){
 const read=async(sql:string)=>(await db.query(sql)).rows;
 const auctions=await read(`SELECT a.*,row_to_json(t) AS terms,(SELECT COUNT(*)::int FROM "Bid" b WHERE b."auctionId"=a.id) AS actual_bids,(SELECT COUNT(DISTINCT b."userId")::int FROM "Bid" b WHERE b."auctionId"=a.id) AS actual_players FROM "Auction" a LEFT JOIN "AuctionTerms" t ON t."auctionId"=a.id ORDER BY a.id`);
 const bids=await read(`SELECT b.*,o.scope,o.key,o."requestHash",j.id AS journal_id,j.kind AS journal_kind,j.reference,(SELECT COALESCE(SUM(p.delta),0)::text FROM "Posting" p JOIN "LedgerAccount" la ON la.id=p."accountId" WHERE p."journalId"=j.id AND la.name='platform:fees') AS actual_fee_credit,(SELECT COALESCE(SUM(-p.delta),0)::text FROM "Posting" p JOIN "LedgerAccount" la ON la.id=p."accountId" WHERE p."journalId"=j.id AND la.name='user:'||b."userId"||':available') AS actual_user_debit FROM "Bid" b JOIN "Operation" o ON o.id=b."operationId" LEFT JOIN "Journal" j ON j."operationId"=o.id ORDER BY b."auctionId",b."userId",b."acceptanceOrder",b.id`);
 const wallets=await read(`SELECT w.id,w."userId",COALESCE(MAX(a.balance) FILTER(WHERE a.kind='AVAILABLE'),0)::text AS available,COALESCE(MAX(a.balance) FILTER(WHERE a.kind='HELD'),0)::text AS held,COUNT(a.id)::int AS accounts FROM "Wallet" w LEFT JOIN "LedgerAccount" a ON a."walletId"=w.id GROUP BY w.id,w."userId" ORDER BY w."userId"`);
 const accounts=await read(`SELECT id,name,kind,"walletId",balance::text FROM "LedgerAccount" ORDER BY id`);
 const operations=await read(`SELECT * FROM "Operation" ORDER BY id`);
 const journals=await read(`SELECT * FROM "Journal" ORDER BY id`);
 const postings=await read(`SELECT * FROM "Posting" ORDER BY id`);
 const holds=await read(`SELECT h.*,w."userId" FROM "AuctionHold" h JOIN "Wallet" w ON w.id=h."walletId" ORDER BY h.id`);
 const settlements=await read(`SELECT * FROM "AuctionSettlement" ORDER BY id`);
 const movements=await read(`SELECT * FROM "SettlementMovement" ORDER BY id`);
 const payments=await read(`SELECT id,"userId",key,provider,status,points::text,"journalId",channel,"expectedCents"::text,"createdAt","expiresAt",attempts,"nextAttemptAt","leaseUntil","reasonCode","caseState", "requestHash" FROM "TopUpIntent" ORDER BY id`);
 const claims=await read(`SELECT id,"userId","intentId",channel,"amountCents"::text,points::text,"operationId","journalId","createdAt","evidenceHash" FROM "PaymentClaim" ORDER BY id`);
 const paymentWork=await read(`SELECT state,COUNT(*)::int AS count,MIN("createdAt") AS oldest,MAX("updatedAt") AS newest FROM "VerifyRequest" GROUP BY state ORDER BY state`);
 const deliveries=await read(`SELECT "auctionId",state,version,"assignedTo" FROM "FulfillmentCase" ORDER BY "auctionId"`);
 const outbox=await read(`SELECT kind,state,COUNT(*)::int AS count,MIN("createdAt") AS oldest,MAX("createdAt") AS newest,MAX("sentAt") AS last_sent,MAX("nextAttemptAt") AS next_attempt,MAX(attempts) AS max_attempts FROM "Outbox" GROUP BY kind,state ORDER BY kind,state`);
 const dependencies=await read(`SELECT p.id,p.slug,p.visible,p."categoryId",COUNT(DISTINCT a.id)::int AS auctions,COUNT(DISTINCT i.id)::int AS images FROM "Product" p LEFT JOIN "Auction" a ON a."productId"=p.id LEFT JOIN "ProductImage" i ON i."productId"=p.id GROUP BY p.id ORDER BY p.id`);
 const categories=await read(`SELECT id,slug,visible FROM "Category" ORDER BY id`);
 const drift=await read(`SELECT a.id,a.kind,a.balance::text,COALESCE(SUM(p.delta),0)::text AS projected FROM "LedgerAccount" a LEFT JOIN "Posting" p ON p."accountId"=a.id GROUP BY a.id HAVING a.balance<>COALESCE(SUM(p.delta),0)`);
 const unbalanced=await read(`SELECT j.id,COUNT(p.id)::int AS postings,COALESCE(SUM(p.delta),0)::text AS balance FROM "Journal" j LEFT JOIN "Posting" p ON p."journalId"=j.id GROUP BY j.id HAVING COUNT(p.id)<2 OR SUM(p.delta)<>0`);
 const heldDrift=await read(`SELECT w.id,a.balance::text,COALESCE(SUM(h.points),0)::text AS holds FROM "Wallet" w JOIN "LedgerAccount" a ON a."walletId"=w.id AND a.kind='HELD' LEFT JOIN "AuctionHold" h ON h."walletId"=w.id GROUP BY w.id,a.balance HAVING a.balance<>COALESCE(SUM(h.points),0)`);
 const staffFingerprint=await read(`SELECT s."userId",s.role,s.active,s.secret IS NOT NULL AS enrolled,md5(COALESCE(s.secret,'')||COALESCE(s."recoveryHashes"::text,'')) AS protected_mfa_fingerprint,md5(COALESCE(a.password,'')) AS credential_fingerprint FROM "StaffMember" s LEFT JOIN "account" a ON a."userId"=s."userId" AND a."providerId"='credential' ORDER BY s."userId"`);
 const users=await read(`SELECT COUNT(*)::int AS count,md5(string_agg(id||':'||COALESCE("telegramId"::text,''),'|' ORDER BY id)) AS identity_fingerprint FROM "user"`);
 return {identity,schemaHash:schema.schemaHash,auctions,bids,wallets,accounts,operations,journals,postings,holds,settlements,movements,payments,claims,paymentWork,deliveries,outbox,dependencies,categories,drift,unbalanced,heldDrift,staffFingerprint,users};
}
export async function recoveryInventory(db:Client,identity:Row){
 const credits=(await db.query(`SELECT id,"userId","sourceIntentId","intentId","amountCents"::text,reason,"journalId","operationId" FROM "AdminWalletCredit" ORDER BY id`)).rows.map(c=>({...c,reason:c.reason.replace(/(?:\+?251|0)[79]\d{8}/g,'[masked contact]')}));
 const workerActivity=(await db.query(`SELECT application_name,state,wait_event_type,COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY application_name,state,wait_event_type ORDER BY application_name,state`)).rows;
 const publicResults=(await db.query(`SELECT "auctionId",outcome FROM "PublicAuctionResult" ORDER BY "auctionId"`)).rows;
 return {identity,credits,workerActivity,publicResults};
}
export async function collectResetAudit(db:Client,identity:Row){const schema=await schemaInventory(db,identity),data=await domainInventory(db,identity,schema),recovery=await recoveryInventory(db,identity);const inventory={...data,snapshotHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};return {schema,inventory,recovery};}
