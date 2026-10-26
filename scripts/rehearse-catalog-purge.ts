import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Client} from 'pg';
import {PrismaClient} from '@prisma/client';
import {Bot} from 'grammy';
import {bidAuction,bidUser} from '../tests/bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {scheduleAlerts,dispatchOne} from '../src/modules/notifications/service';
import {collectResetAudit} from './auction-reset-audit';
import {prepareReset,writeResetPackage} from './prepare-auction-reset';
import {collectCatalogPurgeAudit,prepareCatalogPurge,writeCatalogPurge,CATALOG_PURGE_TABLES} from './catalog-purge';

const source=new URL(process.env.RESET_TEST_BASE_URL??'');
if(!['127.0.0.1','localhost'].includes(source.hostname)||!source.pathname.endsWith('_test')||process.env.APP_ENV!=='local'||process.env.NODE_ENV==='production')throw Error('Explicit disposable loopback _test database required');
Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'isolated-reset-only-secret-at-least-thirty-two',TELEGRAM_BOT_TOKEN:'123456789:local_reset_synthetic_token_20261026',TELEGRAM_BOT_USERNAME:'lowin_reset_test_bot',TELEGRAM_WEBHOOK_SECRET:'isolated-reset-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'reset-local',PHONE_CONTACT_KEYS:JSON.stringify({'reset-local':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),ADMIN_MFA_KEY:'b'.repeat(64),ARIFPAY_ENABLED:'false',CHAPA_ENABLED:'false',WALLET_BIDS_ENABLED:'false',PAYMENTS_LIVE_ENABLED:'false',STAGING_DEMO_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'false'});
const checks:string[]=[];
async function scenario(productionShape:boolean){
 const name=`lowwin_catalog_purge_${productionShape?'prod31':'current'}_${randomUUID().slice(0,8)}_test`,adminUrl=new URL(source);adminUrl.pathname='/postgres';
 const admin=new Client({connectionString:adminUrl.href});await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);await admin.end();
 const target=new URL(source);target.pathname='/'+name;const env={...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href};Object.assign(process.env,env);
 let schemaFile='prisma/schema.prisma';
 if(productionShape){const dir=path.resolve('.local/purge-schema-'+name);fs.mkdirSync(path.join(dir,'migrations'),{recursive:true});fs.copyFileSync(schemaFile,path.join(dir,'schema.prisma'));for(const m of JSON.parse(fs.readFileSync('docs/redesign/admin-reset/schema-baseline.json','utf8')).migrations)fs.cpSync('prisma/migrations/'+m.migration_name,path.join(dir,'migrations',m.migration_name),{recursive:true});fs.copyFileSync('prisma/migrations/migration_lock.toml',path.join(dir,'migrations/migration_lock.toml'));schemaFile=path.join(dir,'schema.prisma')}
 execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',schemaFile],{env,stdio:'pipe'});
 const db=new PrismaClient({datasourceUrl:target.href}),sql=new Client({connectionString:target.href});await sql.connect();
 const owner=randomUUID();await db.user.create({data:{id:owner,name:'Synthetic Owner',email:`purge-${randomUUID()}@fixture.invalid`,accounts:{create:{id:randomUUID(),accountId:owner,providerId:'credential',password:'synthetic-hash'}},staffMember:{create:{role:'OWNER',secret:'synthetic-protected-secret',recoveryHashes:['synthetic-recovery-hash']}}}});
 const players=[await bidUser(db,'100'),await bidUser(db,'100')],auction=await bidAuction(db,{fee:2,ruleVersion:'lowest-unique-v4'});
 for(const [index,userId]of players.entries())await submitBid(db,{userId,auctionSlug:auction.slug!,amount:String(3+index),feeVersion:1,key:randomUUID()});
 await db.managedMedia.create({data:{bytes:Buffer.from('synthetic image bytes'),mime:'image/png',sourceType:'ORIGINAL',sourceCredit:'Isolated fixture'}});
 const oldPublicCode=auction.publicCode,runId='purge-rehearsal-'+randomUUID().slice(0,8),directory=path.resolve('.local/'+name);fs.mkdirSync(directory,{recursive:true});
 const legacySql=fs.readFileSync('prisma/migrations/202610270001_retire_legacy_customer_tables/migration.sql','utf8');
 if(productionShape){await sql.query('INSERT INTO "SupportCase"(id,"userId",subject,message,status,resolution,"updatedAt") VALUES($1,$2,$3,$4,\'OPEN\',\'\',CURRENT_TIMESTAMP)',[randomUUID(),players[0],'Synthetic retired support case','Isolated test only']);try{await assert.rejects(sql.query(legacySql),/still has records/)}finally{await sql.query('ROLLBACK')}checks.push(name+': legacy table migration refuses nonempty history')}
 const read=async()=>{await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{const identity=(await sql.query("SELECT current_setting('transaction_read_only') AS read_only,transaction_timestamp() AS snapshot_at")).rows[0];return await collectResetAudit(sql,{...identity,verifiedTls:false,projectRef:'isolated-fixture'})}finally{await sql.query('ROLLBACK')}};
 const purgeRead=async()=>{await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{return await collectCatalogPurgeAudit(sql,runId)}finally{await sql.query('ROLLBACK')}};
 const before=await purgeRead();assert.ok(before.blockers.includes('Refund reset has not completed'));assert.throws(()=>prepareCatalogPurge(before,undefined,{fixture:true}),/Refund reset has not completed/);checks.push(name+': cleanup cannot prepare before refunds');
 const audit=await read(),options={runId,reason:'Synthetic explicit full catalog cleanup after net fee compensation',fixture:true};
 let reset=prepareReset(audit.inventory,audit.schema,audit.recovery,options);
 reset=prepareReset(audit.inventory,audit.schema,audit.recovery,{...options,review:{rolloutAcknowledgement:'MATCHING_WEB_AND_WORKERS_DEPLOYED',backupAcknowledgement:'RESTORABLE_BACKUP_VERIFIED',executionAcknowledgement:'EXECUTE_REVIEWED_RESET',reviewedManifestHash:reset.config.manifestHash,reviewedCompensationEtb:reset.config.totalCompensation}});writeResetPackage(reset.config,directory);
 await sql.query(fs.readFileSync(path.join(directory,'02_guarded_reset.sql'),'utf8'));assert.deepEqual(await reconcile(db),[]);
 const pendingBefore=JSON.stringify(await db.outbox.findMany({orderBy:{id:'asc'}}));let sends=0;const bot=new Bot(process.env.TELEGRAM_BOT_TOKEN!);bot.api.config.use(async()=>{sends++;return {ok:true,result:{message_id:1}} as any});
 assert.equal(await scheduleAlerts(db),0);assert.equal(await dispatchOne(db,bot),false);assert.equal(sends,0);assert.equal(JSON.stringify(await db.outbox.findMany({orderBy:{id:'asc'}})),pendingBefore);checks.push(name+': maintenance stops notification scheduling and delivery without touching funds or pending jobs');
 const preserved=(await read()).inventory;
 const users=JSON.stringify(preserved.users),staff=JSON.stringify(preserved.staffFingerprint);
 const financial=(value:typeof preserved)=>JSON.stringify({accounts:value.accounts,wallets:value.wallets,operations:value.operations,journals:value.journals,postings:value.postings,claims:value.claims,payments:value.payments});let money=financial(preserved);
 const approve=(config:Record<string,any>)=>({reviewedManifestHash:config.manifestHash,backupAcknowledgement:'RESTORABLE_BACKUP_VERIFIED',workersAcknowledgement:'ALL_AUCTION_AND_NOTIFICATION_WORKERS_DRAINED',executionAcknowledgement:'EXECUTE_REVIEWED_CATALOG_PURGE'});
 const execute=async()=>{try{await sql.query(fs.readFileSync(path.join(directory,'04_catalog_purge.sql'),'utf8'))}catch(error){await sql.query('ROLLBACK');throw error}};
 let inventory=await purgeRead(),config=prepareCatalogPurge(inventory,undefined,{fixture:true});writeCatalogPurge(config,directory);await assert.rejects(execute,/Purge review gate/);checks.push(name+': unapproved cleanup cannot delete any catalog row');
 await sql.query("CREATE FUNCTION fail_catalog_purge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='RESET_CATALOG_PURGED' THEN RAISE EXCEPTION 'forced purge failure'; END IF; RETURN NEW; END $$");await sql.query('CREATE TRIGGER fail_catalog_purge BEFORE INSERT ON "AdminAudit" FOR EACH ROW EXECUTE FUNCTION fail_catalog_purge()');
 inventory=await purgeRead();config=prepareCatalogPurge(inventory,undefined,{fixture:true});config=prepareCatalogPurge(inventory,approve(config),{fixture:true});writeCatalogPurge(config,directory);
 await assert.rejects(execute,/forced purge failure/);assert.equal(await db.bid.count(),2);assert.equal(await db.auction.count(),1);assert.equal(await db.adminAudit.count({where:{action:'RESET_CATALOG_FINANCIAL_PROOF'}}),0);
 await assert.rejects(db.bid.update({where:{id:preserved.bids[0].id},data:{amount:99}}));checks.push(name+': final audit failure rolls back deletion and restores original immutable guards');
 await sql.query('DROP TRIGGER fail_catalog_purge ON "AdminAudit"');await sql.query('DROP FUNCTION fail_catalog_purge()');
 inventory=await purgeRead();assert.throws(()=>prepareCatalogPurge(inventory,approve(config),{fixture:true}),/exact reviewed inventory/);
 config=prepareCatalogPurge(inventory,undefined,{fixture:true});config=prepareCatalogPurge(inventory,approve(config),{fixture:true});writeCatalogPurge(config,directory);
 await creditDevelopmentPoints(db,players[0],'1',randomUUID());await assert.rejects(execute,/Reviewed table .* changed/);assert.equal(await db.bid.count(),2);checks.push(name+': a later legitimate credit blocks stale cleanup and is retained after re-review');
 money=financial((await read()).inventory);inventory=await purgeRead();config=prepareCatalogPurge(inventory,undefined,{fixture:true});config=prepareCatalogPurge(inventory,approve(config),{fixture:true});writeCatalogPurge(config,directory);await execute();
 for(const table of CATALOG_PURGE_TABLES)if(inventory.tables.some(t=>t.name===table))assert.equal((await sql.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0].n,0);
 const after=(await read()).inventory;assert.equal(JSON.stringify(after.users),users);assert.equal(JSON.stringify(after.staffFingerprint),staff);assert.equal(financial(after),money);assert.deepEqual(await reconcile(db),[]);
 const sealed=await db.adminAudit.findFirstOrThrow({where:{action:'RESET_CATALOG_FINANCIAL_PROOF'}}),proof=sealed.details as {Bid:unknown[];AuctionSettlement:Array<{proof:{feePolicy:string}}>};assert.equal(proof.Bid.length,2);assert.equal(proof.AuctionSettlement[0].proof.feePolicy,'NON_REFUNDABLE_SUBMISSION_FEES');
 const verificationResult=await sql.query(fs.readFileSync(path.join(directory,'05_verify_catalog_purge.sql'),'utf8')),verification=(Array.isArray(verificationResult)?verificationResult:[verificationResult]).find(r=>r.rows?.[0]?.cleanup_verification)?.rows[0].cleanup_verification;
 assert.ok(verification);assert.equal(verification.projectionDrift,0);assert.equal(verification.sealedProofs,1);assert.ok(verification.catalogRows.every((r:{rows:number})=>r.rows===0));checks.push(name+': catalog, bids, notification history and legacy support cleared; users, Owner, wallets and all money records unchanged');
 await execute();assert.equal(await db.adminAudit.count({where:{action:'RESET_CATALOG_PURGED'}}),1);checks.push(name+': exact purge rerun is a no-op');
 if(productionShape)await sql.query(legacySql);
 for(const table of ['VerifiedPhoneIdentity','ExternalEvent','SupportCase'])assert.equal((await sql.query('SELECT to_regclass($1) AS table',['public."'+table+'"'])).rows[0].table,null);
 const newest=await bidAuction(db,{fee:2,ruleVersion:'lowest-unique-v4'});assert.ok(newest.publicCode>oldPublicCode);
 // Resume exists only in this disposable fixture; production remains halted.
 await db.adminAudit.create({data:{actorId:owner,action:'AUCTIONS_MAINTENANCE_RESUMED',target:runId,details:{runId,fixture:true}}});await submitBid(db,{userId:players[0],auctionSlug:newest.slug!,amount:'8',feeVersion:1,key:randomUUID()});assert.deepEqual(await reconcile(db),[]);checks.push(name+': retired tables removed and a fresh auction accepts a correct fee without reusing old public codes');
 if(!productionShape){await db.chapaCheckout.create({data:{userId:players[0],purpose:'BID',mode:'test',credentialFingerprint:'a'.repeat(64),key:randomUUID(),requestHash:'b'.repeat(64),initialization:{synthetic:true},merchantReference:randomUUID().replaceAll('-','').slice(0,20),amountCents:200n,auctionId:newest.id,auctionSlug:newest.slug!,bidNumber:9,feeVersion:1,grossFee:2,expiresAt:new Date(Date.now()+60000)}});assert.ok((await purgeRead()).blockers.some(b=>b.includes('ChapaCheckout')));checks.push(name+': linked Chapa evidence prevents another destructive cleanup')}
 await db.$disconnect();await sql.end();return {database:name,shape:productionShape?'production-31':'current',checks:checks.filter(c=>c.startsWith(name))};
}
const results=[];for(const mode of [true,false])results.push(await scenario(mode));fs.mkdirSync('docs/redesign/admin-reset',{recursive:true});fs.writeFileSync('docs/redesign/admin-reset/catalog-purge-rehearsal.json',JSON.stringify({at:new Date().toISOString(),mode:'DISPOSABLE LOOPBACK ONLY',passed:true,results},null,2)+'\n');console.log(JSON.stringify({passed:true,checks:checks.length,results}));
