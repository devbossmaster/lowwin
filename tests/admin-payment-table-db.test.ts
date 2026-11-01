import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {creditDevelopmentPoints} from '../src/modules/wallet/ledger';
import {submitBid} from '../src/modules/auctions/bids';
import {createChapaCheckout,verifyChapaCheckout} from '../src/modules/payments/chapa';
import type {ChapaCreate,ChapaTransport} from '../src/modules/payments/chapa-provider';
import {readChapaTable} from '../src/modules/admin/master-table-read';

const database=process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('combined admin payments on isolated PostgreSQL',()=>{
 let db:PrismaClient,userId:string,queryName:string,walletBidId:string,chapaBidId:string,couponBidId:string;
 const actor={id:'isolated-payment-auditor',role:'OWNER' as const,now:new Date()},base={page:1,q:'',status:'',sort:'newest' as const};
 beforeAll(async()=>{
  const target=new URL(database!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback admin payment database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',CHAPA_SCHEMA_READY:'true',CHAPA_MODE:'test',CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'local-admin-payments-signature-secret-thirty-two',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',TELEGRAM_BOT_TOKEN:'123456789:test_token',TELEGRAM_BOT_USERNAME:'lowwin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'local-admin-payments-contact-secret-thirty-two',PHONE_CONTACT_KEY_ID:'admin-payments-test',PHONE_CONTACT_KEYS:JSON.stringify({'admin-payments-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true',CHAPA_PAYMENT_ALERT_TELEGRAM_ID:''});
  db=new PrismaClient({datasourceUrl:database});
  await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:actor.id}});
  queryName='Admin payment table '+randomUUID();userId=(await verifiedReferralUser(db,queryName)).id;base.q=queryName;
  await creditDevelopmentPoints(db,userId,'5000','wallet-table-'+randomUUID());
  const auction=await realReferralAuction(db,50);
  for(let index=0;index<26;index++){
   const receipt=await submitBid(db,{userId,auctionSlug:auction.slug!,feeVersion:1,amount:(10+index*.02).toFixed(2),key:randomUUID()});
   walletBidId=receipt.bid.id;
  }
  const {coupon}=await earnedReferralCoupon(db,userId);
  couponBidId=(await submitBid(db,{userId,auctionSlug:auction.slug!,feeVersion:1,amount:'20.01',couponId:coupon.id,key:randomUUID()})).bid.id;
  async function chapa(purpose:'BID'|'TOP_UP',status='SUCCESS'){
   let initialized:ChapaCreate|undefined;const reference='CH'+randomUUID().replaceAll('-','');
   const transport:ChapaTransport={create:vi.fn(async input=>{initialized=input;return {status:'success',data:{checkout_url:'https://checkout.chapa.global/'+reference}}}),lookup:vi.fn(async()=>({status:'success',data:{status,merchant_reference:initialized!.merchantReference,chapa_reference:reference,amount:Number(initialized!.amountCents),currency:'ETB',mode:'test',payment_method:'telebirr',processor_reference:'SYNTHETIC-'+reference}})),methods:vi.fn()};
   const input=purpose==='BID'?{key:randomUUID(),purpose,auctionSlug:auction.slug!,amount:'30.01',feeVersion:1}:{key:randomUUID(),purpose,amount:'100'};
   const order=await createChapaCheckout(db,userId,input,undefined,transport);
   if(status==='PENDING')return order;
   await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(0)}});
   return verifyChapaCheckout(db,order.id,userId,undefined,transport);
  }
  const paidBid=await chapa('BID');chapaBidId=(await db.chapaCheckout.findUniqueOrThrow({where:{id:paidBid.id},select:{bidId:true}})).bidId!;
  await chapa('TOP_UP');await chapa('TOP_UP','PENDING');await chapa('TOP_UP','FAILED');
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 it('globally paginates wallet fees and Chapa payments without duplicating a Chapa-funded bid',async()=>{
  const first=await readChapaTable(db,actor,base),second=await readChapaTable(db,actor,{...base,page:2});
  expect(first.total).toBe(29);expect(first.items).toHaveLength(25);expect(second.items).toHaveLength(4);
  const rows=[...first.items,...second.items];expect(new Set(rows.map(row=>row.source+':'+row.id)).size).toBe(29);
  expect(rows.filter(row=>row.source==='wallet')).toHaveLength(27);expect(rows.filter(row=>row.source==='chapa')).toHaveLength(2);
  expect(rows.filter(row=>row.bidId===chapaBidId)).toHaveLength(1);expect(rows.find(row=>row.id===walletBidId)?.amount).toBe('50');
  expect(rows.find(row=>row.id===couponBidId)?.amount).toBe('45');
  expect(rows.every((row,index)=>index===0||rows[index-1].createdAt>=row.createdAt)).toBe(true);
 });
 it('applies purpose and outcome filters across the combined source before counting',async()=>{
  expect((await readChapaTable(db,actor,{...base,purpose:'BID'})).total).toBe(28);
  expect((await readChapaTable(db,actor,{...base,purpose:'TOP_UP'})).total).toBe(1);
  for(const view of ['unfinished','failed'] as const){const result=await readChapaTable(db,actor,{...base,view});expect(result.total).toBe(1);expect(result.items[0].source).toBe('chapa')}
  expect((await readChapaTable(db,actor,{...base,view:'all'})).total).toBe(31);
 });
 it('sorts gross-independent net amounts correctly and keeps Support journal references private',async()=>{
  const result=await readChapaTable(db,{...actor,role:'SUPPORT'},{...base,sort:'amount'});
  expect(result.items[0].amount).toBe('100.00');expect(result.items.every(row=>row.journalId===null)).toBe(true);
  const ascending=await readChapaTable(db,actor,{...base,sort:'oldest'});expect(ascending.items[0].source).toBe('wallet');
  const exact=await readChapaTable(db,actor,{...base,q:couponBidId});expect(exact.total).toBe(1);expect(exact.items[0].amount).toBe('45');
 });
 it('keeps wallet payments available when Chapa storage is explicitly unavailable',async()=>{
  const scoped=await readChapaTable(db,actor,{...base,q:walletBidId});
  vi.stubEnv('CHAPA_SCHEMA_READY','false');
  try{const result=await readChapaTable(db,actor,{...base,q:walletBidId});expect(result.chapaConfigured).toBe(false);expect(result.items[0]).toMatchObject({id:scoped.items[0].id,provider:'Wallet',amount:'50'})}finally{vi.unstubAllEnvs()}
 });
});
