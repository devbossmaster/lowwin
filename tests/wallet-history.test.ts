import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {getWalletHistory,walletHistoryQuerySchema} from '../src/modules/wallet/history';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {bidAuction} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {cancelAuction} from '../src/modules/auctions/settlement';
import {quoteBidBatch} from '../src/modules/auctions/batch';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {createChapaCheckout,verifyChapaCheckout} from '../src/modules/payments/chapa';
import {createDirectCheckout} from '../src/modules/payments/chapa-direct';
import type {ChapaCreate,ChapaDirectCreate,ChapaTransport} from '../src/modules/payments/chapa-provider';
import {signedLaunch,TEST_TOKEN} from './helpers';
import {contactBotId,encryptPhone} from '../src/modules/auth/own-contact';

const database=process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('private confirmed wallet history on isolated PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(database!);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'true',WALLET_BIDS_ENABLED:'true',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'wallet-history',PHONE_CONTACT_KEYS:JSON.stringify({'wallet-history':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64)});
  Object.assign(process.env,{BETTER_AUTH_SECRET:'fixture-only-wallet-history-auth-secret-at-least-thirty-two',CHAPA_V1_MODE:'test',CHAPA_V1_SCHEMA_READY:'true',CHAPA_V1_ENABLED:'true',CHAPA_V1_RECOVERY_ENABLED:'true',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_WEBHOOK_SECRET:'local-v1-history-signature-secret-thirty-two-characters',CHAPA_V1_BASE_URL:'https://api.chapa.co'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database});await db.referralPolicy.upsert({where:{id:'default'},create:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-history-owner'},update:{enabled:true}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 async function external(user:string,options:{batch?:boolean;coupon?:boolean;late?:boolean}={}){
  let created:ChapaCreate|ChapaDirectCreate|null=null,status='SUCCESS';const reference='CH'+randomUUID().replaceAll('-','');
  const transport:ChapaTransport={
   create:vi.fn(async input=>{created=input;return {status:'success',data:{checkout_url:`https://checkout.chapa.co/${reference}`}}}),
   direct:vi.fn(async input=>{created=input;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'req-'+reference,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()}}}),
   lookup:vi.fn(async()=>({status:'success',data:options.batch?{merchant_reference:created!.merchantReference,chapa_reference:reference,amount:Number(created!.amountCents),currency:'ETB',mode:'test',status,payment_method:'telebirr',customer:{phone_number:'251911652904'}}:{tx_ref:created!.merchantReference,reference,amount:(Number(created!.amountCents)/100).toFixed(2),currency:'ETB',mode:'test',status:status.toLowerCase(),method:'telebirr'}})),
   validate:vi.fn(async()=>({status:'success',data:{status:'SUCCESS'}})),
   methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true}}}}}]})),
  };
  let order;
  if(options.batch){
   const auction=await realReferralAuction(db,10,options.late?1400:3600000),coupon=options.coupon?(await earnedReferralCoupon(db,user)).coupon:null,quote=await quoteBidBatch(db,user,{key:randomUUID(),auctionSlug:auction.slug,numbers:['2','3','4'],feeVersion:1,...(coupon?{couponId:coupon.id}:{})});
   order=await createDirectCheckout(db,user,{key:randomUUID(),purpose:'BID',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},undefined,transport);
   if(options.late)await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+30)));
  }else{await db.telegramOwnContact.update({where:{userId:user},data:{phoneCipher:encryptPhone('+251911652904',contactBotId())}});order=await createChapaCheckout(db,user,{key:randomUUID(),purpose:'TOP_UP',amount:'20'},undefined,transport)}
  return {order,verify:async()=>{await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(0),leaseUntil:null}});return verifyChapaCheckout(db,order.id,user,undefined,transport)},status:(value:string)=>{status=value}};
 }
 it('includes only confirmed deposits and not unpaid or failed attempts',async()=>{
  const user=(await verifiedReferralUser(db)).id,first=await external(user);expect((await getWalletHistory(db,user)).items).toEqual([]);first.status('FAILED');await first.verify();expect((await getWalletHistory(db,user)).items).toEqual([]);
  const paid=await external(user);await paid.verify();const result=await getWalletHistory(db,user,{type:'topup'});expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({type:'topup',kind:'TOP_UP',delta:'20',status:'confirmed'});expect(Object.keys(result.items[0]).sort()).toEqual(['at','delta','id','kind','status','type']);
 });
 it('nets an earned coupon into the wallet fee and preserves exact refunds and holds',async()=>{
  const user=(await verifiedReferralUser(db)).id;await creditDevelopmentPoints(db,user,'200',randomUUID());const coupon=(await earnedReferralCoupon(db,user)).coupon,auction=await realReferralAuction(db,20);
  await submitBid(db,{userId:user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,couponId:coupon.id,key:randomUUID()});
  expect((await getWalletHistory(db,user,{type:'bid'})).items.map(row=>row.delta)).toEqual(['-18']);
  const legacy=await bidAuction(db,{fee:3,isDemo:false});await submitBid(db,{userId:user,auctionSlug:legacy.slug!,amount:'5',key:randomUUID()});await cancelAuction(db,{auctionId:legacy.id,actor:{id:'fixture-owner',permission:'auction:cancel'},reason:'Wallet history refund fixture',key:randomUUID()});
  expect((await getWalletHistory(db,user,{type:'refund'})).items).toEqual([expect.objectContaining({kind:'FEE_REFUND',delta:'3'})]);
  const all=await getWalletHistory(db,user);expect(all.items.some(row=>row.type==='hold'&&row.kind==='HOLD_RESERVE'&&row.delta==='-5')).toBe(true);expect(all.items.some(row=>row.type==='hold'&&row.kind==='HOLD_RELEASE'&&row.delta==='5')).toBe(true);expect(await reconcile(db)).toEqual([]);
 });
 it.each([false,true])('excludes an externally paid batch and all of its transit fees (coupon=%s)',async coupon=>{
  const user=(await verifiedReferralUser(db)).id,paid=await external(user,{batch:true,coupon});expect((await paid.verify()).status).toBe('BID_ACCEPTED');expect(await db.bid.count({where:{userId:user}})).toBe(3);expect((await getWalletHistory(db,user)).items).toEqual([]);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps verified late-bid funds as a genuine wallet credit without inventing accepted bids',async()=>{
  const user=(await verifiedReferralUser(db)).id,paid=await external(user,{batch:true,late:true});expect(await paid.verify()).toMatchObject({status:'NEEDS_REVIEW',fundsPreserved:true});expect((await getWalletHistory(db,user,{type:'topup'})).items).toEqual([expect.objectContaining({type:'topup',kind:'PAYMENT_CREDIT',delta:'30'})]);expect(await db.bid.count({where:{userId:user}})).toBe(0);
 });
 it('bounds pages and enforces authentication, wallet ownership and private cache headers',async()=>{
  const user=await verifiedReferralUser(db),other=await verifiedReferralUser(db);await creditDevelopmentPoints(db,other.id,'9876',randomUUID());await creditDevelopmentPoints(db,user.id,'100',randomUUID());const auction=await realReferralAuction(db,1);
  for(let i=1;i<=21;i++)await submitBid(db,{userId:user.id,auctionSlug:auction.slug!,amount:String(i*2),feeVersion:1,key:randomUUID()});
  const one=await getWalletHistory(db,user.id,{type:'bid'}),two=await getWalletHistory(db,user.id,{type:'bid',page:2});expect(one.items).toHaveLength(20);expect(one.hasNext).toBe(true);expect(two.items).toHaveLength(1);expect(two.hasNext).toBe(false);expect(new Set([...one.items,...two.items].map(row=>row.id)).size).toBe(21);expect(JSON.stringify(one)).not.toContain(other.id);expect(JSON.stringify(one)).not.toContain('9876');
  const {handleAuth}=await import('../src/modules/auth/handler'),login=await handleAuth(new Request('https://lowwin.test/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'https://lowwin.test','content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:user.telegramId,first_name:'Wallet history fixture'})})})}));expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0],{GET}=await import('../src/app/api/wallet/history/route'),response=await GET(new Request('https://lowwin.test/api/wallet/history?type=bid&page=1',{headers:{cookie}}));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');expect((await response.json()).items).toHaveLength(20);
  expect((await GET(new Request('https://lowwin.test/api/wallet/history'))).status).toBe(401);expect((await GET(new Request(`https://lowwin.test/api/wallet/history?userId=${other.id}`,{headers:{cookie}}))).status).toBe(422);
 });
});
describe('wallet history query bounds',()=>{
 it('rejects invalid filters, account overrides and excessive pages',()=>{for(const input of [{page:0},{page:1001},{type:'pending'},{userId:'other'}])expect(()=>walletHistoryQuerySchema.parse(input)).toThrow()});
});
