import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cpSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';

const base=process.env.CHAPA_V1_SCHEMA_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!base)('Chapa API version migration and immutable audit bindings',()=>{
 let db:PrismaClient,sql:Client,userId:string,legacyId:string,legacyEventId:string,before:unknown;
 const migration='202611110001_chapa_v1_hosted',hash='a'.repeat(64),fingerprint='b'.repeat(64);
 const topup=(apiVersion=1)=>({id:randomUUID(),userId,purpose:'TOP_UP',apiVersion,mode:'test',credentialFingerprint:fingerprint,key:randomUUID(),requestHash:hash,initialization:{currency:'ETB',amountCents:'1000'},merchantReference:'LW'+randomUUID().replaceAll('-','').slice(0,18),amountCents:1000n,currency:'ETB',expiresAt:new Date(Date.now()+86400000)});
 const preserved=async()=>({customers:(await sql.query('SELECT to_jsonb(u) AS row FROM "user" u ORDER BY id')).rows,checkouts:(await sql.query('SELECT to_jsonb(c)-\'apiVersion\' AS row FROM "ChapaCheckout" c ORDER BY id')).rows,events:(await sql.query('SELECT to_jsonb(e)-\'apiVersion\' AS row FROM "ChapaWebhookEvent" e ORDER BY id')).rows,journals:(await sql.query('SELECT to_jsonb(j) AS row FROM "Journal" j ORDER BY id')).rows,postings:(await sql.query('SELECT to_jsonb(p) AS row FROM "Posting" p ORDER BY id')).rows});
 beforeAll(async()=>{
  const source=new URL(base!);if(!['localhost','127.0.0.1'].includes(source.hostname)||!source.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  const adminUrl=new URL(source);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();const name='lowwin_chapa_api_'+randomUUID().slice(0,8)+'_test';await admin.query(`CREATE DATABASE "${name}"`);await admin.end();source.pathname='/'+name;
  const target=path.resolve('.local/chapa-api-version-'+name);mkdirSync(path.join(target,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(target,'schema.prisma'));cpSync('prisma/migrations/migration_lock.toml',path.join(target,'migrations/migration_lock.toml'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true}))if(entry.isDirectory()&&entry.name!==migration)cpSync(path.join('prisma/migrations',entry.name),path.join(target,'migrations',entry.name),{recursive:true});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.join(target,'schema.prisma')],{env:{...process.env,DATABASE_URL:source.href,DIRECT_URL:source.href,APP_ENV:'local'},stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:source.href});sql=new Client({connectionString:source.href});await sql.connect();userId=randomUUID();legacyId=randomUUID();legacyEventId=randomUUID();await db.user.create({data:{id:userId,name:'Preserved synthetic owner'}});
  await sql.query('INSERT INTO "ChapaCheckout"(id,"userId",purpose,mode,"credentialFingerprint",key,"requestHash",initialization,"merchantReference","amountCents",currency,"expiresAt","updatedAt") VALUES($1,$2,\'TOP_UP\',\'test\',$3,$4,$5,$6,$7,1000,\'ETB\',NOW()+interval \'1 day\',NOW())',[legacyId,userId,fingerprint,randomUUID(),hash,JSON.stringify({legacy:true}),'LW'+randomUUID().replaceAll('-','').slice(0,18)]);
  await sql.query('INSERT INTO "ChapaWebhookEvent"(id,mode,"configurationFingerprint","bodyHash",event) VALUES($1,\'test\',$2,$3,\'payment.pending\')',[legacyEventId,fingerprint,hash]);
  before=await preserved();await sql.query(readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8'));
 },60000);
 afterAll(async()=>{await db?.$disconnect();await sql?.end()});
 it('preserves every historical row and binds pre-existing attempts/events to v2',async()=>{
  expect(await preserved()).toEqual(before);expect((await db.chapaCheckout.findUniqueOrThrow({where:{id:legacyId}})).apiVersion).toBe(2);expect((await db.chapaWebhookEvent.findUniqueOrThrow({where:{id:legacyEventId}})).apiVersion).toBe(2);
 });
 it('rejects API-version mutation and unrecognized versions',async()=>{
  await expect(db.chapaCheckout.update({where:{id:legacyId},data:{apiVersion:1}})).rejects.toThrow('API version is immutable');
  await expect(db.chapaWebhookEvent.update({where:{id:legacyEventId},data:{apiVersion:1}})).rejects.toThrow('API version is immutable');
  await expect(db.chapaCheckout.create({data:topup(3)})).rejects.toThrow('chapa_checkout_api_version');
 });
 it('allows v1 hosted attempts while rejecting v1 direct-charge records',async()=>{
  expect(await db.chapaCheckout.create({data:topup()})).toMatchObject({apiVersion:1,chargeType:'HOSTED'});
  await expect(db.chapaCheckout.create({data:{...topup(),chargeType:'DIRECT',paymentMethod:'telebirr',payerPhoneCipher:'synthetic-cipher',reconcileUntil:new Date(Date.now()+60000)}})).rejects.toThrow('chapa_v1_hosted_only');
 });
 it('requires versioned receipt proof for both inserted and newly attached v1 credit',async()=>{
  const credit={creditJournalId:randomUUID(),chapaReference:'CH'+randomUUID().replaceAll('-',''),evidenceHash:hash,status:'CREDITED'};
  await expect(db.chapaCheckout.create({data:{...topup(),...credit}})).rejects.toThrow('v1 credit requires its versioned receipt proof');
  const order=await db.chapaCheckout.create({data:topup()});await expect(db.chapaCheckout.update({where:{id:order.id},data:credit})).rejects.toThrow('v1 credit requires its versioned receipt proof');
  expect((await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).creditJournalId).toBeNull();
 });
 it('isolates duplicate-delivery identities and requires the linked checkout version/mode',async()=>{
  const order=await db.chapaCheckout.create({data:topup()}),event={apiVersion:1,mode:'test',configurationFingerprint:fingerprint,bodyHash:hash,event:'charge.success',checkoutId:order.id};
  await expect(db.chapaWebhookEvent.create({data:{...event,checkoutId:legacyId}})).rejects.toThrow('must match the payment API version and mode');
  await expect(db.chapaWebhookEvent.create({data:{...event,mode:'live'}})).rejects.toThrow('must match the payment API version and mode');
  await db.chapaWebhookEvent.create({data:event});await expect(db.chapaWebhookEvent.create({data:event})).rejects.toMatchObject({code:'P2002'});
  expect(await db.chapaWebhookEvent.count({where:{configurationFingerprint:fingerprint,bodyHash:hash}})).toBe(2);
 });
 it('retains global final-reference uniqueness across versions',async()=>{
  const reference='CH'+randomUUID().replaceAll('-','');await db.chapaCheckout.create({data:{...topup(),chapaReference:reference}});
  await expect(db.chapaCheckout.create({data:{...topup(2),chapaReference:reference}})).rejects.toMatchObject({code:'P2002'});
 });
});
