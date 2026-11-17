import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readChapaInlineSchema} from '../src/modules/payments/chapa-inline-schema';
import {checkChapaInlineReadiness,CHAPA_CONFIRMATION_MIGRATIONS} from '../src/modules/payments/chapa-inline-readiness';

const base=process.env.TEST_DATABASE_URL;
describe.skipIf(!base)('read-only deployed confirmation schema metadata',()=>{
 let db:PrismaClient,sql:Client,admin:Client,name:string;const queries:string[]=[];
 beforeAll(async()=>{
  const target=new URL(base!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  const adminUrl=new URL(target);adminUrl.pathname='/postgres';admin=new Client({connectionString:adminUrl.href});await admin.connect();name='lowwin_inline_readiness_'+randomUUID().slice(0,8)+'_test';await admin.query(`CREATE DATABASE "${name}"`);target.pathname='/'+name;
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href,APP_ENV:'local'},stdio:'pipe'});
  const instrumented=new PrismaClient({datasourceUrl:target.href,log:[{emit:'event',level:'query'}]});instrumented.$on('query',event=>queries.push(event.query));db=instrumented;sql=new Client({connectionString:target.href});await sql.connect();
 },60000);
 afterAll(async()=>{await db?.$disconnect();await sql?.end();if(admin){if(/^lowwin_inline_readiness_[a-f0-9]{8}_test$/.test(name??''))await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end()}});
 const report=async()=>checkChapaInlineReadiness({APP_ENV:'test',NODE_ENV:'test',DATABASE_URL:'postgresql://fixture@127.0.0.1:9/absent_test',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(32),CHAPA_WEBHOOK_SECRET:'synthetic-schema-secret-thirty-two-characters'},()=>readChapaInlineSchema(db));
 it('requires all three migrations, new columns and active guard definitions without reading customers',async()=>{
  queries.length=0;const result=await report();expect(result).toMatchObject({ready:true,schema:{status:'ok',requiredConfirmationMigrations:CHAPA_CONFIRMATION_MIGRATIONS,signalColumns:true,webhookFeedbackColumns:true,eventFeedbackGuard:true,providerEvidenceGuard:true,completionStatusConstraint:true}});
  expect(queries.some(query=>query.includes('SET TRANSACTION READ ONLY'))).toBe(true);
  expect(queries.some(query=>/\bFROM\s+(?:public\.)?"?(?:ChapaCheckout|ChapaWebhookEvent|user|Wallet|Journal|Posting)"?\b/i.test(query))).toBe(false);
  expect(queries.some(query=>/^\s*(INSERT|UPDATE|DELETE|ALTER)\b/i.test(query))).toBe(false);
 });
 it('fails closed if either confirmation migration is not completed',async()=>{
  for(const migration of CHAPA_CONFIRMATION_MIGRATIONS){
   await sql.query('UPDATE _prisma_migrations SET finished_at=NULL WHERE migration_name=$1',[migration]);
   try{expect(await report()).toMatchObject({ready:false,schema:{status:'pending'}})}finally{await sql.query('UPDATE _prisma_migrations SET finished_at=CURRENT_TIMESTAMP WHERE migration_name=$1',[migration])}
  }
 });
 it('rejects a stale event guard even if migration 002 is marked applied',async()=>{
  const original=(await sql.query("SELECT pg_get_functiondef('public.protect_chapa_event_job()'::regprocedure) AS definition")).rows[0].definition;
  await sql.query('CREATE OR REPLACE FUNCTION protect_chapa_event_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
  try{expect(await report()).toMatchObject({ready:false,schema:{status:'incomplete',eventFeedbackGuard:false}})}finally{await sql.query(original)}
 });
 it('rejects disabled provider evidence protection and a missing completion constraint',async()=>{
  await sql.query('ALTER TABLE "ChapaCheckout" DISABLE TRIGGER chapa_flow_guard');
  try{expect(await report()).toMatchObject({ready:false,schema:{status:'incomplete',providerEvidenceGuard:false}})}finally{await sql.query('ALTER TABLE "ChapaCheckout" ENABLE TRIGGER chapa_flow_guard')}
  const original=(await sql.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='ChapaCheckout_verificationCompletionStatus_check'")).rows[0].definition;
  await sql.query('ALTER TABLE "ChapaCheckout" DROP CONSTRAINT "ChapaCheckout_verificationCompletionStatus_check"');
  try{expect(await report()).toMatchObject({ready:false,schema:{status:'incomplete',completionStatusConstraint:false}})}finally{await sql.query('ALTER TABLE "ChapaCheckout" ADD CONSTRAINT "ChapaCheckout_verificationCompletionStatus_check" '+original)}
 });
});
