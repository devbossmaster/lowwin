import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cpSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {ensureWallet,seedPlatformAccounts} from '../src/modules/wallet/ledger';

const base=process.env.CHAPA_SIGNALS_REVIEW_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
const migrations=['202611170001_chapa_payment_signals','202611170002_chapa_signal_guards'];
describe.skipIf(!base)('additive payment signal migration and preserved audit guards',()=>{
 let db:PrismaClient,sql:Client,admin:Client,name:string,userId:string,checkoutId:string,previous:Record<string,unknown>,funds:unknown;
 const snapshot=async()=>({users:await db.user.findMany({orderBy:{id:'asc'}}),wallets:await db.wallet.findMany({orderBy:{id:'asc'}}),accounts:await db.ledgerAccount.findMany({orderBy:{id:'asc'}}),operations:await db.operation.findMany({orderBy:{id:'asc'}}),journals:await db.journal.findMany({orderBy:{id:'asc'}}),postings:await db.posting.findMany({orderBy:{id:'asc'}})});
 beforeAll(async()=>{
  const source=new URL(base!);if(!['127.0.0.1','localhost'].includes(source.hostname)||!source.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  const adminUrl=new URL(source);adminUrl.pathname='/postgres';admin=new Client({connectionString:adminUrl.href});await admin.connect();name=`lowwin_chapa_signals_review_${randomUUID().slice(0,8)}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);source.pathname='/'+name;
  const directory=path.resolve('.local',name);mkdirSync(path.join(directory,'migrations'),{recursive:true});cpSync('prisma/schema.prisma',path.join(directory,'schema.prisma'));cpSync('prisma/migrations/migration_lock.toml',path.join(directory,'migrations/migration_lock.toml'));
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true}))if(entry.isDirectory()&&!migrations.includes(entry.name))cpSync(path.join('prisma/migrations',entry.name),path.join(directory,'migrations',entry.name),{recursive:true});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.join(directory,'schema.prisma')],{env:{...process.env,DATABASE_URL:source.href,DIRECT_URL:source.href,APP_ENV:'local'},stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:source.href});sql=new Client({connectionString:source.href});await sql.connect();userId=randomUUID();checkoutId=randomUUID();await db.user.create({data:{id:userId,name:'Synthetic preserved payment owner'}});
  await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await ensureWallet(tx,userId);await seedPlatformAccounts(tx);const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}});const operation=await tx.operation.create({data:{userId,scope:'SYNTHETIC_PRIOR_FUNDS',key:randomUUID(),requestHash:'a'.repeat(64),result:{fixture:true}}});await tx.journal.create({data:{operationId:operation.id,kind:'SYNTHETIC_PRIOR_FUNDS',reference:'preserved-before-payment-signals',postings:{create:[{accountId:issuance.id,delta:'-17.25'},{accountId:available.id,delta:'17.25'}]}}})});
  await sql.query(`INSERT INTO "ChapaCheckout" (id,"userId",purpose,mode,"credentialFingerprint",key,"requestHash",initialization,"merchantReference","amountCents",currency,status,"providerStatus","verificationState","expiresAt","updatedAt") VALUES ($1,$2,'TOP_UP','test',$3,$4,$5,$6,$7,1000,'ETB','PENDING','PENDING','VERIFIED',CURRENT_TIMESTAMP+interval '1 day',CURRENT_TIMESTAMP)`,[checkoutId,userId,'b'.repeat(64),randomUUID(),'a'.repeat(64),JSON.stringify({currency:'ETB',amount:1000}),'LW'+randomUUID().replaceAll('-','').slice(0,18)]);
  previous=(await sql.query('SELECT row_to_json(c) AS value FROM "ChapaCheckout" c WHERE id=$1',[checkoutId])).rows[0].value;funds=await snapshot();
  for(const migration of migrations)await sql.query(readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8'));
 },60000);
 afterAll(async()=>{
  await db?.$disconnect();await sql?.end();
  if(admin){if(/^lowwin_chapa_signals_review_[a-f0-9]{8}_test$/.test(name??''))await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end()}
 });
 it('preserves existing owners, balances, ledger rows and the original pending attempt',async()=>{
  expect(await snapshot()).toEqual(funds);const current=(await sql.query('SELECT row_to_json(c) AS value FROM "ChapaCheckout" c WHERE id=$1',[checkoutId])).rows[0].value;
  expect(Object.fromEntries(Object.keys(previous).map(key=>[key,current[key]]))).toEqual(previous);
  expect(current).toMatchObject({verificationSignalVersion:0,verificationHandledSignalVersion:0,verificationCompletionStatus:null,lastPrivateCheckAt:null,verificationRetryAfter:null,providerCancelledBy:null});
 });
 it('freezes authenticated webhook feedback while retaining bounded worker bookkeeping',async()=>{
  const event=await db.chapaWebhookEvent.create({data:{mode:'test',configurationFingerprint:'b'.repeat(64),bodyHash:'c'.repeat(64),event:'payment.cancelled',checkoutId,providerReasonCode:'PAYMENT_CANCELLED',cancelledBy:'USER',providerUpdatedAt:new Date(),paymentMethod:'telebirr'}});
  for(const data of [{providerReasonCode:'INVALID_PIN'},{cancelledBy:'SYSTEM'},{providerUpdatedAt:new Date(Date.now()+1000)},{paymentMethod:'mpesa'}])await expect(db.chapaWebhookEvent.update({where:{id:event.id},data})).rejects.toThrow('immutable');
  await expect(db.chapaWebhookEvent.update({where:{id:event.id},data:{attempts:{increment:1},leaseUntil:new Date(Date.now()+30000),nextAttemptAt:new Date(Date.now()+5000)}})).resolves.toMatchObject({attempts:1,cancelledBy:'USER',providerReasonCode:'PAYMENT_CANCELLED'});
 });
});
