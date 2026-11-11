import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {quoteBidBatch,payBidBatchWallet} from '../src/modules/auctions/batch';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {walletBidsEnabled} from '../src/modules/wallet/policy';
import {readWalletBalance} from '../src/modules/wallet/balance';
import {createV1Checkout} from '../src/modules/payments/chapa-v1';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {chapaHttpError} from '../src/modules/payments/chapa-http';
import {verifiedReferralUser,realReferralAuction} from './referral-fixtures';
import {TEST_TOKEN} from './helpers';

const database=process.env.WALLET_BATCH_TEST_DATABASE_URL;
describe.skipIf(!database)('internal wallet batch command on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const url=new URL(database!);if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_V1_ENABLED:'false',CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'false',CHAPA_PRIVATE_KEY:'',CHAPA_V1_SECRET_KEY:'',CHAPA_V1_PUBLIC_KEY:'',PAYMENT_GATEWAY:'NONE',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-wallet-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'wallet-batch-test',PHONE_CONTACT_KEYS:JSON.stringify({'wallet-batch-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'false'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(userId:string)=>(await db.ledgerAccount.findUnique({where:{name:`user:${userId}:available`}}))?.balance.toFixed(2)??'0.00';
 async function fixture(options:{fee?:number;balance?:string;numbers?:string[]}={}){
  const userId=(await verifiedReferralUser(db)).id,auction=await realReferralAuction(db,options.fee??10);
  if(options.balance)await creditDevelopmentPoints(db,userId,options.balance,randomUUID());
  const command={key:randomUUID(),auctionSlug:auction.slug,numbers:options.numbers??['2','9'],feeVersion:1},batch=await quoteBidBatch(db,userId,command);
  return {userId,auction,command,batch,pay:()=>payBidBatchWallet(db,userId,batch.id,{quoteHash:batch.quoteHash})};
 }
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
  const f=await fixture({balance:'25'}),old={CHAPA_V1_ENABLED:process.env.CHAPA_V1_ENABLED,CHAPA_V1_SECRET_KEY:process.env.CHAPA_V1_SECRET_KEY,CHAPA_V1_PUBLIC_KEY:process.env.CHAPA_V1_PUBLIC_KEY,CHAPA_V1_WEBHOOK_SECRET:process.env.CHAPA_V1_WEBHOOK_SECRET,PAYMENT_GATEWAY:process.env.PAYMENT_GATEWAY,CHAPA_V1_METHODS:process.env.CHAPA_V1_METHODS};
  Object.assign(process.env,{CHAPA_V1_ENABLED:'true',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_PUBLIC_KEY:'CHAPUBK_TEST-'+'a'.repeat(40),CHAPA_V1_WEBHOOK_SECRET:'a'.repeat(64),PAYMENT_GATEWAY:'CHAPA',CHAPA_V1_METHODS:'telebirr'});
  try{const results=await Promise.allSettled([f.pay(),createV1Checkout(db,f.userId,{key:randomUUID(),purpose:'BID',flow:'INLINE',batchId:f.batch.id,quoteHash:f.batch.quoteHash,paymentMethod:'telebirr',phone:'0911652904'})]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);const bids=await db.bid.count({where:{userId:f.userId}}),checkouts=await db.chapaCheckout.count({where:{batchId:f.batch.id}});expect(bids===2&&checkouts===0||bids===0&&checkouts===1).toBe(true);expect(await balance(f.userId)).toBe(bids?'5.00':'25.00')}finally{for(const[key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value}
 });
 it('cannot relabel a Chapa-accepted order as an internal wallet receipt or repeat its effects',async()=>{
  const f=await fixture({balance:'25'}),old={CHAPA_V1_ENABLED:process.env.CHAPA_V1_ENABLED,CHAPA_V1_SECRET_KEY:process.env.CHAPA_V1_SECRET_KEY,CHAPA_V1_PUBLIC_KEY:process.env.CHAPA_V1_PUBLIC_KEY,CHAPA_V1_WEBHOOK_SECRET:process.env.CHAPA_V1_WEBHOOK_SECRET,PAYMENT_GATEWAY:process.env.PAYMENT_GATEWAY,CHAPA_V1_METHODS:process.env.CHAPA_V1_METHODS};
  Object.assign(process.env,{CHAPA_V1_ENABLED:'true',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_PUBLIC_KEY:'CHAPUBK_TEST-'+'a'.repeat(40),CHAPA_V1_WEBHOOK_SECRET:'a'.repeat(64),PAYMENT_GATEWAY:'CHAPA',CHAPA_V1_METHODS:'telebirr'});
  try{
   const {order}=await createV1Checkout(db,f.userId,{key:randomUUID(),purpose:'BID',flow:'INLINE',batchId:f.batch.id,quoteHash:f.batch.quoteHash,paymentMethod:'telebirr',phone:'0911652904'});
   const lookup=vi.fn(async()=>({status:'success',data:{tx_ref:order.merchantReference,reference:'AP'+randomUUID(),amount:'20.00',currency:'ETB',mode:'test',status:'success',payment_method:'telebirr'}}));
   expect(await verifyChapaCheckout(db,order.id,f.userId,undefined,{lookup,create:vi.fn(),methods:vi.fn()},true)).toMatchObject({status:'BID_ACCEPTED',apiVersion:'v1'});
   const snapshot=async()=>({balance:await balance(f.userId),bids:await db.bid.count({where:{userId:f.userId}}),operations:await db.operation.count({where:{userId:f.userId}}),journals:await db.journal.count({where:{operation:{userId:f.userId}}}),outbox:await db.outbox.count({where:{kind:'BID_ACCEPTED',payload:{path:['recipientUserId'],equals:f.userId}}}),inbox:await db.notificationInbox.count({where:{userId:f.userId}}),batch:await db.bidBatchOrder.findUniqueOrThrow({where:{id:f.batch.id}}),checkout:await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})});
   const before=await snapshot();expect(before.balance).toBe('25.00');expect(before.bids).toBe(2);
   await expect(f.pay()).rejects.toMatchObject({status:409,code:'PAYMENT_STARTED'});
   expect(await snapshot()).toEqual(before);expect(lookup).toHaveBeenCalledOnce();
  }finally{for(const[key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value}
 });
 it('preserves zero-fee batches without a wallet gate or gateway intent',async()=>{const f=await fixture({fee:0});process.env.WALLET_BIDS_ENABLED='false';try{const paid=await f.pay();expect(paid).toMatchObject({batch:{total:'0.00'},wallet:{available:'0.00',held:'0.00'},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'0.00'}});expect(paid.receipts).toHaveLength(2);expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(0)}finally{process.env.WALLET_BIDS_ENABLED='true'}});
 it('keeps all ledger projections balanced after the tested outcomes',async()=>{expect(await reconcile(db)).toEqual([])});
});
