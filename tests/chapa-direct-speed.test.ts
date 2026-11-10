import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {createBidDirectCheckout,createDirectCheckout} from '../src/modules/payments/chapa-direct';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {ChapaProviderError,type ChapaTransport,type ChapaDirectCreate} from '../src/modules/payments/chapa-provider';
import {PrivateApiError} from '../src/modules/auth/private-api';
import {creditDevelopmentPoints} from '../src/modules/wallet/ledger';
import {submitBid} from '../src/modules/auctions/bids';
import {TEST_TOKEN} from './helpers';

const database=process.env.CHAPA_SPEED_TEST_DATABASE_URL;
describe.skipIf(!database)('single-command direct bid preparation on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const url=new URL(database!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-chapa-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'speed-test',PHONE_CONTACT_KEYS:JSON.stringify({'speed-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});await db.referralPolicy.upsert({where:{id:'default'},create:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-speed-owner'},update:{}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 async function fixture(){
  const user=(await verifiedReferralUser(db)).id,auction=await realReferralAuction(db,10),command={key:randomUUID(),purpose:'BID' as const,auctionSlug:auction.slug!,numbers:['2','3','4'],feeVersion:1,approvedTotal:'30.00',paymentMethod:'telebirr',phone:'0911652904'};
  const reference='CH'+randomUUID().replaceAll('-','');let created:ChapaDirectCreate|undefined,status='SUCCESS';
  const direct=vi.fn(async(value:ChapaDirectCreate)=>{created=value;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'request-'+reference}}});
  const transport:ChapaTransport={create:vi.fn(),direct,validate:vi.fn(),lookup:vi.fn(async()=>({status:'success',data:{merchant_reference:created!.merchantReference,chapa_reference:reference,amount:Number(created!.amountCents),currency:'ETB',mode:'test',status,payment_method:'telebirr',customer:{phone_number:'251911652904'}}})),methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true}}}}}]}))};
  return {user,auction,command,direct,transport,reference,start:()=>createBidDirectCheckout(db,user,command,undefined,transport),setStatus:(value:string)=>{status=value}};
 }
 it('persists one immutable leased intent before HTTP, releases financial locks, and reauthorizes once',async()=>{
  const f=await fixture(),authorize=vi.fn(async()=>{});
  f.direct.mockImplementationOnce(async(value)=>{const intent=await db.chapaCheckout.findUniqueOrThrow({where:{merchantReference:value.merchantReference}});expect(intent).toMatchObject({status:'SUBMITTING',attempts:1});expect(intent.leaseUntil).not.toBeNull();expect(await db.bidBatchOrder.count({where:{id:intent.batchId!,userId:f.user}})).toBe(1);const [lock]=await db.$queryRaw<{held:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`wallet:${f.user}`},0)) AS held`;expect(lock.held).toBe(true);return {status:'success',data:{auth_type:'USSD',chapa_reference:f.reference,payment_status:'PENDING',request_id:'request-'+f.reference}}});
  const result=await createBidDirectCheckout(db,f.user,f.command,authorize,f.transport);expect(result.kind).toBe('payment');if(result.kind==='payment')expect(result.order).toMatchObject({status:'AUTH_NEEDED',amount:'30.00',authorizationReference:f.reference,batchNumbers:['2.00','3.00','4.00']});expect(authorize).toHaveBeenCalledOnce();expect(f.direct).toHaveBeenCalledOnce();expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
 });
 it('returns a changed authoritative fee total without charging, then accepts the same quote only on a later explicit command',async()=>{
  const f=await fixture(),changed=await createBidDirectCheckout(db,f.user,{...f.command,approvedTotal:'20.00'},undefined,f.transport);expect(changed.kind).toBe('quote');if(changed.kind!=='quote')throw Error('Expected quote');expect(changed.quote.total).toBe('30.00');expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
  const order=await createDirectCheckout(db,f.user,{key:f.command.key,purpose:'BID',batchId:changed.quote.id,quoteHash:changed.quote.quoteHash,paymentMethod:f.command.paymentMethod,phone:f.command.phone},undefined,f.transport);expect(order.status).toBe('AUTH_NEEDED');expect(f.direct).toHaveBeenCalledOnce();expect((await f.start()).kind).toBe('payment');expect(f.direct).toHaveBeenCalledOnce();
 });
 it('serializes duplicate clicks and concurrent identical requests into one provider dispatch',async()=>{
  const f=await fixture();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
  f.direct.mockImplementationOnce(async()=>{enter();await gate;return {status:'success',data:{auth_type:'USSD',chapa_reference:f.reference,payment_status:'PENDING',request_id:'request-'+f.reference}}});
  const first=f.start();await entered;const replay=await f.start();expect(replay.kind).toBe('payment');if(replay.kind==='payment')expect(replay.order.status).toBe('SUBMITTING');release();const accepted=await first;expect(accepted.kind).toBe('payment');expect(f.direct).toHaveBeenCalledOnce();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(1);expect(await db.bidBatchOrder.count({where:{userId:f.user}})).toBe(1);
 });
 it('rejects changed immutable intent details under the original key and retains account ownership',async()=>{
  const f=await fixture(),order=await f.start();if(order.kind!=='payment')throw Error('Expected payment');
  for(const edit of [{phone:'0911111111'},{paymentMethod:'mpesa'},{numbers:['9']},{approvedTotal:'31.00'},{feeVersion:2},{couponId:randomUUID()}])await expect(createBidDirectCheckout(db,f.user,{...f.command,...edit},undefined,f.transport)).rejects.toMatchObject({code:'KEY_REUSED'});
  const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.order.id}}),batch=await db.bidBatchOrder.findUniqueOrThrow({where:{id:stored.batchId!}}),other=(await verifiedReferralUser(db)).id;
  await expect(createDirectCheckout(db,other,{key:f.command.key,purpose:'BID',batchId:batch.id,quoteHash:batch.quoteHash,paymentMethod:'telebirr',phone:f.command.phone},undefined,f.transport)).rejects.toMatchObject({status:404});expect(f.direct).toHaveBeenCalledOnce();
 });
 it('recovers a lost response using the canonical legacy command and original provider key',async()=>{
  const f=await fixture();f.direct.mockRejectedValueOnce(Error('response lost'));const pending=await f.start();if(pending.kind!=='payment')throw Error('Expected payment');expect(pending.order.status).toBe('PENDING');const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:pending.order.id}}),batch=await db.bidBatchOrder.findUniqueOrThrow({where:{id:stored.batchId!}});
  const resumed=await createDirectCheckout(db,f.user,{key:f.command.key,purpose:'BID',batchId:batch.id,quoteHash:batch.quoteHash,paymentMethod:'telebirr',phone:f.command.phone},undefined,f.transport);expect(resumed.id).toBe(stored.id);expect(f.direct).toHaveBeenCalledTimes(2);expect(f.direct.mock.calls[0][0]).toEqual(f.direct.mock.calls[1][0]);
 });
 it.each(['FAILED','CANCELLED','NEEDS_REVIEW'])('does not overwrite a concurrent %s verification when initialization finishes late',async status=>{
  const f=await fixture();f.direct.mockImplementationOnce(async(value)=>{await db.chapaCheckout.update({where:{merchantReference:value.merchantReference},data:{status,providerStatus:status==='NEEDS_REVIEW'?null:status,verificationState:status==='NEEDS_REVIEW'?'MISMATCH':'VERIFIED',leaseUntil:null}});return {status:'success',data:{auth_type:'USSD',chapa_reference:f.reference,payment_status:'PENDING',request_id:'request-'+f.reference}}});
  const result=await f.start();expect(result.kind).toBe('payment');if(result.kind==='payment')expect(result.order).toMatchObject({status,authorizationReference:null,verificationState:status==='NEEDS_REVIEW'?'MISMATCH':'VERIFIED'});expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
 });
 it('binds missing authorization details without reverting a concurrent verified pending result',async()=>{
  const f=await fixture();f.direct.mockImplementationOnce(async(value)=>{await db.chapaCheckout.update({where:{merchantReference:value.merchantReference},data:{status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',leaseUntil:null}});return {status:'success',data:{auth_type:'OTP',chapa_reference:f.reference,payment_status:'PENDING',request_id:'request-'+f.reference}}});const result=await f.start();if(result.kind!=='payment')throw Error('Expected payment');expect(result.order).toMatchObject({status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',authorizationReference:f.reference,authType:'OTP'});
 });
 it('retains verified failure when a concurrent initialization transport fails, then reconciles a later success once',async()=>{
  const f=await fixture();f.direct.mockImplementationOnce(async(value)=>{await db.chapaCheckout.update({where:{merchantReference:value.merchantReference},data:{status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',leaseUntil:null}});throw new ChapaProviderError(500,'PROCESSING_FAILED')});const first=await f.start();if(first.kind!=='payment')throw Error('Expected payment');expect(first.order.status).toBe('CANCELLED');
  const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:first.order.id}});f.transport.lookup=vi.fn(async()=>({status:'success',data:{merchant_reference:stored.merchantReference,chapa_reference:f.reference,amount:3000,currency:'ETB',mode:'test',status:'SUCCESS',payment_method:'telebirr',customer:{phone_number:'251911652904'}}}));
  await db.chapaCheckout.update({where:{id:first.order.id},data:{nextCheckAt:new Date(0),leaseUntil:null}});expect(await verifyChapaCheckout(db,first.order.id,f.user,undefined,f.transport,true)).toMatchObject({status:'BID_ACCEPTED'});await verifyChapaCheckout(db,first.order.id,f.user,undefined,f.transport,true);expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await db.bid.count({where:{userId:f.user}})).toBe(3);
 });
 it('rejects expired login, invalid phone, disabled method, changed terms and unavailable coupons before dispatch',async()=>{
  const f=await fixture();await expect(createBidDirectCheckout(db,f.user,f.command,async()=>{throw new PrivateApiError(401,'Sign in again.')},f.transport)).rejects.toMatchObject({status:401});
  await expect(createBidDirectCheckout(db,f.user,{...f.command,paymentMethod:'mpesa'},undefined,f.transport)).rejects.toMatchObject({code:'INVALID_PHONE'});
  await expect(createBidDirectCheckout(db,f.user,{...f.command,paymentMethod:'cbebirr'},undefined,f.transport)).rejects.toMatchObject({code:'METHOD_UNAVAILABLE'});
  await expect(createBidDirectCheckout(db,f.user,{...f.command,feeVersion:2},undefined,f.transport)).rejects.toMatchObject({code:'TERMS_CHANGED'});
  const coupon=(await earnedReferralCoupon(db,f.user)).coupon;await creditDevelopmentPoints(db,f.user,'10',randomUUID());await submitBid(db,{userId:f.user,auctionSlug:f.auction.slug!,amount:'8',feeVersion:1,key:randomUUID(),couponId:coupon.id});await expect(createBidDirectCheckout(db,f.user,{...f.command,couponId:coupon.id},undefined,f.transport)).rejects.toMatchObject({code:'COUPON_UNAVAILABLE'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
 });
 it('binds capabilities to the credential used to fetch them even if configuration changes while preparing',async()=>{
  const f=await fixture(),key=process.env.CHAPA_PRIVATE_KEY!;try{await expect(createBidDirectCheckout(db,f.user,f.command,async()=>{process.env.CHAPA_PRIVATE_KEY='CHAPA_TEST_'+'b'.repeat(40)},f.transport)).rejects.toMatchObject({code:'CONFIGURATION_CHANGED'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0)}finally{process.env.CHAPA_PRIVATE_KEY=key}
 });
 it('does not use a warm optional method after its explicit enable gate is disabled during preparation',async()=>{
  const f=await fixture(),enabled=process.env.CHAPA_DIRECT_EBIRR_ENABLED;
  f.transport.methods=vi.fn(async()=>({status:'success',data:[{name:'eBirr',slug:'ebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true}}}}}]}));
  try{process.env.CHAPA_DIRECT_EBIRR_ENABLED='true';await expect(createBidDirectCheckout(db,f.user,{...f.command,paymentMethod:'ebirr'},async()=>{process.env.CHAPA_DIRECT_EBIRR_ENABLED='false'},f.transport)).rejects.toMatchObject({code:'METHOD_UNAVAILABLE'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0)}finally{if(enabled===undefined)delete process.env.CHAPA_DIRECT_EBIRR_ENABLED;else process.env.CHAPA_DIRECT_EBIRR_ENABLED=enabled}
 });
});
