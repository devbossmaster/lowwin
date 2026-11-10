import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon,referredRegistration} from './referral-fixtures';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {quoteBidBatch,payBidBatchWallet} from '../src/modules/auctions/batch';
import {createDirectCheckout,authorizeDirectCheckout,reconcileDirectCheckouts} from '../src/modules/payments/chapa-direct';
import {getChapaCheckout,verifyChapaCheckout} from '../src/modules/payments/chapa';
import {processChapaEvent} from '../src/modules/payments/chapa-events';
import {submitBid} from '../src/modules/auctions/bids';
import {reconcileChapaReceipts} from '../src/modules/payments/chapa-reconcile';
import {ChapaProviderError,type ChapaDirectCreate,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {TEST_TOKEN} from './helpers';

const database=process.env.CHAPA_DIRECT_TEST_DATABASE_URL??process.env.CHAPA_TEST_DATABASE_URL;
describe.skipIf(!database)('direct charges and atomic batches on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const url=new URL(database!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-chapa-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'direct-test',PHONE_CONTACT_KEYS:JSON.stringify({'direct-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-direct-owner'}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(id:string)=>(await db.ledgerAccount.findUnique({where:{name:`user:${id}:available`}}))?.balance.toString()??'0';
 const due=async(id:string)=>{await db.chapaCheckout.update({where:{id},data:{leaseUntil:null,nextCheckAt:new Date(0)}})};
 async function fixture(options:{numbers?:string[];fee?:number;initialBalance?:string;coupon?:boolean;endDelayMs?:number}={}){
  const user=(await verifiedReferralUser(db)).id,auction=await realReferralAuction(db,options.fee??50,options.endDelayMs),coupon=options.coupon?(await earnedReferralCoupon(db,user)).coupon:null;
  if(options.initialBalance)await creditDevelopmentPoints(db,user,options.initialBalance,randomUUID());
  const quote=await quoteBidBatch(db,user,{key:randomUUID(),auctionSlug:auction.slug,numbers:options.numbers??['2','3','4'],feeVersion:1,...(coupon?{couponId:coupon.id}:{})});
  let created:ChapaDirectCreate|null=null,status='SUCCESS',fail=false,auth='USSD',alter:(d:Record<string,unknown>)=>Record<string,unknown>=d=>d;const ref='CH'+randomUUID().replaceAll('-','');
  const direct=vi.fn(async(value:ChapaDirectCreate)=>{created=value;if(fail){fail=false;throw Error('response lost')}return {status:'success',data:{auth_type:auth,chapa_reference:ref,payment_status:'PENDING',request_id:'req-'+ref,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()}}});
  const validate=vi.fn(async()=>({status:'success',data:{status:'SUCCESS'}})),lookup=vi.fn(async()=>({status:'success',data:alter({merchant_reference:created!.merchantReference,chapa_reference:ref,amount:Number(created!.amountCents),currency:'ETB',mode:'test',status,payment_method:'telebirr',customer:{phone_number:'251911652904'}})}));
  const transport:ChapaTransport={create:vi.fn(),lookup,direct,validate,methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true}}}}}]}))};
  const command={key:randomUUID(),purpose:'BID',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},start=()=>createDirectCheckout(db,user,command,undefined,transport),verify=async(id:string)=>{await due(id);return verifyChapaCheckout(db,id,user,undefined,transport)};
  return {user,auction,coupon,quote,command,start,verify,transport,direct,validate,lookup,setStatus:(value:string)=>{status=value},fail:()=>{fail=true},auth:(value:string)=>{auth=value},alter:(fn:typeof alter)=>{alter=fn}};
 }
 it('prices fees rather than numbers and accepts the entire wallet order exactly once',async()=>{
  const f=await fixture({numbers:['2','9.99','50'],initialBalance:'150'});expect(f.quote.total).toBe('150.00');const paid=await payBidBatchWallet(db,f.user,f.quote.id,{quoteHash:f.quote.quoteHash});expect(paid.receipts).toHaveLength(3);expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(3);await payBidBatchWallet(db,f.user,f.quote.id,{quoteHash:f.quote.quoteHash});expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(3);
 });
 it('accepts the full100-entry order through bounded bulk writes with exact receipts and notifications',async()=>{const f=await fixture({fee:1,numbers:Array.from({length:100},(_,i)=>String(i+2)),initialBalance:'100'});const paid=await payBidBatchWallet(db,f.user,f.quote.id,{quoteHash:f.quote.quoteHash});expect(paid.receipts).toHaveLength(100);expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(100);expect(await balance(f.user)).toBe('0');expect(await db.outbox.count({where:{kind:'BID_ACCEPTED',payload:{path:['recipientUserId'],equals:f.user}}})).toBe(100);expect(await db.notificationInbox.count({where:{kind:'BID_ACCEPTED',userId:f.user}})).toBe(100);expect(Buffer.byteLength(JSON.stringify(paid))).toBeLessThan(60000);expect(paid.batch).not.toHaveProperty('receipt');expect(paid).not.toHaveProperty('receipt');expect(paid.receipts[0]).not.toHaveProperty('ownBids');expect(await reconcile(db)).toEqual([])});
 it('awards one referral coupon when the genuine first accepted action is a multi-entry batch',async()=>{const sponsor=(await verifiedReferralUser(db)).id,user=(await referredRegistration(db,sponsor)).id,auction=await realReferralAuction(db,10);await creditDevelopmentPoints(db,user,'30',randomUUID());const quote=await quoteBidBatch(db,user,{key:randomUUID(),auctionSlug:auction.slug,numbers:['2','3','4'],feeVersion:1}),paid=await payBidBatchWallet(db,user,quote.id,{quoteHash:quote.quoteHash});expect(await db.referralCoupon.count({where:{ownerUserId:sponsor,referredUserId:user}})).toBe(1);expect(await db.referralSignup.findUnique({where:{referredUserId:user}})).toMatchObject({firstBidId:paid.receipts[0].bid.id});expect(await db.bid.count({where:{userId:user}})).toBe(3)});
 it('rejects the whole wallet order on insufficient funds without partial bids or charges',async()=>{const f=await fixture({initialBalance:'99'});await expect(payBidBatchWallet(db,f.user,f.quote.id,{quoteHash:f.quote.quoteHash})).rejects.toMatchObject({code:'INSUFFICIENT_POINTS'});expect(await balance(f.user)).toBe('99');expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(0)});
 it('fulfills a zero-fee order atomically without a provider or an enabled wallet gate',async()=>{const f=await fixture({fee:0});process.env.WALLET_BIDS_ENABLED='false';try{expect(f.quote.totalCents).toBe('0');const result=await payBidBatchWallet(db,f.user,f.quote.id,{quoteHash:f.quote.quoteHash});expect(result.receipts).toHaveLength(3);expect(f.direct).not.toHaveBeenCalled();expect(await balance(f.user)).toBe('0')}finally{process.env.WALLET_BIDS_ENABLED='true'}});
 it('rejects a provider subminimum amount instead of silently increasing it',async()=>{const f=await fixture({numbers:['2'],fee:0.5});await expect(f.start()).rejects.toMatchObject({code:'METHOD_UNAVAILABLE'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0)});
 it.each([['mpesa','0911652904'],['mpesa','+251911652904'],['telebirr','0713339196'],['telebirr','+251713339196']])('rejects a new %s intent with an unsupported phone prefix before any provider request',async(paymentMethod,phone)=>{
  const f=await fixture();await expect(createDirectCheckout(db,f.user,{...f.command,paymentMethod,phone},undefined,f.transport)).rejects.toMatchObject({status:422,code:'INVALID_PHONE'});
  expect(f.transport.methods).not.toHaveBeenCalled();expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);expect(await balance(f.user)).toBe('0');
 });
 it('applies one coupon to only one line and consumes it once across the batch',async()=>{const f=await fixture({initialBalance:'145',coupon:true});expect(f.quote.lines.map(line=>line.discount)).toEqual(['5.00','0.00','0.00']);expect(f.quote.total).toBe('145.00');await payBidBatchWallet(db,f.user,f.quote.id,{quoteHash:f.quote.quoteHash});expect(await balance(f.user)).toBe('0');expect(await db.referralRedemption.count({where:{couponId:f.coupon!.id}})).toBe(1)});
 it('checks combined consecutive amounts regardless of draft ordering and accepted submissions',async()=>{const f=await fixture({numbers:['2']});await expect(quoteBidBatch(db,f.user,{key:randomUUID(),auctionSlug:f.auction.slug,numbers:['1.04','1.01','1.03','1.02'],feeVersion:1})).rejects.toMatchObject({code:'CONSECUTIVE_LIMIT'});await expect(quoteBidBatch(db,f.user,{key:randomUUID(),auctionSlug:f.auction.slug,numbers:['2','2.00'],feeVersion:1})).rejects.toMatchObject({code:'OWN_DUPLICATE'});await expect(quoteBidBatch(db,f.user,{key:randomUUID(),auctionSlug:f.auction.slug,numbers:['3'],feeVersion:99})).rejects.toMatchObject({code:'TERMS_CHANGED'})});
 it('uses one external charge for three entries and settles duplicate concurrent verification once',async()=>{
  const f=await fixture(),order=await f.start();expect(order.chargeType).toBe('DIRECT');expect(f.direct).toHaveBeenCalledOnce();expect(f.direct.mock.calls[0][0].amountCents).toBe('15000');expect(await balance(f.user)).toBe('0');await due(order.id);const result=await Promise.all([verifyChapaCheckout(db,order.id,f.user,undefined,f.transport),verifyChapaCheckout(db,order.id,f.user,undefined,f.transport)]);expect(result.some(row=>row.status==='BID_ACCEPTED')).toBe(true);expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(3);expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await balance(f.user)).toBe('0');expect(await reconcileChapaReceipts(db)).toEqual([]);
 });
 it('keeps all paid funds in the wallet when any batch entry cannot be accepted',async()=>{
  const f=await fixture({initialBalance:'50'}),order=await f.start();await submitBid(db,{userId:f.user,auctionSlug:f.auction.slug!,amount:'3',feeVersion:1,key:randomUUID()});const result=await f.verify(order.id);expect(result).toMatchObject({status:'NEEDS_REVIEW',fundsPreserved:true});expect(await balance(f.user)).toBe('150');expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(1);expect(await db.bidBatchOrder.findUnique({where:{id:f.quote.id}})).toMatchObject({status:'QUOTED'});
 });
 it('does not consume a coupon twice when an already initiated batch loses it to another accepted bid',async()=>{const f=await fixture({coupon:true,initialBalance:'50'}),order=await f.start();await submitBid(db,{userId:f.user,auctionSlug:f.auction.slug!,amount:'8',feeVersion:1,key:randomUUID(),couponId:f.coupon!.id});expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',fundsPreserved:true});expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(1);expect(await db.referralRedemption.count({where:{couponId:f.coupon!.id}})).toBe(1);expect(await balance(f.user)).toBe('150')});
 it('preserves an entire late successful batch as wallet funds without backdated entries',async()=>{const f=await fixture({endDelayMs:1500}),order=await f.start();await new Promise(resolve=>setTimeout(resolve,1600));expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'AUCTION_CLOSED',fundsPreserved:true});expect(await balance(f.user)).toBe('150');expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(0);expect(await f.verify(order.id)).toMatchObject({fundsPreserved:true});expect(await balance(f.user)).toBe('150')});
 it('rejects edits to the server quote and direct method, phone and authorization reference',async()=>{const f=await fixture(),order=await f.start();await expect(db.bidBatchOrder.update({where:{id:f.quote.id},data:{totalCents:1n}})).rejects.toThrow('immutable');await expect(db.bidBatchOrder.delete({where:{id:f.quote.id}})).rejects.toThrow('cannot be deleted');await expect(db.chapaCheckout.update({where:{id:order.id},data:{paymentMethod:'mpesa'}})).rejects.toThrow('immutable');await expect(db.chapaCheckout.update({where:{id:order.id},data:{authorizationReference:'CHother'}})).rejects.toThrow('immutable');await expect(db.chapaCheckout.update({where:{id:order.id},data:{payerPhoneCipher:'replacement'}})).rejects.toThrow('immutable')});
 it.each(['amount','method','reference'])('rejects verified %s evidence conflicting with the original intent',async field=>{const f=await fixture(),order=await f.start();f.alter(data=>({...data,...(field==='amount'?{amount:14999}:field==='method'?{payment_method:'mpesa'}:{chapa_reference:'CHother'})}));expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'EVIDENCE_MISMATCH'});expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(0)});
 it('recovers a lost initialization response using the original key, and isolates owner and payer binding',async()=>{
  const f=await fixture();f.fail();const order=await f.start();expect(order).toMatchObject({status:'PENDING',verificationState:'UNAVAILABLE',reason:'PROVIDER_CONFIRMATION_REQUIRED'});const retry=await f.start();expect(retry).toMatchObject({id:order.id,status:'AUTH_NEEDED',verificationState:'UNVERIFIED',reason:null,initializationIssue:null,authType:'USSD'});expect(retry.authorizationReference).toBeTruthy();expect(f.direct.mock.calls[0][0]).toEqual(f.direct.mock.calls[1][0]);await expect(getChapaCheckout(db,'other-account',order.id)).rejects.toMatchObject({status:404});f.alter(d=>({...d,customer:{phone_number:'251911111111'}}));expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'EVIDENCE_MISMATCH'});expect(await balance(f.user)).toBe('0');
 });
 it.each(['INVALID_FORMAT','INVALID_VALUE','MISSING_REQUIRED_FIELD'])('stops replaying a structured %s initialization rejection without claiming a paid failure',async code=>{
  const f=await fixture();f.direct.mockRejectedValueOnce(new ChapaProviderError(400,code));
  const rejected=await f.start();expect(rejected).toMatchObject({status:'NEEDS_REVIEW',reason:'INITIALIZATION_REJECTED',initializationIssue:'request',verificationState:'UNAVAILABLE',authorizationReference:null,providerStatus:null});
  expect(f.direct).toHaveBeenCalledOnce();expect((await f.start()).id).toBe(rejected.id);expect(f.direct).toHaveBeenCalledOnce();
  const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:rejected.id}});expect(stored).toMatchObject({initializationErrorCode:code,initializationHttpStatus:400,creditJournalId:null});
  expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
 });
 it.each([[409,'INVALID_STATE'],[429,'RATE_LIMITED'],[500,'PROCESSING_FAILED']] as const)('keeps HTTP%s %s uncertain and recovers only the original direct intent',async(http,code)=>{
  const f=await fixture();f.direct.mockRejectedValueOnce(new ChapaProviderError(http,code));
  const pending=await f.start();expect(pending).toMatchObject({status:'PENDING',reason:'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE',authorizationReference:null,providerStatus:null});
  const retried=await f.start();expect(retried).toMatchObject({id:pending.id,status:'AUTH_NEEDED',verificationState:'UNVERIFIED',reason:null,initializationIssue:null});expect(retried.authorizationReference).toBeTruthy();expect(f.direct).toHaveBeenCalledTimes(2);expect(f.direct.mock.calls[0][0]).toEqual(f.direct.mock.calls[1][0]);
  expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
 });
 it('does not credit operation success, verifies safe failed reasons and automatically resumes missing-webhook USSD',async()=>{
  const f=await fixture(),order=await f.start();f.setStatus('PENDING');expect(await f.verify(order.id)).toMatchObject({status:'PENDING'});expect(await balance(f.user)).toBe('0');f.setStatus('SUCCESS');await due(order.id);expect((await reconcileDirectCheckouts(db,20,f.transport)).checked).toBeGreaterThan(0);expect((await getChapaCheckout(db,f.user,order.id)).status).toBe('BID_ACCEPTED');expect(f.validate).toHaveBeenCalled();
 });
 it.each(['CANCELLED','FAILED_OR_CANCELLED'])('verifies a %s webhook without waiting for another USSD validation and never credits it',async status=>{
  const f=await fixture(),order=await f.start();f.setStatus(status);
  await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(Date.now()+300000)}});
  const event=await db.chapaWebhookEvent.create({data:{mode:'test',configurationFingerprint:'a'.repeat(64),bodyHash:randomUUID().replaceAll('-','').repeat(2),merchantReference:order.merchantReference,event:status==='CANCELLED'?'payment.cancelled':'payment.failed_or_cancelled',checkoutId:order.id,nextAttemptAt:new Date(0)}});
  expect(await processChapaEvent(db,event.id,f.transport)).toBe(true);
  expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledOnce();
  expect(await getChapaCheckout(db,f.user,order.id)).toMatchObject({status:status==='CANCELLED'?'CANCELLED':'FAILED',providerStatus:status==='CANCELLED'?'CANCELLED':'FAILED',verificationState:'VERIFIED'});
  expect((await db.chapaWebhookEvent.findUniqueOrThrow({where:{id:event.id}})).status).toBe('PROCESSED');
  expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(0);
 });
 it.each(['PENDING','AUTH_NEEDED'])('keeps an active direct %s prompt on the initial fifteen-second cadence while retaining USSD validation',async status=>{
  const f=await fixture(),order=await f.start();f.setStatus(status);
  await db.chapaCheckout.update({where:{id:order.id},data:{attempts:20}});
  const before=Date.now();expect(await f.verify(order.id)).toMatchObject({status,verificationState:'VERIFIED'});
  const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(stored.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before+15000);expect(stored.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now()+15000);
  expect(f.validate).toHaveBeenCalledOnce();expect(f.lookup).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');
 });
 it('retains growing recovery backoff after the direct authorization expires without claiming a failed payment',async()=>{
  const f=await fixture(),order=await f.start();f.setStatus('PENDING');
  await db.chapaCheckout.update({where:{id:order.id},data:{attempts:20,expiresAt:new Date(0)}});
  const before=Date.now();expect(await f.verify(order.id)).toMatchObject({status:'PENDING',verificationState:'VERIFIED'});
  const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(stored.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before+75000);expect(stored.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now()+75000);
  expect(f.validate).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');
 });
 it.each([[409,'INVALID_STATE',60000],[429,'RATE_LIMITED',60000],[500,'PROCESSING_FAILED',30000]] as const)('preserves HTTP%s %s recovery delay for an active direct prompt',async(http,code,delay)=>{
  const f=await fixture(),order=await f.start();f.lookup.mockRejectedValueOnce(new ChapaProviderError(http,code));
  const before=Date.now();expect(await f.verify(order.id)).toMatchObject({status:'AUTH_NEEDED',providerStatus:null,verificationState:'UNAVAILABLE'});
  const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(stored.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before+delay);expect(stored.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now()+delay);
  expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
 });
 it('reports a temporary lookup failure separately from an already verified outstanding authorization, then accepts late success once',async()=>{
  const f=await fixture(),order=await f.start();f.setStatus('AUTH_NEEDED');const waiting=await f.verify(order.id);expect(waiting).toMatchObject({status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED'});
  const saved=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});f.lookup.mockRejectedValueOnce(new ChapaProviderError(500,'PROCESSING_FAILED'));
  const interrupted=await f.verify(order.id);expect(interrupted).toMatchObject({status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',reason:saved.reason,authorizationReference:order.authorizationReference,verificationUnavailable:true});expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
  f.setStatus('SUCCESS');expect(await f.verify(order.id)).toMatchObject({status:'BID_ACCEPTED',verificationState:'VERIFIED'});await f.verify(order.id);expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await db.bid.count({where:{userId:f.user}})).toBe(3);
 });
 it.each(['CANCELLED','NEEDS_REVIEW','VERIFYING'])('does not overwrite concurrent %s evidence when an older verification request fails',async status=>{
  const f=await fixture(),order=await f.start(),providerStatus=status==='NEEDS_REVIEW'?null:status==='VERIFYING'?'SUCCESS':'CANCELLED',verificationState=status==='NEEDS_REVIEW'?'MISMATCH':'VERIFIED',reason=status==='NEEDS_REVIEW'?'EVIDENCE_MISMATCH':status==='VERIFYING'?'PROVIDER_EVENT_RECEIVED':'CHAPA_PAYMENT_CANCELLED';
  f.lookup.mockImplementationOnce(async()=>{await db.chapaCheckout.update({where:{id:order.id},data:{status,providerStatus,verificationState,reason}});throw new ChapaProviderError(500,'PROCESSING_FAILED')});
  expect(await f.verify(order.id)).toMatchObject({status,providerStatus,verificationState,reason,verificationUnavailable:true});expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);if(status==='VERIFYING')expect(await f.verify(order.id)).toMatchObject({status:'BID_ACCEPTED'});
 });
 it('recovers a deposit initialization and credits exactly once across duplicate successful webhook jobs',async()=>{
  const f=await fixture({numbers:['2']}),command={key:randomUUID(),purpose:'TOP_UP',amount:'35.00',paymentMethod:'telebirr',phone:'0911652904'};
  f.fail();const interrupted=await createDirectCheckout(db,f.user,command,undefined,f.transport);expect(interrupted).toMatchObject({status:'PENDING',verificationState:'UNAVAILABLE',authorizationReference:null});
  const resumed=await createDirectCheckout(db,f.user,command,undefined,f.transport);expect(resumed).toMatchObject({id:interrupted.id,purpose:'TOP_UP',amount:'35.00',status:'AUTH_NEEDED',verificationState:'UNVERIFIED',reason:null,initializationIssue:null});expect(f.direct.mock.calls[0][0]).toEqual(f.direct.mock.calls[1][0]);
  f.lookup.mockRejectedValueOnce(new ChapaProviderError(500,'PROCESSING_FAILED'));await due(resumed.id);expect(await verifyChapaCheckout(db,resumed.id,f.user,undefined,f.transport)).toMatchObject({status:'AUTH_NEEDED',verificationState:'UNAVAILABLE',authorizationReference:resumed.authorizationReference,verificationUnavailable:true});expect(await balance(f.user)).toBe('0');
  const events=await Promise.all([1,2].map(()=>db.chapaWebhookEvent.create({data:{mode:'test',configurationFingerprint:'a'.repeat(64),bodyHash:randomUUID().replaceAll('-','').repeat(2),merchantReference:resumed.merchantReference,event:'payment.success',checkoutId:resumed.id,nextAttemptAt:new Date(0)}})));
  for(const event of events){await due(resumed.id);expect(await processChapaEvent(db,event.id,f.transport)).toBe(true)}
  expect(await getChapaCheckout(db,f.user,resumed.id)).toMatchObject({status:'CREDITED',verificationState:'VERIFIED',providerStatus:'SUCCESS',amount:'35.00'});expect(await balance(f.user)).toBe('35');expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
 });
 it.each(['FAILED','CANCELLED','INCOMPLETE','BLOCKED'])('records an authenticated %s outcome without accepting bids and can reconcile a later success once',async status=>{const f=await fixture(),order=await f.start();f.setStatus(status);f.alter(data=>({...data,reason:status==='FAILED'?'INSUFFICIENT_BALANCE':status==='CANCELLED'?'PAYMENT_CANCELLED':undefined}));const failed=await f.verify(order.id);expect(failed.status).toBe(status);expect(await balance(f.user)).toBe('0');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);if(status==='FAILED')expect(failed.providerReasonCode).toBe('INSUFFICIENT_FUNDS');f.setStatus('SUCCESS');expect(await f.verify(order.id)).toMatchObject({status:'BID_ACCEPTED'});await f.verify(order.id);expect(await db.operation.count({where:{userId:f.user,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await db.bid.count({where:{userId:f.user,auctionId:f.auction.id}})).toBe(3);expect(await balance(f.user)).toBe('0')});
 it('requires OTP only on an owned OTP intent and never automatically replays it',async()=>{
  const f=await fixture();f.auth('OTP');const order=await f.start();f.setStatus('AUTH_NEEDED');await f.verify(order.id);expect(f.validate).not.toHaveBeenCalled();await expect(authorizeDirectCheckout(db,f.user,order.id,{},undefined,f.transport)).rejects.toMatchObject({code:'INVALID_AUTHORIZATION'});await expect(authorizeDirectCheckout(db,'other-account',order.id,{otp:'123456'},undefined,f.transport)).rejects.toMatchObject({status:404});f.setStatus('SUCCESS');await due(order.id);expect((await authorizeDirectCheckout(db,f.user,order.id,{otp:'123456'},undefined,f.transport)).status).toBe('BID_ACCEPTED');expect(f.validate).toHaveBeenCalledWith({reference:order.authorizationReference,paymentMethod:'telebirr',otp:'123456'});const stored=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});expect(JSON.stringify(stored.initialization)).not.toContain('123456');
 });
 it('keeps wallet and provider ledgers balanced after all outcomes',async()=>{expect(await reconcile(db)).toEqual([]);expect(await reconcileChapaReceipts(db)).toEqual([])});
});
