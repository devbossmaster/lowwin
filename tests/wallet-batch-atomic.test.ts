import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {quoteBidBatch,payBidBatchWallet,createAndPayBidBatchWallet,getOwnWalletBidBatch} from '../src/modules/auctions/batch';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {walletBidsEnabled} from '../src/modules/wallet/policy';
import {readWalletBalance} from '../src/modules/wallet/balance';
import {createInlineCheckout} from '../src/modules/payments/chapa-inline';
import type {ChapaInlineTransport} from '../src/modules/payments/chapa-inline-provider';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {chapaHttpError} from '../src/modules/payments/chapa-http';
import {verifiedReferralUser,realReferralAuction,referredRegistration} from './referral-fixtures';
import {TEST_TOKEN} from './helpers';

const database=process.env.WALLET_BATCH_TEST_DATABASE_URL;
describe.skipIf(!database)('internal wallet batch command on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const url=new URL(database!);if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_ENABLED:'false',CHAPA_INLINE_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'false',CHAPA_PRIVATE_KEY:'',CHAPA_PUBLIC_KEY:'',PAYMENT_GATEWAY:'NONE',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-wallet-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'wallet-batch-test',PHONE_CONTACT_KEYS:JSON.stringify({'wallet-batch-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'false'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(userId:string)=>(await db.ledgerAccount.findUnique({where:{name:`user:${userId}:available`}}))?.balance.toFixed(2)??'0.00';
 async function withExternal<T>(run:(transport:ChapaInlineTransport)=>Promise<T>){
  const configuration={CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(40),CHAPA_WEBHOOK_SECRET:'c'.repeat(64),CHAPA_INLINE_METHODS:'telebirr',PAYMENT_GATEWAY:'CHAPA'},old=Object.fromEntries(Object.keys(configuration).map(key=>[key,process.env[key]]));
  Object.assign(process.env,configuration);let merchant='';const reference='CH'+randomUUID();
  const transport={create:vi.fn(),methods:vi.fn(async()=>({status:'success',data:[{name:'telebirr',slug:'telebirr',can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true}}}}}]})),inline:vi.fn(async(input:{merchantReference:string})=>{merchant=input.merchantReference;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',expires_at:new Date(Date.now()+300000).toISOString()}}}),validate:vi.fn(async()=>null),lookup:vi.fn(async()=>({status:'success',data:{merchant_reference:merchant,chapa_reference:reference,amount:2000,currency:'ETB',mode:'test',status:'SUCCESS',payment_method:'telebirr'}}))} as unknown as ChapaInlineTransport;
  try{return await run(transport)}finally{for(const[key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value}
 }
 async function fixture(options:{fee?:number;balance?:string;numbers?:string[]}={}){
  const userId=(await verifiedReferralUser(db)).id,auction=await realReferralAuction(db,options.fee??10);
  if(options.balance)await creditDevelopmentPoints(db,userId,options.balance,randomUUID());
  const command={key:randomUUID(),auctionSlug:auction.slug,numbers:options.numbers??['2','9'],feeVersion:1},batch=await quoteBidBatch(db,userId,command);
  return {userId,auction,command,batch,pay:()=>payBidBatchWallet(db,userId,batch.id,{quoteHash:batch.quoteHash})};
 }
 async function unquotedFixture(){
  const userId=(await verifiedReferralUser(db)).id,auction=await realReferralAuction(db,10);await creditDevelopmentPoints(db,userId,'25',randomUUID());
  return {userId,auction,command:{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','9'],feeVersion:1,approvedTotal:'20.00'}};
 }
 it('creates the quote and complete wallet payment in one transaction and recovers the committed receipt read-only',async()=>{
  const f=await unquotedFixture(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No provider HTTP allowed'));
  try{
   expect(await getOwnWalletBidBatch(db,f.userId,{key:f.command.key})).toMatchObject({kind:'pending',status:'PENDING',batchId:null});
   expect(await db.bidBatchOrder.count({where:{userId:f.userId}})).toBe(0);
   const paid=await createAndPayBidBatchWallet(db,f.userId,f.command);expect(paid.kind).toBe('receipt');if(paid.kind!=='receipt')throw Error('Committed receipt required');
   expect(paid.receipt).toMatchObject({batch:{status:'ACCEPTED',total:'20.00'},wallet:{available:'5.00'},payment:{method:'wallet',acceptedBidIds:paid.receipt.receipts.map(item=>item.bid.id)}});
   expect(await getOwnWalletBidBatch(db,f.userId,{key:f.command.key})).toEqual(paid);
   expect(await getOwnWalletBidBatch(db,f.userId,{id:paid.receipt.batch.id,quoteHash:paid.receipt.batch.quoteHash})).toEqual(paid);
   expect(fetch).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(0);
  }finally{fetch.mockRestore()}
 });
 it('serializes first-command duplicate tabs and rejects changed selections under the original key',async()=>{
  const f=await unquotedFixture(),[first,replayed]=await Promise.all([createAndPayBidBatchWallet(db,f.userId,f.command),createAndPayBidBatchWallet(db,f.userId,f.command)]);
  expect(first).toEqual(replayed);expect(await balance(f.userId)).toBe('5.00');expect(await db.bid.count({where:{userId:f.userId}})).toBe(2);
  await expect(createAndPayBidBatchWallet(db,f.userId,{...f.command,numbers:['3','10']})).rejects.toMatchObject({code:'KEY_REUSED'});
  await expect(createAndPayBidBatchWallet(db,f.userId,{...f.command,approvedTotal:'10.00'})).rejects.toMatchObject({code:'KEY_REUSED'});
  expect(await createAndPayBidBatchWallet(db,f.userId,{...f.command,approvedTotal:'20'})).toEqual(first);
  expect(await db.bid.count({where:{userId:f.userId}})).toBe(2);expect(await balance(f.userId)).toBe('5.00');
 });
 it('returns a changed total for explicit review without debiting, then accepts only the confirmed saved quote',async()=>{
  const f=await unquotedFixture(),review=await createAndPayBidBatchWallet(db,f.userId,{...f.command,approvedTotal:'10.00'});
  expect(review.kind).toBe('quote');if(review.kind!=='quote')throw Error('Review quote required');
  expect(review.quote.total).toBe('20.00');expect(await balance(f.userId)).toBe('25.00');expect(await db.bid.count({where:{userId:f.userId}})).toBe(0);
  await expect(createAndPayBidBatchWallet(db,f.userId,f.command)).rejects.toMatchObject({code:'KEY_REUSED'});
  expect(await getOwnWalletBidBatch(db,f.userId,{key:f.command.key})).toMatchObject({kind:'pending',batchId:review.quote.id});
  expect(await payBidBatchWallet(db,f.userId,review.quote.id,{quoteHash:review.quote.quoteHash})).toMatchObject({wallet:{available:'5.00'},batch:{status:'ACCEPTED'}});
 });
 it('does not wait on or mutate an uncommitted first command while observing its original key',async()=>{
  const f=await unquotedFixture();let release!:()=>void,reached!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),locked=new Promise<void>(resolve=>{reached=resolve});
  const pending=createAndPayBidBatchWallet(db,f.userId,f.command,async()=>{reached();await gate});await locked;
  try{expect(await getOwnWalletBidBatch(db,f.userId,{key:f.command.key})).toMatchObject({kind:'pending',batchId:null});expect(await db.bid.count({where:{userId:f.userId}})).toBe(0)}finally{release()}
  expect((await pending).kind).toBe('receipt');expect((await getOwnWalletBidBatch(db,f.userId,{key:f.command.key})).kind).toBe('receipt');
 });
 it('keeps the single-command receipt private and rolls back when session reauthorization fails',async()=>{
  const f=await unquotedFixture(),other=(await verifiedReferralUser(db)).id;
  await expect(createAndPayBidBatchWallet(db,f.userId,f.command,async()=>{throw Error('Session revoked')})).rejects.toThrow('Session revoked');
  expect(await db.bidBatchOrder.count({where:{userId:f.userId}})).toBe(0);expect(await balance(f.userId)).toBe('25.00');
  const paid=await createAndPayBidBatchWallet(db,f.userId,f.command);if(paid.kind!=='receipt')throw Error('Receipt required');
  expect(await getOwnWalletBidBatch(db,other,{key:f.command.key})).toMatchObject({kind:'pending',batchId:null});
  await expect(getOwnWalletBidBatch(db,other,{id:paid.receipt.batch.id,quoteHash:paid.receipt.batch.quoteHash})).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('rolls back the new quote as well as all financial effects when the complete order is unaffordable',async()=>{
  const f=await unquotedFixture(),command={...f.command,numbers:['2','9','12'],approvedTotal:'30.00'};
  await expect(createAndPayBidBatchWallet(db,f.userId,command)).rejects.toMatchObject({code:'INSUFFICIENT_POINTS',wallet:{available:'25.00',required:'30.00',shortfall:'5.00'}});
  expect(await balance(f.userId)).toBe('25.00');expect(await db.bidBatchOrder.count({where:{userId:f.userId}})).toBe(0);expect(await db.bid.count({where:{userId:f.userId}})).toBe(0);
 });
 it('preserves first-bid referral qualification and a single coupon redemption in the consolidated path',async()=>{
  process.env.REFERRAL_REWARDS_SCHEMA_READY='true';
  try{
   await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-wallet-fixture'}});
   const sponsor=await verifiedReferralUser(db),referred=await referredRegistration(db,sponsor.id),auction=await realReferralAuction(db,10);
   await creditDevelopmentPoints(db,referred.id,'25',randomUUID());
   const first=await createAndPayBidBatchWallet(db,referred.id,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','9'],feeVersion:1,approvedTotal:'20.00'});
   expect(first.kind).toBe('receipt');const coupon=await db.referralCoupon.findUniqueOrThrow({where:{referredUserId:referred.id}});expect(coupon.ownerUserId).toBe(sponsor.id);expect(await db.referralCoupon.count({where:{referredUserId:referred.id}})).toBe(1);
   await creditDevelopmentPoints(db,sponsor.id,'25',randomUUID());
   const input={key:randomUUID(),auctionSlug:auction.slug!,numbers:['4','11'],feeVersion:1,couponId:coupon.id,approvedTotal:'19.00'},paid=await createAndPayBidBatchWallet(db,sponsor.id,input);
   expect(paid).toMatchObject({kind:'receipt',receipt:{batch:{total:'19.00',grossTotal:'20.00',discountTotal:'1.00'},wallet:{available:'6.00'}}});
   expect(await createAndPayBidBatchWallet(db,sponsor.id,input)).toEqual(paid);expect(await db.referralRedemption.count({where:{couponId:coupon.id}})).toBe(1);expect(await reconcile(db)).toEqual([]);
  }finally{process.env.REFERRAL_REWARDS_SCHEMA_READY='false'}
 });
 it('charges only fees, returns committed balance and internal metadata without external configuration or HTTP',async()=>{
  const f=await fixture({balance:'25',numbers:['2','900']}),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No network expected'));
  try{expect(walletBidsEnabled()).toBe(true);const paid=await f.pay();expect(paid).toMatchObject({batch:{total:'20.00',status:'ACCEPTED'},wallet:{available:'5.00',held:'0.00'},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'20.00'}});expect(paid.payment.acceptedBidIds).toEqual(paid.receipts.map(receipt=>receipt.bid.id));const guard=await db.walletHoldGuard.findFirstOrThrow({where:{wallet:{userId:f.userId}}});expect(paid.wallet.revision).toBe(String(guard.revision));expect(BigInt(paid.wallet.revision)).toBeGreaterThan(0n);expect(await readWalletBalance(db,f.userId)).toMatchObject({available:'5',held:'0',revision:paid.wallet.revision});expect(await balance(f.userId)).toBe('5.00');expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(0);expect(fetch).not.toHaveBeenCalled();expect(await db.outbox.count({where:{kind:'BID_ACCEPTED',payload:{path:['recipientUserId'],equals:f.userId}}})).toBe(2)}finally{fetch.mockRestore()}
 });
 it('accepts duplicate concurrent calls once and replays the same receipt after a lost response',async()=>{
  const f=await fixture({balance:'25'}),[first,replay]=await Promise.all([f.pay(),f.pay()]);
  expect(first.payment.acceptedBidIds).toEqual(replay.payment.acceptedBidIds);expect(first.receipts).toEqual(replay.receipts);expect(await balance(f.userId)).toBe('5.00');expect(await db.bid.count({where:{userId:f.userId}})).toBe(2);expect(await db.operation.count({where:{userId:f.userId,scope:'BID'}})).toBe(2);
  await creditDevelopmentPoints(db,f.userId,'7',randomUUID());const later=await f.pay();expect(later.payment.acceptedBidIds).toEqual(first.payment.acceptedBidIds);expect(later.wallet.available).toBe('12.00');expect(BigInt(later.wallet.revision)).toBeGreaterThan(BigInt(first.wallet.revision));expect((await readWalletBalance(db,f.userId)).revision).toBe(later.wallet.revision);expect(await db.bid.count({where:{userId:f.userId}})).toBe(2);
 });
 it('isolates ownership on first payment and accepted receipt replay',async()=>{const f=await fixture({balance:'25'}),other=(await verifiedReferralUser(db)).id;await expect(payBidBatchWallet(db,other,f.batch.id,{quoteHash:f.batch.quoteHash})).rejects.toMatchObject({code:'NOT_FOUND',status:404});await f.pay();await expect(payBidBatchWallet(db,other,f.batch.id,{quoteHash:f.batch.quoteHash})).rejects.toMatchObject({code:'NOT_FOUND',status:404});expect(await balance(f.userId)).toBe('5.00');expect(await db.bid.count({where:{userId:other}})).toBe(0)});
 it('rejects a changed hash under the same order without another debit',async()=>{const f=await fixture({balance:'25'});await f.pay();await expect(payBidBatchWallet(db,f.userId,f.batch.id,{quoteHash:'0'.repeat(64)})).rejects.toMatchObject({code:'TERMS_CHANGED'});expect(await balance(f.userId)).toBe('5.00');expect(await db.bid.count({where:{userId:f.userId}})).toBe(2)});
 it('returns exact insufficient balance details before writes and leaves selection/outbox unchanged',async()=>{
  const f=await fixture({balance:'19.50'});let rejected:unknown;try{await f.pay()}catch(error){rejected=error}
  expect(rejected).toMatchObject({code:'INSUFFICIENT_POINTS',wallet:{available:'19.50',required:'20.00',shortfall:'0.50',currency:'ETB'}});expect(await chapaHttpError(rejected).json()).toMatchObject({code:'INSUFFICIENT_POINTS',wallet:{available:'19.50',required:'20.00',shortfall:'0.50',currency:'ETB'}});expect(await balance(f.userId)).toBe('19.50');expect(await db.bid.count({where:{userId:f.userId}})).toBe(0);expect(await db.operation.count({where:{userId:f.userId,scope:'BID'}})).toBe(0);expect(await db.outbox.count({where:{kind:'BID_ACCEPTED',payload:{path:['recipientUserId'],equals:f.userId}}})).toBe(0);expect(await db.bidBatchOrder.findUniqueOrThrow({where:{id:f.batch.id}})).toMatchObject({status:'QUOTED',receipt:null});
 });
 it('serializes competing orders so only affordable complete batches commit',async()=>{
  const f=await fixture({balance:'20'}),other=await quoteBidBatch(db,f.userId,{...f.command,key:randomUUID(),numbers:['4','11']});
  const results=await Promise.allSettled([f.pay(),payBidBatchWallet(db,f.userId,other.id,{quoteHash:other.quoteHash})]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);expect(await balance(f.userId)).toBe('0.00');expect(await db.bid.count({where:{userId:f.userId}})).toBe(2);
 });
 it('rolls back the first debit, bid and notification if a later batch write fails',async()=>{
  const f=await fixture({balance:'25'}),broken=new Proxy(db,{get(target,key){if(key==='$transaction')return async(work:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:Parameters<PrismaClient['$transaction']>[1])=>target.$transaction(async tx=>work(new Proxy(tx,{get(inner,field){if(field==='bid')return new Proxy(inner.bid,{get(delegate,method){if(method==='createManyAndReturn')return()=>{throw Error('Injected later batch write failure')};const value=Reflect.get(delegate,method);return typeof value==='function'?value.bind(delegate):value}});const value=Reflect.get(inner,field);return typeof value==='function'?value.bind(inner):value}})),options);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  await expect(payBidBatchWallet(broken,f.userId,f.batch.id,{quoteHash:f.batch.quoteHash})).rejects.toThrow('Injected later batch write failure');expect(await balance(f.userId)).toBe('25.00');expect(await db.bid.count({where:{userId:f.userId}})).toBe(0);expect(await db.operation.count({where:{userId:f.userId,scope:'BID'}})).toBe(0);expect(await db.outbox.count({where:{kind:'BID_ACCEPTED',payload:{path:['recipientUserId'],equals:f.userId}}})).toBe(0);expect(await db.bidBatchOrder.findUniqueOrThrow({where:{id:f.batch.id}})).toMatchObject({status:'QUOTED',receipt:null});
 });
 it('does not overdraw or race an internal debit against a Chapa intent for the same order',async()=>{
  const f=await fixture({balance:'25'});
  await withExternal(async transport=>{const results=await Promise.allSettled([f.pay(),createInlineCheckout(db,f.userId,{key:randomUUID(),purpose:'BID',flow:'INLINE',batchId:f.batch.id,quoteHash:f.batch.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},undefined,transport)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);const bids=await db.bid.count({where:{userId:f.userId}}),checkouts=await db.chapaCheckout.count({where:{batchId:f.batch.id}});expect(bids===2&&checkouts===0||bids===0&&checkouts===1).toBe(true);expect(await balance(f.userId)).toBe(bids?'5.00':'25.00')});
 });
 it('cannot relabel a Chapa-accepted order as an internal wallet receipt or repeat its effects',async()=>{
  const f=await fixture({balance:'25'});
  await withExternal(async transport=>{
   const {order}=await createInlineCheckout(db,f.userId,{key:randomUUID(),purpose:'BID',flow:'INLINE',batchId:f.batch.id,quoteHash:f.batch.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},undefined,transport);
   expect(await verifyChapaCheckout(db,order.id,f.userId,undefined,transport,true)).toMatchObject({status:'BID_ACCEPTED',apiVersion:'v2'});
   const snapshot=async()=>({balance:await balance(f.userId),bids:await db.bid.count({where:{userId:f.userId}}),operations:await db.operation.count({where:{userId:f.userId}}),journals:await db.journal.count({where:{operation:{userId:f.userId}}}),outbox:await db.outbox.count({where:{kind:'BID_ACCEPTED',payload:{path:['recipientUserId'],equals:f.userId}}}),inbox:await db.notificationInbox.count({where:{userId:f.userId}}),batch:await db.bidBatchOrder.findUniqueOrThrow({where:{id:f.batch.id}}),checkout:await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})});
   const before=await snapshot();expect(before.balance).toBe('25.00');expect(before.bids).toBe(2);
   await expect(f.pay()).rejects.toMatchObject({status:409,code:'PAYMENT_STARTED'});
   expect(await snapshot()).toEqual(before);expect(transport.lookup).toHaveBeenCalledOnce();
  });
 });
 it('preserves zero-fee batches without a wallet gate or gateway intent',async()=>{const f=await fixture({fee:0});process.env.WALLET_BIDS_ENABLED='false';try{const paid=await f.pay();expect(paid).toMatchObject({batch:{total:'0.00'},wallet:{available:'0.00',held:'0.00'},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'0.00'}});expect(paid.receipts).toHaveLength(2);expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(0)}finally{process.env.WALLET_BIDS_ENABLED='true'}});
 it('keeps all ledger projections balanced after the tested outcomes',async()=>{expect(await reconcile(db)).toEqual([])});
});
