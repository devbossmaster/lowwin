import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {bidAuction,bidUser} from './bid-fixtures';
import {reconcile} from '../src/modules/wallet/ledger';
import {encryptPhone,phoneHash} from '../src/modules/auth/own-contact';
import type {ArifPayCreate,ArifPayTransport} from '../src/modules/payments/arifpay-provider';
// Only this isolated DB suite bypasses release flags; provider network is injected.
vi.mock('../src/modules/payments/arifpay-provider',async original=>({...await original<typeof import('../src/modules/payments/arifpay-provider')>(),requireArifPay:()=>{}}));
import {createArifPayCheckout,getArifPayCheckout,listArifPayCheckouts,verifyArifPayCheckout} from '../src/modules/payments/arifpay';
const url=process.env.ARIFPAY_TEST_DATABASE_URL;
describe.skipIf(!url)('ArifPay checkout on disposable loopback PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(()=>{
  const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable loopback *_test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123456789:fixture_token_not_a_real_bot_secret',BETTER_AUTH_URL:'http://localhost:3000',ARIFPAY_WEBHOOK_TOKEN:'fixture-callback-token-for-isolated-tests'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();
 },60000);
 afterAll(async()=>{await db?.$disconnect()});
 async function fixture(endDelayMs=600000){
  const a=await bidAuction(db,{ruleVersion:'lowest-unique-v4',fee:30,isDemo:false,endDelayMs}),userId=await bidUser(db,'10'),key=randomUUID();
  const telegramId=String(Math.floor(Math.random()*1e12)+1),contactPhone=`+999${telegramId}`;
  await db.user.update({where:{id:userId},data:{telegramId}});
  await db.telegramOwnContact.create({data:{userId,telegramId,botId:'123456789',phoneHash:phoneHash(contactPhone),phoneCipher:encryptPhone(contactPhone),lastFour:contactPhone.slice(-4),verifiedAt:new Date(),sourceUpdateId:BigInt(telegramId)}});
  let created:ArifPayCreate|undefined,status='SUCCESS',mutate:(data:Record<string,unknown>)=>Record<string,unknown>=d=>d;
  const create=vi.fn(async(input:ArifPayCreate)=>{created=input;return {error:false,data:{sessionId:key,transaction:{transactionStatus:'SUCCESS'}}}});
  const lookup=vi.fn(async()=>({error:false,data:mutate({uuid:key,nonce:created!.nonce,phone:created!.phone,totalAmount:30,paymentMethod:'TELEBIRR_USSD',transaction:{transactionId:`receipt-${key}`,transactionStatus:status}})}));
  const transport:ArifPayTransport={create,lookup};
  const input={auctionSlug:a.slug!,amount:'3.60',feeVersion:1,key,channel:'TELEBIRR',phone:'0911111111'};
  const start=()=>createArifPayCheckout(db,userId,input,undefined,transport);
  const verify=async(id:string)=>{await db.arifPayCheckout.update({where:{id},data:{nextCheckAt:new Date(0)}});return verifyArifPayCheckout(db,id,userId,undefined,transport)};
  return {a,userId,key,input,start,verify,create,lookup,transport,setStatus:(value:string)=>{status=value},setMutate:(value:typeof mutate)=>{mutate=value}};
 }
 const available=async(userId:string)=>(await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}})).balance.toString();
 it('does not accept a bid from create/USSD response; verified payment and repeated polls accept and charge exactly once',async()=>{
  const f=await fixture(),order=await f.start();expect(order.status).toBe('PENDING');expect(await db.bid.count({where:{auctionId:f.a.id}})).toBe(0);expect(await available(f.userId)).toBe('10');
  const result=await f.verify(order.id);expect(result.status).toBe('BID_ACCEPTED');expect(result.receipt).toMatchObject({charge:{feePoints:'30',newlyUnavailable:'30'},hold:{extraReserved:'0'}});expect(await available(f.userId)).toBe('10');
  await Promise.all([f.verify(order.id),f.verify(order.id)]);expect(await db.bid.count({where:{auctionId:f.a.id}})).toBe(1);expect(await db.operation.count({where:{userId:f.userId,scope:'ARIFPAY_RECEIPT'}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('reuses the durable checkout and nonce after retry, concurrent calls and a refreshed idempotency key',async()=>{
  const f=await fixture(),orders=await Promise.all([f.start(),f.start()]);expect(orders[0].id).toBe(orders[1].id);expect(f.create).toHaveBeenCalledTimes(1);
  expect((await createArifPayCheckout(db,f.userId,{...f.input,key:randomUUID()},undefined,f.transport)).id).toBe(orders[0].id);expect(f.create).toHaveBeenCalledTimes(1);
  await expect(createArifPayCheckout(db,f.userId,{...f.input,amount:'4.60'},undefined,f.transport)).rejects.toMatchObject({code:'KEY_REUSED'});
 });
 it('retains pending state on timeout without creating another session',async()=>{
  const f=await fixture();f.create.mockRejectedValueOnce(Error('ambiguous timeout'));
  const order=await f.start();expect(order.status).toBe('PENDING');expect((await f.start()).id).toBe(order.id);expect(f.create).toHaveBeenCalledTimes(1);expect(await available(f.userId)).toBe('10');
 });
 it('rejects amount, nonce, phone, currency, session and payment-channel mismatches without crediting',async()=>{
  for(const change of [{totalAmount:29.99},{nonce:'wrong-nonce'},{phone:'251922222222'},{currency:'USD'},{uuid:'wrong-session'},{paymentMethod:'CBE'}]){
   const f=await fixture(),order=await f.start();f.setMutate(d=>({...d,...change}));const result=await f.verify(order.id);expect(result.status).toBe('PENDING');expect(result.reason).toBe('EVIDENCE_PENDING');expect(await available(f.userId)).toBe('10');expect(await db.bid.count({where:{auctionId:f.a.id}})).toBe(0);
  }
  expect(await reconcile(db)).toEqual([]);
 });
 it('does not credit pending or unsuccessful payments and enforces ownership',async()=>{
  for(const status of ['PENDING','FAILED','CANCELLED','EXPIRED']){
   const f=await fixture(),order=await f.start();f.setStatus(status);expect((await f.verify(order.id)).status).toBe(status);expect(await available(f.userId)).toBe('10');
   await expect(getArifPayCheckout(db,randomUUID(),order.id)).rejects.toMatchObject({status:404});await expect(verifyArifPayCheckout(db,order.id,randomUUID(),undefined,f.transport)).rejects.toMatchObject({status:404});
  }
 });
 it('does not request money after session reauthorization fails',async()=>{
  const f=await fixture();await expect(createArifPayCheckout(db,f.userId,f.input,async()=>{throw Error('session revoked')},f.transport)).rejects.toThrow('session revoked');
  expect(f.create).not.toHaveBeenCalled();expect(await db.arifPayCheckout.count({where:{userId:f.userId}})).toBe(0);expect(await available(f.userId)).toBe('10');
 });
 it('requires a provider reference and prevents the same external transfer from crediting a second customer',async()=>{
  const first=await fixture(),one=await first.start();await first.verify(one.id);
  const second=await fixture(),two=await second.start();second.setMutate(d=>({...d,transaction:{transactionStatus:'SUCCESS'}}));expect((await second.verify(two.id)).status).toBe('PENDING');expect(await available(second.userId)).toBe('10');
  second.setMutate(d=>({...d,transaction:{transactionStatus:'SUCCESS',transactionId:`receipt-${first.key}`}}));
  const duplicate=await second.verify(two.id);expect(duplicate.status).toBe('NEEDS_REVIEW');expect(duplicate.reason).toBe('DUPLICATE_PROVIDER_REFERENCE');expect(duplicate.fundsPreserved).toBe(false);expect(await available(second.userId)).toBe('10');expect(await reconcile(db)).toEqual([]);
 });
 it('preserves verified funds once when fee changes after the customer pays; no bid is inserted',async()=>{
  const f=await fixture(),order=await f.start();
  await db.auctionFeeRevision.create({data:{auctionId:f.a.id,version:2,feePoints:35,reason:'Fixture fee race'}});
  const result=await f.verify(order.id);expect(result.status).toBe('NEEDS_REVIEW');expect(result.fundsPreserved).toBe(true);expect(result.reason).toBe('RETRYABLE_CONFLICT');expect(await available(f.userId)).toBe('40');
  await f.verify(order.id);expect(await available(f.userId)).toBe('40');expect(await db.bid.count({where:{auctionId:f.a.id}})).toBe(0);expect(await reconcile(db)).toEqual([]);
 });
 it('preserves verified funds on deadline race and never accepts a late bid',async()=>{
  const f=await fixture(31000),order=await f.start();
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,f.a.endsAt!.getTime()-Date.now()+25)));
  f.setStatus('PENDING');const pending=await f.verify(order.id);expect(pending.status).toBe('NEEDS_REVIEW');expect(pending.reason).toBe('PROVIDER_CONFIRMATION_REQUIRED');expect(pending.fundsPreserved).toBe(false);expect(await available(f.userId)).toBe('10');
  f.setStatus('SUCCESS');
  expect((await f.verify(order.id)).status).toBe('NEEDS_REVIEW');expect(await available(f.userId)).toBe('40');expect(await db.bid.count({where:{auctionId:f.a.id}})).toBe(0);expect(await reconcile(db)).toEqual([]);
 },45000);
 it('keeps immutable payment intent and financial evidence protected at the database boundary',async()=>{
  const f=await fixture(),order=await f.start();await expect(db.arifPayCheckout.update({where:{id:order.id},data:{fee:1}})).rejects.toThrow('Checkout intent is immutable');
  await expect(db.arifPayCheckout.delete({where:{id:order.id}})).rejects.toThrow('Payment audit records cannot be deleted');
  await f.verify(order.id);await expect(db.arifPayCheckout.update({where:{id:order.id},data:{transactionId:'replacement'}})).rejects.toThrow('Payment evidence is immutable');expect(await reconcile(db)).toEqual([]);
  await expect(db.arifPayCheckout.update({where:{id:order.id},data:{status:'PENDING'}})).rejects.toThrow();
 });
 it('lists only the signed-in customer and avoids the unmigrated table while schema readiness is off',async()=>{
  const f=await fixture(),order=await f.start();process.env.ARIFPAY_SCHEMA_READY='false';expect(await listArifPayCheckouts(db,f.userId)).toEqual({items:[]});
  process.env.ARIFPAY_SCHEMA_READY='true';expect((await listArifPayCheckouts(db,f.userId)).items.map(item=>item.id)).toEqual([order.id]);expect(await listArifPayCheckouts(db,randomUUID())).toEqual({items:[]});
  process.env.ARIFPAY_SCHEMA_READY='false';
 });
});
