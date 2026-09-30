import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {createIntent,verifyIntent,processOneVerifyRequest,reconcilePayments,listOwnTopups} from '../src/modules/payments/service';
import {assess,type VerificationInput} from '../src/modules/payments/provider';
import {reconcile} from '../src/modules/wallet/ledger';
const url=process.env.PAYMENT_TEST_DATABASE_URL;
const requestId=()=>randomUUID();
describe.skipIf(!url)('Verify.et funding on disposable PostgreSQL',()=>{
 let db:PrismaClient,policy:Record<string,string>,account:Record<string,string>,user:string,other:string;
 const reference=()=>`DEMO${randomUUID().replaceAll('-','').slice(0,18).toUpperCase()}`;
 const body=(input:VerificationInput,fields:Record<string,unknown>={},id=requestId())=>({success:true,requestId:id,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:input.bank,status:'success',verified:true,amount:input.expectedCents?new Prisma.Decimal(input.expectedCents.toString()).div(100).toString():'30.27',currency:'ETB',receiverAccount:input.account,referenceNumber:input.reference,timestamp:new Date().toISOString(),...fields}]});
 const good=async(input:VerificationInput)=>assess(body(input),input);
 const newIntent=async(owner=user,channel='telebirr')=>createIntent(db,owner,{key:randomUUID(),channel,policyId:policy[channel]},true);
 beforeAll(async()=>{
  const parsed=new URL(url!);if(!['localhost','127.0.0.1'].includes(parsed.hostname)||!parsed.pathname.endsWith('_test'))throw Error('Disposable loopback only');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',PAYMENTS_TEST_ENABLED:'true',VERIFY_ET_API_KEY:'fixture-only-key',VERIFY_ET_TEST_ENDPOINT:'http://127.0.0.1:8030/api/verify',TELEGRAM_BOT_TOKEN:'123456789:fixture',RECEIPT_OCR:'tesseract'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient();const first=await db.user.create({data:{id:randomUUID(),name:'Payment fixture'}}),second=await db.user.create({data:{id:randomUUID(),name:'Second payment fixture'}});user=first.id;other=second.id;
  policy={};account={telebirr:'0911111111',cbe:'1000303997441'};
  for(const channel of ['telebirr','cbe']){const row=await db.paymentPolicy.create({data:{channel,version:1,enabled:true,account:account[channel],accountName:'Fixture receiver',pointsNumerator:1n,centsDenominator:100n,minCents:100n,maxCents:100000n,terms:'Fixture only. Do not send funds.',reviewReference:'Fixture evidence',actorId:user}});policy[channel]=row.id}
 },60000);
 afterAll(async()=>{vi.unstubAllGlobals();await db?.$disconnect()});
 it('credits a provider-derived amount once with balanced journal and one alert',async()=>{
  const intent=await newIntent(),input={id:intent.id,key:randomUUID(),input:reference()};
  expect(intent.amountCents).toBeUndefined();const credited=await verifyIntent(db,user,input,good);expect(credited).toMatchObject({status:'CREDITED',amountCents:'3027',points:'30.27'});
  expect((await verifyIntent(db,user,input,good)).status).toBe('CREDITED');expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(1);expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);expect(await reconcile(db)).toEqual([]);expect(await reconcilePayments(db)).toEqual([]);
 });
 it('resumes queued verification without another customer submission',async()=>{
  const intent=await newIntent(),ref=reference(),id=requestId(),input={id:intent.id,key:randomUUID(),input:ref};
  const queued=await verifyIntent(db,user,input,async()=>({code:'PROCESSING',matched:false,processing:true,requestId:id,evidence:{}}));expect(queued.status).toBe('VERIFYING');
  const row=await db.verifyRequest.findFirstOrThrow({where:{intentId:intent.id}});await db.verifyRequest.update({where:{id:row.id},data:{nextCheckAt:new Date(0)}});
  const fetcher=vi.fn(async(path:string,options:RequestInit)=>String(options.method)==='POST'?Response.json(body({bank:'telebirr',reference:ref,account:account.telebirr,expectedCents:null,minCents:100n,maxCents:100000n,createdAt:new Date(intent.createdAt),expiresAt:new Date(intent.expiresAt!),attemptKey:input.key},{},id)):Response.json({success:true,data:{requestId:id,processingStatus:'completed',status:'success',verified:true}}));vi.stubGlobal('fetch',fetcher);
  try{expect(await processOneVerifyRequest(db)).toBe(true);expect((await db.topUpIntent.findUniqueOrThrow({where:{id:intent.id}})).status).toBe('CREDITED');expect(fetcher).toHaveBeenCalledTimes(2)}finally{vi.unstubAllGlobals()}
 });
 it('keeps unsupported masked receivers in review, then credits a provider-approved match',async()=>{
  const intent=await newIntent(),ref=reference();const first=await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},async input=>assess(body(input,{receiverAccount:'2519****1111'}),input));
  expect(first).toMatchObject({status:'NEEDS_REVIEW',reason:'RECEIVER_UNPROVEN'});expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  await db.topUpIntent.update({where:{id:intent.id},data:{nextAttemptAt:new Date(0)}});
  expect((await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},async input=>assess(body(input,{receiverAccount:'2519****1111',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:false,matchedSettlementAccount:input.account,bank:'telebirr'}}),input))).status).toBe('CREDITED');expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);
 });
 it('keeps missing currency in review, then resolves that case on one proven ETB recheck',async()=>{
  const intent=await newIntent(),ref=reference();
  const first=await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},async input=>assess(body(input,{currency:null}),input));
  expect(first).toMatchObject({status:'NEEDS_REVIEW',reason:'CURRENCY_UNPROVEN'});
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  const firstAttempt=await db.paymentAttempt.findFirstOrThrow({where:{intentId:intent.id}});
  expect(firstAttempt.evidence).toMatchObject({invalidFields:[{field:'data.0.currency',received:'null'}]});
  await db.topUpIntent.update({where:{id:intent.id},data:{caseState:'INVESTIGATING',assignedTo:user,nextAttemptAt:new Date(0)}});
  const rechecked=await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},good);
  expect(rechecked).toMatchObject({status:'CREDITED',reason:'VERIFIED',caseState:'RESOLVED',amountCents:'3027'});
  const saved=await db.topUpIntent.findUniqueOrThrow({where:{id:intent.id}});
  expect(saved).toMatchObject({status:'CREDITED',caseState:'RESOLVED',assignedTo:null});
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(1);
  expect(await db.operation.count({where:{scope:'TOPUP_CREDIT',key:intent.id}})).toBe(1);
  expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);
  expect(await db.verifyRequest.count({where:{intentId:intent.id,state:'DONE'}})).toBe(2);
  expect((await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},good)).status).toBe('CREDITED');
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(1);
  expect(await reconcilePayments(db)).toEqual([]);
 });
 it('coalesces concurrent verification retries into one provider call and one credit',async()=>{
  const intent=await newIntent(),ref=reference();let calls=0;
  const transport=async(input:VerificationInput)=>{calls++;await new Promise(resolve=>setTimeout(resolve,50));return good(input)};
  const results=await Promise.all([verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},transport),verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},transport)]);
  expect(results.every(result=>['VERIFYING','CREDITED'].includes(result.status))).toBe(true);
  expect(calls).toBe(1);
  expect((await db.topUpIntent.findUniqueOrThrow({where:{id:intent.id}})).status).toBe('CREDITED');
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(1);
  expect(await db.operation.count({where:{scope:'TOPUP_CREDIT',key:intent.id}})).toBe(1);
  expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);
  expect(await reconcilePayments(db)).toEqual([]);
 });
 it('blocks another user and an alternate CBE alias from a second credit',async()=>{
  const first=await newIntent(user,'cbe'),receipt='fHCxyExampleRcpt1',ft=reference().replace(/^DEMO/,'FT');
  const result=await verifyIntent(db,user,{id:first.id,key:randomUUID(),input:receipt},async input=>assess(body(input,{referenceNumber:ft,receiptNumber:receipt}),input));expect(result.status).toBe('CREDITED');
  const second=await newIntent(other,'cbe');const duplicate=await verifyIntent(db,other,{id:second.id,key:randomUUID(),input:ft},async input=>assess(body(input,{referenceNumber:ft,receiptNumber:receipt}),input));expect(duplicate.status).toBe('DUPLICATE_CONFLICT');expect(await db.paymentClaim.count({where:{channel:'cbe',reference:{in:[ft,receipt]}}})).toBe(1);expect(await reconcilePayments(db)).toEqual([]);
 });
 it('shows immutable Check.et history and rechecks eligible unresolved legacy deposits',async()=>{
  const ref=reference(),legacy=await db.topUpIntent.create({data:{userId:user,key:randomUUID(),provider:'CHECK_ET',channel:'telebirr',status:'NEEDS_REVIEW',reference:ref,points:new Prisma.Decimal('10'),expectedCents:1000n,policyVersion:policy.telebirr,receivingAccount:account.telebirr,expiresAt:new Date(Date.now()+1800000)}});
  expect((await listOwnTopups(db,user)).items.some(item=>item.id===legacy.id)).toBe(true);
  expect((await verifyIntent(db,user,{id:legacy.id,key:randomUUID(),input:ref},good)).status).toBe('CREDITED');expect(await reconcilePayments(db)).toEqual([]);
 });
});
