import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {getTransactions,getWalletTransaction,transactionsQuerySchema} from '../src/modules/wallet/transactions';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {quoteBidBatch} from '../src/modules/auctions/batch';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {createChapaCheckout,verifyChapaCheckout} from '../src/modules/payments/chapa';
import {createDirectCheckout} from '../src/modules/payments/chapa-direct';
import type {ChapaCreate,ChapaDirectCreate,ChapaTransport} from '../src/modules/payments/chapa-provider';
import {signedLaunch,TEST_TOKEN} from './helpers';
import {contactBotId,encryptPhone} from '../src/modules/auth/own-contact';

const database=process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('owner-only unified transactions on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(database!);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'true',WALLET_BIDS_ENABLED:'true',CHAPA_V1_MODE:'test',CHAPA_V1_ENABLED:'true',CHAPA_V1_RECOVERY_ENABLED:'true',CHAPA_V1_SCHEMA_READY:'true',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_WEBHOOK_SECRET:'independent-v1-history-signature-secret-thirty-two',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',BETTER_AUTH_SECRET:'local-history-auth-secret-at-least-thirty-two-characters',MINI_APP_URL:'https://lowwin.test',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'transactions',PHONE_CONTACT_KEYS:JSON.stringify({'transactions':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64)});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database});await db.referralPolicy.upsert({where:{id:'default'},create:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-transactions-owner'},update:{enabled:true}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 async function external(user:string,options:{batch?:boolean;late?:boolean;failed?:boolean;v1?:boolean}={}){
  if(options.v1)await db.telegramOwnContact.update({where:{userId:user},data:{phoneCipher:encryptPhone('+251911652904',contactBotId())}});
  let created:ChapaCreate|ChapaDirectCreate|null=null;const reference='CH'+randomUUID().replaceAll('-','');
  const transport:ChapaTransport={
   create:vi.fn(async input=>{created=input;return {status:'success',data:{checkout_url:`https://checkout.chapa.co/${reference}`,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()}}}),
   direct:vi.fn(async input=>{created=input;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'req-'+reference,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()}}}),
   lookup:vi.fn(async()=>({status:'success',data:options.v1?{tx_ref:created!.merchantReference,reference,amount:(Number(created!.amountCents)/100).toFixed(2),currency:'ETB',mode:'test',status:options.failed?'failed':'success',payment_method:'telebirr'}:{merchant_reference:created!.merchantReference,chapa_reference:reference,amount:Number(created!.amountCents),currency:'ETB',mode:'test',status:options.failed?'FAILED':'SUCCESS',payment_method:'telebirr',customer:{phone_number:'251911652904'}}})),
   validate:vi.fn(async()=>({status:'success',data:{status:'SUCCESS'}})),
   methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true}}}}}]})),
  };
  let order;
  if(options.batch){
   const auction=await realReferralAuction(db,10,options.late?1400:3600000),quote=await quoteBidBatch(db,user,{key:randomUUID(),auctionSlug:auction.slug,numbers:['2','3','4'],feeVersion:1});
   order=await createDirectCheckout(db,user,{key:randomUUID(),purpose:'BID',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},undefined,transport);
   if(options.late)await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+30)));
  }else order=options.v1?await createChapaCheckout(db,user,{key:randomUUID(),purpose:'TOP_UP',amount:'20'},undefined,transport):await createDirectCheckout(db,user,{key:randomUUID(),purpose:'TOP_UP',amount:'20',paymentMethod:'telebirr',phone:'0911652904'},undefined,transport);
  return {order,verify:async()=>{await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(0),leaseUntil:null}});return verifyChapaCheckout(db,order.id,user,undefined,transport)}};
 }
 it('shows a verified v1 hosted deposit with only the v1 schema gate enabled',async()=>{
  const user=(await verifiedReferralUser(db)).id,paid=await external(user,{v1:true});expect((await paid.verify()).status).toBe('CREDITED');
  vi.stubEnv('CHAPA_SCHEMA_READY','false');
  try{expect((await getTransactions(db,user,{type:'TOP_UP'})).items).toEqual([expect.objectContaining({id:paid.order.id,source:'chapa',amount:'20',direction:'incoming',summary:'done'})]);expect(await reconcile(db)).toEqual([])}finally{vi.stubEnv('CHAPA_SCHEMA_READY','true')}
 });
 it('nets wallet coupons using committed receipts and exposes separate owned details without mutating money',async()=>{
  const user=(await verifiedReferralUser(db)).id;await creditDevelopmentPoints(db,user,'200',randomUUID());const coupon=(await earnedReferralCoupon(db,user)).coupon,auction=await realReferralAuction(db,20);
  await submitBid(db,{userId:user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,couponId:coupon.id,key:randomUUID()});const journals=await db.journal.count(),page=await getTransactions(db,user);
  expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({source:'wallet',type:'BID',amount:'18',direction:'outgoing',summary:'done',paymentMethod:'Wallet'});expect(page.items[0]).not.toHaveProperty('references');expect(page.items[0]).not.toHaveProperty('userId');
  expect((await getWalletTransaction(db,user,page.items[0].id)).item).toMatchObject({grossFee:'20',discountPoints:'2',amount:'18',bidNumber:'2',currency:'ETB'});expect(await db.journal.count()).toBe(journals);expect(await reconcile(db)).toEqual([]);
 });
 it('globally paginates both sources and applies search/type before page boundaries',async()=>{
  const user=(await verifiedReferralUser(db)).id,other=(await verifiedReferralUser(db)).id;await creditDevelopmentPoints(db,user,'100',randomUUID());const auction=await realReferralAuction(db,1);
  await submitBid(db,{userId:user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});
  const wallet=(await getTransactions(db,user)).items[0];for(let index=0;index<21;index++)await external(user);await external(other);
  const one=await getTransactions(db,user),two=await getTransactions(db,user,{page:2}),all=[...one.items,...two.items];
  expect(one.items).toHaveLength(20);expect(one.nextPage).toBe(2);expect(two.items).toHaveLength(2);expect(two.nextPage).toBeNull();expect(new Set(all.map(row=>`${row.source}:${row.id}`)).size).toBe(22);expect(all.some(row=>row.source==='wallet')).toBe(true);expect(all.map(row=>row.createdAt)).toEqual(all.map(row=>row.createdAt).sort().reverse());
  expect((await getTransactions(db,user,{q:wallet.id})).items.map(row=>row.id)).toEqual([wallet.id]);expect((await getTransactions(db,user,{type:'BID'})).items).toHaveLength(1);expect((await getTransactions(db,user,{type:'TOP_UP'})).items).toHaveLength(20);expect((await getTransactions(db,user,{q:'%'})).items).toEqual([]);
  expect(JSON.stringify(one)).not.toContain('merchantReference');expect(JSON.stringify(one)).not.toContain('receipt');expect(JSON.stringify(one)).not.toContain(other);
 });
 it('counts a verified external batch once, excluding each of its three wallet fee journals',async()=>{
  const user=(await verifiedReferralUser(db)).id,paid=await external(user,{batch:true});expect((await paid.verify()).status).toBe('BID_ACCEPTED');const page=await getTransactions(db,user);expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({source:'chapa',type:'BID',amount:'30',summary:'done',direction:'outgoing',fundsPreserved:false});const bids=await db.bid.findMany({where:{userId:user}});expect(bids).toHaveLength(3);await expect(getWalletTransaction(db,user,bids[0].id)).rejects.toMatchObject({status:404});expect(await reconcile(db)).toEqual([]);
 });
 it('keeps unverified attempts checking and verified failures separate from completed deposits',async()=>{
  const user=(await verifiedReferralUser(db)).id,pending=await external(user),failed=await external(user,{failed:true}),paid=await external(user);await failed.verify();await paid.verify();const page=await getTransactions(db,user),byId=new Map(page.items.map(row=>[row.id,row]));
  expect(byId.get(pending.order.id)).toMatchObject({summary:'checking',direction:'none'});expect(byId.get(failed.order.id)).toMatchObject({summary:'failed',direction:'none'});expect(byId.get(paid.order.id)).toMatchObject({summary:'done',direction:'incoming'});
 });
 it('reports late verified bid funds as incoming wallet funds without inventing an accepted bid',async()=>{
  const user=(await verifiedReferralUser(db)).id,paid=await external(user,{batch:true,late:true});expect((await paid.verify()).fundsPreserved).toBe(true);expect((await getTransactions(db,user)).items).toEqual([expect.objectContaining({source:'chapa',type:'BID',summary:'done',direction:'incoming',fundsPreserved:true})]);expect(await db.bid.count({where:{userId:user}})).toBe(0);
 });
 it('requires a session, rejects ownership overrides, and protects list/detail responses from shared caches',async()=>{
  const user=await verifiedReferralUser(db),other=await verifiedReferralUser(db);await creditDevelopmentPoints(db,user.id,'100',randomUUID());const auction=await realReferralAuction(db,1);await submitBid(db,{userId:user.id,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});const row=(await getTransactions(db,user.id)).items[0];
  await expect(getWalletTransaction(db,other.id,row.id)).rejects.toMatchObject({status:404});
  const {handleAuth}=await import('../src/modules/auth/handler'),login=await handleAuth(new Request('https://lowwin.test/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'https://lowwin.test','content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:user.telegramId,first_name:'Transactions fixture'})})})}));expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0],{GET}=await import('../src/app/api/transactions/route'),detail=await import('../src/app/api/transactions/wallet/[id]/route');
  const response=await GET(new Request('https://lowwin.test/api/transactions',{headers:{cookie}}));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');expect((await response.json()).items).toHaveLength(1);
  const shown=await detail.GET(new Request('https://lowwin.test/api/transactions/wallet/'+row.id,{headers:{cookie}}),{params:Promise.resolve({id:row.id})});expect(shown.status).toBe(200);expect(shown.headers.get('cache-control')).toContain('no-store');expect(shown.headers.get('vary')).toBe('Cookie');expect((await GET(new Request('https://lowwin.test/api/transactions'))).status).toBe(401);expect((await GET(new Request(`https://lowwin.test/api/transactions?userId=${other.id}`,{headers:{cookie}}))).status).toBe(422);
 });
});
describe('transaction query bounds',()=>{
 it('rejects invalid filters, ownership overrides, oversized queries and excessive pages',()=>{for(const input of [{page:0},{page:1001},{type:'pending'},{q:'a'.repeat(101)},{userId:'other'}])expect(()=>transactionsQuerySchema.parse(input)).toThrow()});
});
