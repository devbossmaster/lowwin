import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {etbToCents} from '../src/lib/money';
import {chapaAmountDiagnostic} from '../src/modules/payments/chapa-amount-diagnostic';
import {createChapaTransport,parseChapaEvidence,type ChapaDirectCreate,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {createDirectCheckout} from '../src/modules/payments/chapa-direct';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {verifiedReferralUser} from './referral-fixtures';
import {TEST_TOKEN} from './helpers';

const env={APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local_fixture@127.0.0.1:5432/chapa_fee_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test'};
const data=(amount=3500)=>({status:'success',data:{amount,service_fee:88,currency:'ETB',status:'SUCCESS',merchant_reference:'LW-fee-fixture',chapa_reference:'CH-fee-fixture',mode:'test',payment_method:'telebirr',customer:{phone_number:'251911000000'}}});
afterEach(()=>vi.unstubAllEnvs());
describe('35 ETB principal and independently reported provider fees',()=>{
 it('sends exactly3500integercents without fee gross-up or PIN fields and preserves the original key',async()=>{
  const fetcher=vi.fn(async()=>Response.json({status:'success',data:{}})),transport=createChapaTransport({env,fetcher});
  const request={amountCents:String(etbToCents('35.00')),merchantReference:'LW-fee-fixture',idempotencyKey:'local-fee-original-operation-123',paymentMethod:'telebirr',phone:'251911000000'};
  await transport.direct!(request);await transport.direct!(request);
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
  expect(calls[0][0]).toBe('https://api.chapa.global/v2/payments/direct');
  expect(JSON.parse(String(calls[0][1].body))).toEqual({amount:3500,currency:'ETB',merchant_reference:request.merchantReference,payment_method:'telebirr',customer:{phone_number:request.phone}});
  expect(calls[1][1].body).toBe(calls[0][1].body);expect((calls[1][1].headers as Record<string,string>)['Idempotency-Key']).toBe(request.idempotencyKey);
 });
 it('keeps principal and fee separate and labels their sum as arithmetic rather than an established payer charge',()=>{
  const proof=parseChapaEvidence(data())!,report=chapaAmountDiagnostic({amountCents:3500n,currency:'ETB',serviceFeeCents:null,initialization:{amountCents:'3500',phone:'private',token:'private'}},proof);
  expect(report).toMatchObject({storedPrincipal:{cents:'3500',etb:'35.00'},initializationPrincipal:{cents:'3500',matchesStored:true},provider:{principal:{cents:'3500',etb:'35.00'},serviceFee:{cents:'88',etb:'0.88'},principalPlusReportedServiceFee:{cents:'3588',etb:'35.88'},feePayer:'not_exposed_by_verification'}});
  expect(JSON.stringify(report)).not.toMatch(/251911000000|private|token/);
  expect(chapaAmountDiagnostic({amountCents:3500n,currency:'ETB',serviceFeeCents:null,initialization:{}},null)).toMatchObject({initializationPrincipal:{cents:null,matchesStored:null},provider:null});
 });
});

const database=process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('fee-inclusive signals on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(database!);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{...env,DATABASE_URL:database,DIRECT_URL:database,TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowwin_fee_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-fee-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'fee-test',PHONE_CONTACT_KEYS:JSON.stringify({'fee-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'false',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 async function fixture(amount=3500){
  const user=(await verifiedReferralUser(db,'Fee evidence fixture')).id,reference='CH'+randomUUID().replaceAll('-','');let created:ChapaDirectCreate|null=null;
  const direct=vi.fn(async(value:ChapaDirectCreate)=>{created=value;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,request_id:'request-'+reference,payment_status:'PENDING',expires_at:new Date(Date.now()+300000).toISOString()}}});
  const lookup=vi.fn(async()=>({...data(amount),data:{...data(amount).data,chapa_reference:reference,merchant_reference:created!.merchantReference}}));
  const transport:ChapaTransport={create:vi.fn(),direct,lookup,validate:vi.fn(),methods:vi.fn(async()=>({status:'success',data:[{name:'telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:100000,countries:{ET:{is_enabled:true,min_amount:100,max_amount:100000}}}}}]}))};
  const order=await createDirectCheckout(db,user,{key:randomUUID(),purpose:'TOP_UP',amount:'35.00',paymentMethod:'telebirr',phone:'0911000000'},undefined,transport);
  await db.chapaCheckout.update({where:{id:order.id},data:{leaseUntil:null,nextCheckAt:new Date(0)}});
  return {user,order,transport,direct};
 }
 it('credits only35ETB when verification reports3500principal plus88fee and duplicate verification adds nothing',async()=>{
  const f=await fixture();expect(f.direct.mock.calls[0][0].amountCents).toBe('3500');
  const first=await verifyChapaCheckout(db,f.order.id,f.user,undefined,f.transport),second=await verifyChapaCheckout(db,f.order.id,f.user,undefined,f.transport);
  expect(first.status).toBe('CREDITED');expect(second.status).toBe('CREDITED');expect(first.amount).toBe('35.00');
  expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user}:available`}})).balance.toString()).toBe('35');
  expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(1);
  expect(await db.chapaCheckout.findUnique({where:{id:f.order.id},select:{amountCents:true,serviceFeeCents:true}})).toEqual({amountCents:3500n,serviceFeeCents:88n});
 });
 it('rejects3588verificationprincipal for a3500intent instead of subtracting an inferred fee or crediting extra',async()=>{
  const f=await fixture(3588),result=await verifyChapaCheckout(db,f.order.id,f.user,undefined,f.transport);
  expect(result).toMatchObject({status:'NEEDS_REVIEW',reason:'EVIDENCE_MISMATCH',verificationState:'MISMATCH'});
  expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(0);
  expect((await db.ledgerAccount.findUnique({where:{name:`user:${f.user}:available`}}))?.balance.toString()??'0').toBe('0');
 });
});
