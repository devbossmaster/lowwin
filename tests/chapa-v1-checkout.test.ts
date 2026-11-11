import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {quoteBidBatch} from '../src/modules/auctions/batch';
import {submitBid} from '../src/modules/auctions/bids';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {createChapaCheckout,getChapaCheckout,recoverChapaCheckouts,verifyChapaCheckout} from '../src/modules/payments/chapa';
import {reconcileChapaReceipts} from '../src/modules/payments/chapa-reconcile';
import {ChapaProviderError,type ChapaCreate,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {TEST_TOKEN} from './helpers';
import {contactBotId,encryptPhone} from '../src/modules/auth/own-contact';

const base=process.env.CHAPA_TEST_DATABASE_URL;
describe.skipIf(!base)('Chapa v1 hosted checkout and atomic bid batches',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const source=new URL(base!);if(!['127.0.0.1','localhost'].includes(source.hostname)||!source.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  const adminUrl=new URL(source);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();const name='lowwin_v1_finance_'+randomUUID().slice(0,8)+'_test';await admin.query(`CREATE DATABASE "${name}"`);await admin.end();source.pathname='/'+name;
  Object.assign(process.env,{DATABASE_URL:source.href,DIRECT_URL:source.href,NODE_ENV:'test',APP_ENV:'local',CHAPA_V1_MODE:'test',CHAPA_V1_SCHEMA_READY:'true',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_WEBHOOK_SECRET:'local-v1-signature-secret-thirty-two-characters',CHAPA_V1_ENABLED:'true',CHAPA_V1_RECOVERY_ENABLED:'true',CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'false',CHAPA_LEGACY_SWEEP_ENABLED:'false',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-chapa-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'v1-test',PHONE_CONTACT_KEYS:JSON.stringify({'v1-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:source.href});await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-v1-owner'}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(userId:string)=>(await db.ledgerAccount.findUnique({where:{name:`user:${userId}:available`}}))?.balance.toString()??'0';
 const due=async(id:string)=>db.chapaCheckout.update({where:{id},data:{leaseUntil:null,nextCheckAt:new Date(0)}});
 async function fixture(options:{batch?:boolean;coupon?:boolean;fee?:number;balance?:string}={}){
  const userId=(await verifiedReferralUser(db)).id,auction=options.batch?await realReferralAuction(db,options.fee??50):null,coupon=options.coupon?(await earnedReferralCoupon(db,userId)).coupon:null;
  await db.telegramOwnContact.update({where:{userId},data:{phoneCipher:encryptPhone('+251911652904',contactBotId())}});
  if(options.balance)await creditDevelopmentPoints(db,userId,options.balance,randomUUID());
  const quote=auction?await quoteBidBatch(db,userId,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','7.25','99'],feeVersion:1,...(coupon?{couponId:coupon.id}:{})}):null;
  const command=quote?{key:randomUUID(),purpose:'BID' as const,batchId:quote.id,quoteHash:quote.quoteHash}:{key:randomUUID(),purpose:'TOP_UP' as const,amount:'25.50'};
  let initialized:ChapaCreate|null=null,status='success',mutate:(row:Record<string,unknown>)=>Record<string,unknown>=row=>row;
  const reference='CH'+randomUUID().replaceAll('-',''),create=vi.fn(async(input:ChapaCreate)=>{initialized=input;return {status:'success',data:{checkout_url:'https://checkout.chapa.co/test/'+reference}}}),lookup=vi.fn(async()=>({status:'success',data:mutate({tx_ref:initialized!.merchantReference,reference,amount:(Number(initialized!.amountCents)/100).toFixed(2),currency:'ETB',status,mode:'test',method:'telebirr',charge:'0.25'})}));
  const transport:ChapaTransport={create,lookup,methods:vi.fn()},start=(input:unknown=command)=>createChapaCheckout(db,userId,input,undefined,transport),verify=async(id:string)=>{await due(id);return verifyChapaCheckout(db,id,userId,undefined,transport)};
  return {userId,auction,coupon,quote,command,reference,transport,create,lookup,start,verify,setStatus:(next:string)=>{status=next},mutate:(fn:typeof mutate)=>{mutate=fn}};
 }
 it('freezes v1 intent and sends only transient verified contact to hosted initialization',async()=>{
  const f=await fixture(),order=await f.start(),saved=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(order).toMatchObject({apiVersion:1,chargeType:'HOSTED',amount:'25.50',status:'PENDING'});expect(saved.chapaReference).toBeNull();expect(saved.apiVersion).toBe(1);expect(await balance(f.userId)).toBe('0');
  expect(f.create.mock.calls[0][0]).toMatchObject({amountCents:'2550',merchantReference:saved.merchantReference,callbackUrl:`https://lowwin.test/api/payments/chapa/v1/callback?checkout=${order.id}`,returnUrl:`https://lowwin.test/payments/chapa/return?checkout=${order.id}`,customer:{phone_number:expect.stringMatching(/^0[79]\d{8}$/)}});
  expect(saved.initialization).not.toHaveProperty('customer');expect(JSON.stringify(saved.initialization)).not.toContain('phone_number');expect(saved.phoneCipher).toBeTruthy();expect(order).not.toHaveProperty('phoneCipher');expect(f.transport.methods).not.toHaveBeenCalled();
 });
 it('credits verified ETB evidence once across concurrent checks and binds a versioned receipt',async()=>{
  const f=await fixture(),order=await f.start();await due(order.id);await Promise.all([verifyChapaCheckout(db,order.id,f.userId,undefined,f.transport),verifyChapaCheckout(db,order.id,f.userId,undefined,f.transport)]);
  expect(await getChapaCheckout(db,f.userId,order.id)).toMatchObject({status:'CREDITED',apiVersion:1});expect(await balance(f.userId)).toBe('25.5');expect(f.lookup).toHaveBeenCalledOnce();await f.verify(order.id);expect(f.lookup).toHaveBeenCalledOnce();
  const receipt=await db.operation.findFirstOrThrow({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}});expect(receipt.result).toMatchObject({apiVersion:1,amountCents:'2550',merchantReference:order.merchantReference,chapaReference:f.reference});expect(await reconcileChapaReceipts(db)).toEqual([]);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps ambiguous initialization on its original reference and never creates a replacement charge',async()=>{
  const f=await fixture();f.create.mockImplementationOnce(async(input)=>{f.lookup.mockRejectedValue(new ChapaProviderError(404,'NOT_FOUND'));throw Error('network lost after provider accepted original tx_ref: '+input.merchantReference)});
  const first=await f.start();expect(first).toMatchObject({status:'PENDING',reason:'INITIALIZATION_PENDING',checkoutUrl:null});
  const retry=await f.start({...f.command,key:randomUUID()});expect(retry).toMatchObject({id:first.id,status:'NEEDS_REVIEW',reason:'PROVIDER_REFERENCE_UNAVAILABLE',checkoutUrl:null});expect(f.create).toHaveBeenCalledOnce();expect(f.lookup).toHaveBeenCalledWith(first.merchantReference);
  await expect(f.start({...f.command,key:randomUUID(),amount:'30.00'})).rejects.toMatchObject({code:'PAYMENT_ALREADY_PENDING'});expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(1);expect(await balance(f.userId)).toBe('0');
  f.lookup.mockResolvedValue({status:'success',data:{tx_ref:first.merchantReference,reference:f.reference,amount:'25.50',currency:'ETB',status:'success',mode:'test'}});expect(await f.verify(first.id)).toMatchObject({status:'CREDITED'});expect(await balance(f.userId)).toBe('25.5');expect(f.create).toHaveBeenCalledOnce();
 });
 it('marks initialization durably before provider HTTP so a process interruption cannot replay it',async()=>{
  const f=await fixture();let checkoutId:string|undefined;
  f.create.mockImplementationOnce(async input=>{const row=await db.chapaCheckout.findUniqueOrThrow({where:{merchantReference:input.merchantReference}});checkoutId=row.id;expect(row).toMatchObject({reason:'INITIALIZATION_PENDING',checkoutUrl:null});expect(row.leaseUntil).toBeInstanceOf(Date);throw Error('simulated worker interruption after the durable marker')});
  const order=await f.start();expect(order.id).toBe(checkoutId);f.lookup.mockRejectedValue(new ChapaProviderError(404,'NOT_FOUND'));await due(order.id);await f.start();expect(f.create).toHaveBeenCalledOnce();expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(1);
 });
 it('blocks a newly quoted batch for the same auction until its original payment is resolved',async()=>{
  const f=await fixture({batch:true}),order=await f.start();
  const next=await quoteBidBatch(db,f.userId,{key:randomUUID(),auctionSlug:f.auction!.slug!,numbers:['2','7.25','99'],feeVersion:1});
  await expect(f.start({key:randomUUID(),purpose:'BID',batchId:next.id,quoteHash:next.quoteHash})).rejects.toMatchObject({code:'PAYMENT_ALREADY_PENDING'});
  expect(f.create).toHaveBeenCalledOnce();expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(1);
  const alias={...f.command,key:randomUUID()};expect((await f.start(alias)).id).toBe(order.id);await f.verify(order.id);expect((await f.start(alias)).id).toBe(order.id);expect(f.create).toHaveBeenCalledOnce();
 });
 it('keeps a pending historical v2 intent authoritative when a new v1 key is submitted',async()=>{
  const f=await fixture(),historical=await db.chapaCheckout.create({data:{userId:f.userId,purpose:'TOP_UP',apiVersion:2,mode:'test',credentialFingerprint:'b'.repeat(64),key:randomUUID(),requestHash:'c'.repeat(64),merchantReference:'LW'+randomUUID().replaceAll('-','').slice(0,18),amountCents:2550n,initialization:{amountCents:'2550',legacy:true},expiresAt:new Date(Date.now()+86400000)}});
  expect(await f.start()).toMatchObject({id:historical.id,apiVersion:2});expect(f.create).not.toHaveBeenCalled();expect(f.lookup).not.toHaveBeenCalled();
  await expect(f.start({...f.command,key:randomUUID(),amount:'40.00'})).rejects.toMatchObject({code:'PAYMENT_ALREADY_PENDING'});expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(1);
  await expect(f.verify(historical.id)).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'});expect(f.lookup).not.toHaveBeenCalled();expect(await balance(f.userId)).toBe('0');
 });
 it('rejects an unsupported verified contact before creating an unusable payment',async()=>{
  const f=await fixture();await db.telegramOwnContact.update({where:{userId:f.userId},data:{phoneCipher:encryptPhone('+99912345678901',contactBotId())}});
  await expect(f.start()).rejects.toMatchObject({code:'INVALID_PHONE',status:422});expect(f.create).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(0);
 });
 it('settles all quoted entries with one hosted payment and consumes one coupon exactly once',async()=>{
  const f=await fixture({batch:true,coupon:true}),order=await f.start();expect(order).toMatchObject({apiVersion:1,chargeType:'HOSTED',amount:'145.00',batchNumbers:['2.00','7.25','99.00']});expect(f.create.mock.calls[0][0]).not.toHaveProperty('batch');expect(f.create.mock.calls[0][0].amountCents).toBe('14500');
  const result=await f.verify(order.id);expect(result.status).toBe('BID_ACCEPTED');expect(await db.bid.count({where:{userId:f.userId,auctionId:f.auction!.id}})).toBe(3);expect(await balance(f.userId)).toBe('0');expect(await db.referralRedemption.count({where:{couponId:f.coupon!.id}})).toBe(1);expect(await db.bidBatchOrder.findUniqueOrThrow({where:{id:f.quote!.id}})).toMatchObject({status:'ACCEPTED'});
  await f.verify(order.id);expect(await db.operation.count({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await reconcileChapaReceipts(db)).toEqual([]);expect(await reconcile(db)).toEqual([]);
 });
 it('preserves the whole verified payment in the wallet if any quoted entry became unavailable',async()=>{
  const f=await fixture({batch:true,balance:'50'}),order=await f.start();await submitBid(db,{userId:f.userId,auctionSlug:f.auction!.slug!,amount:'7.25',feeVersion:1,key:randomUUID()});
  expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',fundsPreserved:true});expect(await balance(f.userId)).toBe('150');expect(await db.bid.count({where:{userId:f.userId,auctionId:f.auction!.id}})).toBe(1);expect(await db.bidBatchOrder.findUniqueOrThrow({where:{id:f.quote!.id}})).toMatchObject({status:'QUOTED'});expect(await reconcileChapaReceipts(db)).toEqual([]);
 });
 it.each([{amount:'25.51'},{tx_ref:'LWunrelated'},{currency:'USD'},{mode:'live'},{reference:null}])('rejects mismatched v1 success evidence %j',async patch=>{
  const f=await fixture(),order=await f.start();f.mutate(row=>({...row,...patch}));expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW'});expect(await balance(f.userId)).toBe('0');expect(await db.operation.count({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}})).toBe(0);
 });
 it('recovers v1 pending hosted payments with legacy sweeping disabled',async()=>{
  const f=await fixture(),order=await f.start();await due(order.id);expect((await recoverChapaCheckouts(db,20,f.transport)).checked).toBeGreaterThan(0);expect(await getChapaCheckout(db,f.userId,order.id)).toMatchObject({status:'CREDITED'});expect(await balance(f.userId)).toBe('25.5');
 });
});
