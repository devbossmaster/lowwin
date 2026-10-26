import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cpSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {ensureWallet,seedPlatformAccounts} from '../src/modules/wallet/ledger';

const base=process.env.CHAPA_SCHEMA_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!base)('Chapa additive storage and database guards',()=>{
 let db:PrismaClient,sql:Client,userId:string,auctionId:string,availableId:string,issuanceId:string,existing:unknown;
 const migration='202610260002_chapa_hosted_checkout';
 const hash='a'.repeat(64),fingerprint='b'.repeat(64);
 const topup=()=>({userId,purpose:'TOP_UP',mode:'test',credentialFingerprint:fingerprint,key:randomUUID(),requestHash:hash,initialization:{currency:'ETB',amount:1000},merchantReference:randomUUID().replaceAll('-','').slice(0,20),amountCents:1000n,currency:'ETB',expiresAt:new Date(Date.now()+86400000)});
 const bid=()=>({...topup(),purpose:'BID',auctionId,auctionSlug:'synthetic-chapa-schema',bidNumber:'1.01',feeVersion:1,grossFee:'10',discountPoints:'1',amountCents:900n});
 const snapshot=async()=>({users:await db.user.findMany({orderBy:{id:'asc'}}),wallets:await db.wallet.findMany({orderBy:{id:'asc'}}),accounts:await db.ledgerAccount.findMany({orderBy:{id:'asc'}}),operations:await db.operation.findMany({orderBy:{id:'asc'}}),journals:await db.journal.findMany({orderBy:{id:'asc'}}),postings:await db.posting.findMany({orderBy:{id:'asc'}})});
 beforeAll(async()=>{
  const source=new URL(base!);if(!['127.0.0.1','localhost'].includes(source.hostname)||!source.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  const adminUrl=new URL(source);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();const name=`lowwin_chapa_schema_${randomUUID().slice(0,8)}_test`;await admin.query(`CREATE DATABASE "${name}"`);await admin.end();source.pathname='/'+name;
  const schemaDir=path.resolve('.local/chapa-schema-'+name);mkdirSync(path.join(schemaDir,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(schemaDir,'schema.prisma'));cpSync('prisma/migrations/migration_lock.toml',path.join(schemaDir,'migrations/migration_lock.toml'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true}))if(entry.isDirectory()&&entry.name!==migration)cpSync(path.join('prisma/migrations',entry.name),path.join(schemaDir,'migrations',entry.name),{recursive:true});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.join(schemaDir,'schema.prisma')],{env:{...process.env,DATABASE_URL:source.href,DIRECT_URL:source.href,APP_ENV:'local'},stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:source.href});sql=new Client({connectionString:source.href});await sql.connect();userId=randomUUID();await db.user.create({data:{id:userId,name:'Synthetic preserved customer'}});auctionId=(await db.auction.create({data:{code:'SCHEMA-'+randomUUID(),slug:'synthetic-chapa-schema'}})).id;
  await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await ensureWallet(tx,userId);await seedPlatformAccounts(tx);availableId=(await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}})).id;issuanceId=(await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}})).id;const operation=await tx.operation.create({data:{userId,scope:'SYNTHETIC_PRIOR_FUNDS',key:randomUUID(),requestHash:hash,result:{fixture:true}}});await tx.journal.create({data:{operationId:operation.id,kind:'SYNTHETIC_PRIOR_FUNDS',reference:'isolated-schema-preservation',postings:{create:[{accountId:issuanceId,delta:'-25'},{accountId:availableId,delta:'25'}]}}})});
  existing=await snapshot();await sql.query(readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8'));await sql.query(readFileSync('deploy/runtime-role.sql','utf8'));
 },60000);
 afterAll(async()=>{await db?.$disconnect();await sql?.end()});
 it('adds storage without changing existing customers, funds or ledger evidence',async()=>{expect(await snapshot()).toEqual(existing);expect(await db.chapaCheckout.count()).toBe(0);expect(await db.chapaWebhookEvent.count()).toBe(0)});
 it('rejects missing bid quote fields and inconsistent cents without requiring old-table changes',async()=>{
  await expect(db.chapaCheckout.create({data:{...bid(),grossFee:null}})).rejects.toThrow('chapa_checkout_purpose_fields');
  await expect(db.chapaCheckout.create({data:{...bid(),feeVersion:null}})).rejects.toThrow('chapa_checkout_purpose_fields');
  await expect(db.chapaCheckout.create({data:{...bid(),amountCents:1000n}})).rejects.toThrow('chapa_checkout_purpose_fields');
  for(const amountCents of [99n,4320001n])await expect(db.chapaCheckout.create({data:{...topup(),amountCents}})).rejects.toThrow();
  await expect(db.chapaCheckout.create({data:{...topup(),currency:'USD'}})).rejects.toThrow();
  await expect(db.chapaCheckout.create({data:{...topup(),phoneCipher:'encrypted-only'}})).rejects.toThrow('chapa_checkout_contact_binding');
 });
 it('freezes identity, environment, initialization, expected money and encrypted contact binding',async()=>{
  const order=await db.chapaCheckout.create({data:{...topup(),phoneCipher:'synthetic-cipher',phoneBotId:'synthetic-bot'}});
  for(const data of [{mode:'live'},{amountCents:1100n},{initialization:{amount:1100}},{phoneBotId:'another-bot'},{credentialFingerprint:'c'.repeat(64)}])await expect(db.chapaCheckout.update({where:{id:order.id},data})).rejects.toThrow('intent is immutable');
  await expect(db.chapaCheckout.delete({where:{id:order.id}})).rejects.toThrow('cannot be deleted');
 });
 it('prevents a second unresolved bid payment while retaining failed attempts',async()=>{
  const order=await db.chapaCheckout.create({data:bid()});await expect(db.chapaCheckout.create({data:bid()})).rejects.toMatchObject({code:'P2002'});await db.chapaCheckout.update({where:{id:order.id},data:{status:'FAILED',reason:'SYNTHETIC_PROVIDER_FAILURE'}});await expect(db.chapaCheckout.create({data:bid()})).resolves.toMatchObject({purpose:'BID'});
 });
 it('binds the first provider reference, URL and checkout validity',async()=>{
  const order=await db.chapaCheckout.create({data:topup()}),created=new Date();await db.chapaCheckout.update({where:{id:order.id},data:{chapaReference:'CH-'+randomUUID(),checkoutUrl:'https://checkout.chapa.global/synthetic',providerCreatedAt:created,status:'PENDING'}});
  await expect(db.chapaCheckout.update({where:{id:order.id},data:{chapaReference:'CH-replaced'}})).rejects.toThrow('evidence is immutable');await expect(db.chapaCheckout.update({where:{id:order.id},data:{checkoutUrl:'https://checkout.chapa.global/replaced'}})).rejects.toThrow('evidence is immutable');await expect(db.chapaCheckout.update({where:{id:order.id},data:{expiresAt:new Date(Date.now()+1000)}})).rejects.toThrow('validity is immutable');
 });
 it('requires verified credit evidence for a credited state and freezes its committed outcome',async()=>{
  const order=await db.chapaCheckout.create({data:topup()});await expect(db.chapaCheckout.update({where:{id:order.id},data:{status:'CREDITED'}})).rejects.toThrow('chapa_checkout_credited');
  const journal=await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;const operation=await tx.operation.create({data:{userId,scope:'SYNTHETIC_VERIFIED_CHAPA',key:order.id,requestHash:hash,result:{checkoutId:order.id}}});return tx.journal.create({data:{operationId:operation.id,kind:'SYNTHETIC_VERIFIED_CHAPA',reference:order.id,postings:{create:[{accountId:issuanceId,delta:'-10'},{accountId:availableId,delta:'10'}]}}})});
  await db.chapaCheckout.update({where:{id:order.id},data:{status:'CREDITED',chapaReference:'CH-'+randomUUID(),creditJournalId:journal.id,evidenceHash:hash,paymentMethod:'telebirr',processorReference:'synthetic-reconciliation-reference',serviceFeeCents:30n}});
  for(const data of [{status:'PENDING'},{evidenceHash:'c'.repeat(64)},{creditJournalId:null},{receipt:{replacement:true}},{serviceFeeCents:40n}])await expect(db.chapaCheckout.update({where:{id:order.id},data})).rejects.toThrow('immutable');
  expect((await db.ledgerAccount.findUniqueOrThrow({where:{id:availableId}})).balance.toString()).toBe('35');
 });
 it('can preserve a late verified failed bid payment even after a replacement attempt exists',async()=>{
  const details={...bid(),bidNumber:'2.02'},old=await db.chapaCheckout.create({data:details});await db.chapaCheckout.update({where:{id:old.id},data:{status:'FAILED'}});await db.chapaCheckout.create({data:{...details,key:randomUUID(),merchantReference:randomUUID().replaceAll('-','').slice(0,20)}});
  const journal=await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;const operation=await tx.operation.create({data:{userId,scope:'SYNTHETIC_LATE_CHAPA',key:old.id,requestHash:hash,result:{checkoutId:old.id}}});return tx.journal.create({data:{operationId:operation.id,kind:'SYNTHETIC_LATE_CHAPA',reference:old.id,postings:{create:[{accountId:issuanceId,delta:'-9'},{accountId:availableId,delta:'9'}]}}})});
  await expect(db.chapaCheckout.update({where:{id:old.id},data:{status:'NEEDS_REVIEW',reason:'BID_ALREADY_ACCEPTED',chapaReference:'CH-'+randomUUID(),creditJournalId:journal.id,evidenceHash:hash}})).resolves.toMatchObject({status:'NEEDS_REVIEW',bidId:null});expect(await db.bid.count()).toBe(0);
 });
 it('deduplicates delivery hashes by environment and configuration, without mutable raw payloads',async()=>{
  const event={mode:'test',configurationFingerprint:fingerprint,bodyHash:hash,event:'payment.success',merchantReference:'synthetic-merchant'};const row=await db.chapaWebhookEvent.create({data:event});await expect(db.chapaWebhookEvent.create({data:event})).rejects.toMatchObject({code:'P2002'});await expect(db.chapaWebhookEvent.create({data:{...event,mode:'live'}})).resolves.toBeTruthy();await expect(db.chapaWebhookEvent.update({where:{id:row.id},data:{event:'payment.failed'}})).rejects.toThrow('immutable');await expect(db.chapaWebhookEvent.delete({where:{id:row.id}})).rejects.toThrow('immutable');
 });
 it('keeps browser roles out and grants only required server table operations',async()=>{
  const grants=(await sql.query(`SELECT grantee FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('ChapaCheckout','ChapaWebhookEvent') AND grantee IN ('PUBLIC','anon','authenticated')`)).rows;expect(grants).toEqual([]);
  const rls=(await sql.query(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('ChapaCheckout','ChapaWebhookEvent')`)).rows;expect(rls).toHaveLength(2);expect(rls.every(r=>r.relrowsecurity)).toBe(true);
  const rights=(await sql.query(`SELECT (has_table_privilege('lowwin_runtime','"ChapaCheckout"','SELECT') AND has_table_privilege('lowwin_runtime','"ChapaCheckout"','INSERT') AND has_table_privilege('lowwin_runtime','"ChapaCheckout"','UPDATE')) AS checkout,has_table_privilege('lowwin_runtime','"ChapaCheckout"','DELETE,TRUNCATE') AS checkout_delete,(has_table_privilege('lowwin_runtime','"ChapaWebhookEvent"','SELECT') AND has_table_privilege('lowwin_runtime','"ChapaWebhookEvent"','INSERT')) AS webhook,has_table_privilege('lowwin_runtime','"ChapaWebhookEvent"','UPDATE,DELETE,TRUNCATE') AS webhook_change`)).rows[0];expect(rights).toEqual({checkout:true,checkout_delete:false,webhook:true,webhook_change:false});
 });
});
