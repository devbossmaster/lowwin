import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {createIntent,verifyIntent,processOneVerifyRequest,reconcilePayments,listOwnTopups} from '../src/modules/payments/service';
import {assess,type VerificationInput} from '../src/modules/payments/provider';
import {reconcile} from '../src/modules/wallet/ledger';
import {depositAttentionWhere} from '../src/modules/payments/review-filter';
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
  policy={};account={telebirr:'0911111111',mpesa:'0711111111',cbe:'1000303997441'};
  for(const channel of ['telebirr','mpesa','cbe']){const row=await db.paymentPolicy.create({data:{channel,version:1,enabled:true,account:account[channel],accountName:'Fixture receiver',pointsNumerator:1n,centsDenominator:100n,minCents:100n,maxCents:100000n,terms:'Fixture only. Do not send funds.',reviewReference:'Fixture evidence',actorId:user}});policy[channel]=row.id}
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
  try{expect(await processOneVerifyRequest(db)).toBe(true);expect((await db.topUpIntent.findUniqueOrThrow({where:{id:intent.id}})).status).toBe('CREDITED');expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].headers).toMatchObject({'Idempotency-Key':input.key});expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toMatchObject({transactionNumber:ref,settlementAccount:account.telebirr})}finally{vi.unstubAllGlobals()}
 });
 it('keeps unsupported masked receivers in review, then credits a provider-approved match',async()=>{
  const intent=await newIntent(),ref=reference();const first=await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},async input=>assess(body(input,{receiverAccount:'2519****1111'}),input));
  expect(first).toMatchObject({status:'NEEDS_REVIEW',reason:'RECEIVER_UNPROVEN'});expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  await db.topUpIntent.update({where:{id:intent.id},data:{nextAttemptAt:new Date(0)}});
  expect((await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},async input=>assess(body(input,{receiverAccount:'2519****1111',settlementAccountMatch:{matched:true,matchType:'masked_pattern',ambiguous:false,matchedSettlementAccount:input.account,bank:'telebirr'}}),input))).status).toBe('CREDITED');expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);
 });
 it('credits omitted currency once under the ETB policy and retains that audit evidence',async()=>{
  const intent=await newIntent(),ref=reference();
  const transport=vi.fn(async(input:VerificationInput)=>assess(body(input,{currency:undefined}),input));
  const first=await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},transport);
  expect(first).toMatchObject({status:'CREDITED',reason:'VERIFIED',caseState:'RESOLVED',amountCents:'3027'});
  const attempt=await db.paymentAttempt.findFirstOrThrow({where:{intentId:intent.id}});
  expect(attempt.evidence).toMatchObject({currency:'ETB',currencySource:'channel_policy'});
  expect((await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},transport)).status).toBe('CREDITED');
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(1);
  expect(await db.operation.count({where:{scope:'TOPUP_CREDIT',key:intent.id}})).toBe(1);
  expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);
  expect(await reconcilePayments(db)).toEqual([]);
 });
 it('keeps a missing receiver in review, then atomically resolves the case on one valid recheck',async()=>{
  const intent=await newIntent(),ref=reference();
  const first=await verifyIntent(db,user,{id:intent.id,key:randomUUID(),input:ref},async input=>assess(body(input,{receiverAccount:undefined}),input));
  expect(first).toMatchObject({status:'NEEDS_REVIEW',reason:'RECEIVER_UNPROVEN'});
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  const firstAttempt=await db.paymentAttempt.findFirstOrThrow({where:{intentId:intent.id}});
  expect(firstAttempt.code).toBe('RECEIVER_UNPROVEN');
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
  const second=await newIntent(other,'cbe');const duplicate=await verifyIntent(db,other,{id:second.id,key:randomUUID(),input:ft},async input=>assess(body(input,{referenceNumber:ft,receiptNumber:receipt}),input));expect(duplicate.status).toBe('REJECTED');expect(await db.paymentClaim.count({where:{channel:'cbe',reference:{in:[ft,receipt]}}})).toBe(1);expect(await reconcilePayments(db)).toEqual([]);
 });
 it('shows immutable Check.et history and rechecks eligible unresolved legacy deposits',async()=>{
  const ref=reference(),legacy=await db.topUpIntent.create({data:{userId:user,key:randomUUID(),provider:'CHECK_ET',channel:'telebirr',status:'NEEDS_REVIEW',reference:ref,points:new Prisma.Decimal('10'),expectedCents:1000n,policyVersion:policy.telebirr,receivingAccount:account.telebirr,expiresAt:new Date(Date.now()+1800000)}});
  expect((await listOwnTopups(db,user)).items.some(item=>item.id===legacy.id)).toBe(true);
  expect((await verifyIntent(db,user,{id:legacy.id,key:randomUUID(),input:ref},good)).status).toBe('CREDITED');expect(await reconcilePayments(db)).toEqual([]);
 });
 it('finishes a failed status poll without posting another paid verification',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Failed poll fixture'}})).id;
  const intent=await newIntent(owner),id=requestId(),key=randomUUID();
  await verifyIntent(db,owner,{id:intent.id,key,input:reference()},async()=>({code:'PROCESSING',matched:false,processing:true,requestId:id,evidence:{}}));
  const row=await db.verifyRequest.findFirstOrThrow({where:{intentId:intent.id}});
  await db.verifyRequest.update({where:{id:row.id},data:{nextCheckAt:new Date(0)}});
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,data:{requestId:id,processingStatus:'failed',status:'failed',verified:false,error:{code:'parse_error',retryable:false}}}));
  vi.stubGlobal('fetch',fetcher);
  try{
   expect(await processOneVerifyRequest(db)).toBe(true);
   expect(fetcher).toHaveBeenCalledTimes(1);
   expect(fetcher.mock.calls[0][1]?.method??'GET').toBe('GET');
   expect(await db.verifyRequest.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({state:'DONE',code:'INCOMPLETE_EVIDENCE'});
   expect(await db.topUpIntent.findUniqueOrThrow({where:{id:intent.id}})).toMatchObject({status:'NEEDS_REVIEW',reasonCode:'INCOMPLETE_EVIDENCE'});
   expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  }finally{vi.unstubAllGlobals()}
 });
 it('honors a status-poll cooldown without posting or crediting',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Rate-limited poll fixture'}})).id;
  const intent=await newIntent(owner),id=requestId(),key=randomUUID();
  await verifyIntent(db,owner,{id:intent.id,key,input:reference()},async()=>({code:'PROCESSING',matched:false,processing:true,requestId:id,evidence:{}}));
  const row=await db.verifyRequest.findFirstOrThrow({where:{intentId:intent.id}});
  await db.verifyRequest.update({where:{id:row.id},data:{nextCheckAt:new Date(0)}});
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:false,requestId:id,error:{code:'upstream_rate_limited',retryable:true}},{status:429,headers:{'Retry-After':'180'}}));
  vi.stubGlobal('fetch',fetcher);
  const started=Date.now();
  try{
   expect(await processOneVerifyRequest(db)).toBe(true);
   expect(fetcher).toHaveBeenCalledTimes(1);
   expect(fetcher.mock.calls[0][1]?.method??'GET').toBe('GET');
   const saved=await db.verifyRequest.findUniqueOrThrow({where:{id:row.id}});
   expect(saved).toMatchObject({state:'PROCESSING',key,requestId:id,code:'PROVIDER_RATE_LIMIT'});
   expect(saved.nextCheckAt.getTime()).toBeGreaterThanOrEqual(started+179000);
   expect(await db.topUpIntent.findUniqueOrThrow({where:{id:intent.id}})).toMatchObject({status:'VERIFYING',reasonCode:'PROVIDER_RATE_LIMIT'});
   expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  }finally{vi.unstubAllGlobals()}
 });
 it('applies local one-time credit policy to provider repeat confirmations',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Repeated confirmation fixture'}})).id;
  const claimant=(await db.user.create({data:{id:randomUUID(),name:'Duplicate confirmation fixture'}})).id;
  const intent=await newIntent(owner,'cbe'),receipt=`RepeatedRcpt${randomUUID().replaceAll('-','').slice(0,16)}`,ft=reference().replace(/^DEMO/,'FT');
  const transport=vi.fn(async(input:VerificationInput)=>assess(body(input,{referenceNumber:ft,receiptNumber:receipt,confirmationHistory:{confirmedBefore:true}}),input));
  expect(await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:receipt},transport)).toMatchObject({status:'CREDITED',caseState:'RESOLVED'});
  expect((await db.paymentAttempt.findFirstOrThrow({where:{intentId:intent.id}})).evidence).toMatchObject({confirmedBefore:true});
  expect((await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:receipt},transport)).status).toBe('CREDITED');
  expect(transport).toHaveBeenCalledTimes(1);
  const duplicate=await newIntent(claimant,'cbe');
  expect((await verifyIntent(db,claimant,{id:duplicate.id,key:randomUUID(),input:ft},transport)).status).toBe('REJECTED');
  expect(await db.paymentClaim.count({where:{intentId:{in:[intent.id,duplicate.id]}}})).toBe(1);
  expect(await db.operation.count({where:{scope:'TOPUP_CREDIT',key:intent.id}})).toBe(1);
  expect(await db.outbox.count({where:{key:`deposit:${intent.id}:credited`}})).toBe(1);
  expect(await reconcilePayments(db)).toEqual([]);
 });
 it.each([
  ['NOT_FOUND',{}],['RECEIVER_MISMATCH',{receiverAccount:'0999999999'}],
  ['REFERENCE_MISMATCH',{referenceNumber:'OTHERREFERENCE123'}],['AMOUNT_MISMATCH',{amount:'1001.00'}],
  ['DATE_MISMATCH',{timestamp:'2000-01-01T00:00:00Z'}],
 ] as const)('resolves confirmed %s without credit, another provider call or a review case',async(code,fields)=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Invalid transfer fixture'}})).id,intent=await newIntent(owner),ref=reference();
  const transport=vi.fn(async(input:VerificationInput)=>assess(code==='NOT_FOUND'?{success:true,requestId:requestId(),verification:{processingStatus:'completed',status:'not_found',verified:false},data:[]}:body(input,fields),input));
  expect(await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:ref},transport)).toMatchObject({status:'REJECTED',reason:code,caseState:'RESOLVED',canRetry:false});
  expect(await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:ref},transport)).toMatchObject({status:'REJECTED',reason:code});
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);expect(await db.operation.count({where:{scope:'TOPUP_CREDIT',key:intent.id}})).toBe(0);
  expect(await db.topUpIntent.count({where:{AND:[{id:intent.id},depositAttentionWhere(new Date())]}})).toBe(0);
 });
 it('keeps missing date evidence reviewable rather than declaring the transfer invalid',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Date evidence fixture'}})).id,intent=await newIntent(owner);
  expect(await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:reference()},async input=>assess(body(input,{timestamp:undefined}),input))).toMatchObject({status:'NEEDS_REVIEW',reason:'DATE_UNPROVEN'});
  expect(await db.topUpIntent.count({where:{AND:[{id:intent.id},depositAttentionWhere(new Date())]}})).toBe(1);
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
 });
 it('rejects known CBE aliases at submission without creating more staff work',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Alias owner fixture'}})).id,claimant=(await db.user.create({data:{id:randomUUID(),name:'Alias submitter fixture'}})).id;
  const intent=await newIntent(owner,'cbe'),receipt='UniqueRcpt'+randomUUID().replaceAll('-','').slice(0,12),ft=reference().replace(/^DEMO/,'FT');
  await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:receipt},async input=>assess(body(input,{referenceNumber:ft,receiptNumber:receipt}),input));
  for(const input of [receipt,ft])await expect(createIntent(db,claimant,{key:randomUUID(),channel:'cbe',policyId:policy.cbe,input},true)).rejects.toThrow('already been used');
  expect(await db.topUpIntent.count({where:{userId:claimant}})).toBe(0);
  expect(await createIntent(db,owner,{key:randomUUID(),channel:'cbe',policyId:policy.cbe,input:ft},true)).toMatchObject({id:intent.id,status:'CREDITED',reused:true});
  expect(await reconcilePayments(db)).toEqual([]);
 });
 it('credits an M-Pesa transfer once with the same guarded ledger flow',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'M-Pesa fixture'}})).id,intent=await newIntent(owner,'mpesa');
  const input={id:intent.id,key:randomUUID(),input:reference()},transport=vi.fn(good);
  expect(await verifyIntent(db,owner,input,transport)).toMatchObject({status:'CREDITED',channel:'mpesa',amountCents:'3027'});
  expect((await verifyIntent(db,owner,input,transport)).status).toBe('CREDITED');expect(transport).toHaveBeenCalledTimes(1);
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(1);expect(await db.operation.count({where:{scope:'TOPUP_CREDIT',key:intent.id}})).toBe(1);
  expect(await reconcile(db)).toEqual([]);expect(await reconcilePayments(db)).toEqual([]);
 });
 it('keeps a provider outage queued for recovery without credit or a false not-found result',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Outage fixture'}})).id,intent=await newIntent(owner);
  expect(await verifyIntent(db,owner,{id:intent.id,key:randomUUID(),input:reference()},async()=>({matched:false,code:'PROVIDER_OUTAGE',evidence:{}}))).toMatchObject({status:'VERIFYING',reason:'PROVIDER_OUTAGE'});
  expect(await db.paymentClaim.count({where:{intentId:intent.id}})).toBe(0);
  expect(await db.verifyRequest.count({where:{intentId:intent.id,state:'SUBMITTING'}})).toBe(1);
 });

 it('keeps old ambiguous date failures visible for staff review',async()=>{
  const owner=(await db.user.create({data:{id:randomUUID(),name:'Legacy date fixture'}})).id;
  const t=await db.topUpIntent.create({data:{userId:owner,key:randomUUID(),provider:'CHECK_ET',channel:'telebirr',status:'NEEDS_REVIEW',reasonCode:'DATE_MISMATCH',points:10,expectedCents:1000n,policyVersion:policy.telebirr}});
  expect(await db.topUpIntent.count({where:{AND:[{id:t.id},depositAttentionWhere(new Date())]}})).toBe(1);
 });

});
