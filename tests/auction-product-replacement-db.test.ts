import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {verifiedAdminFixture} from './admin-auth-fixture';
import {realReferralAuction,verifiedReferralUser} from './referral-fixtures';
import {TEST_TOKEN} from './helpers';
import type {ChapaDirectCreate,ChapaTransport} from '../src/modules/payments/chapa-provider';

const url=process.env.AUCTION_REPLACEMENT_TEST_DATABASE_URL;
const origin='https://lowwin.test';

describe.skipIf(!url)('published auction product replacement on disposable PostgreSQL',()=>{
 let db:PrismaClient;
 let admin:typeof import('../src/app/api/admin/[...path]/route');
 let adminCookie:string;

 beforeAll(async()=>{
  const target=new URL(url!);
  if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Loopback test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',
   BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'fixture-replacement-admin-secret-at-least-thirty-two',
   TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-replacement-webhook-at-least-thirty-two',
   PHONE_CONTACT_KEY_ID:'replacement',PHONE_CONTACT_KEYS:JSON.stringify({replacement:'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),
   DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',WALLET_BIDS_ENABLED:'true',REDIS_URL:'',
   REFERRAL_REWARDS_SCHEMA_READY:'false',PAYMENTS_LIVE_ENABLED:'false',CHAPA_LIVE_ENABLED:'false',CHAPA_MODE:'test',CHAPA_ENABLED:'true',
   CHAPA_SCHEMA_READY:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'',
   CHAPA_WEBHOOK_SECRET:'c'.repeat(64),PAYMENT_GATEWAY:'CHAPA'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:url});
  admin=await import('../src/app/api/admin/[...path]/route');
  const {handleAuth}=await import('../src/modules/auth/handler');
  ({cookie:adminCookie}=await verifiedAdminFixture(db,handleAuth,{email:`replace-${randomUUID()}@lowin.test`,password:'Replacement-fixture-12345',origin}));
 },60000);

 afterAll(async()=>{await db?.$disconnect();await (await import('../src/lib/db')).db.$disconnect()});

 function replace(input:unknown,cookie=adminCookie){
  const request=new Request(origin+'/api/admin/command',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({action:'replaceProduct',input})});
  return admin.POST(request,{params:Promise.resolve({path:['command']})});
 }

 it('keeps the same accepted bid and in-flight payment while switching catalog and checkout to the new prize',async()=>{
  const {getAuction}=await import('../src/modules/auctions/catalog');
  const {submitBid}=await import('../src/modules/auctions/bids');
  const {creditDevelopmentPoints}=await import('../src/modules/wallet/ledger');
  const {quoteBidBatch}=await import('../src/modules/auctions/batch');
  const {createCurrentDirectCheckout}=await import('../src/modules/payments/chapa-inline');
  const {getChapaCheckout,verifyChapaCheckout}=await import('../src/modules/payments/chapa');
  const auction=await realReferralAuction(db,50);
  const bidder=await verifiedReferralUser(db);
  const payer=await verifiedReferralUser(db);
  await creditDevelopmentPoints(db,bidder.id,'100',randomUUID());
  const accepted=await submitBid(db,{userId:bidder.id,auctionSlug:auction.slug!,amount:'4.00',feeVersion:1,key:randomUUID()});
  const savedBid=await db.bid.findUniqueOrThrow({where:{id:accepted.bid.id},include:{operation:{select:{result:true,journal:{select:{id:true}}}}}});

  const quote=await quoteBidBatch(db,payer.id,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['5.00'],feeVersion:1});
  const providerReference='CH'+randomUUID();
  const direct=vi.fn(async (_input:ChapaDirectCreate)=>({status:'success',data:{auth_type:'USSD',chapa_reference:providerReference,payment_status:'PENDING',request_id:'req-'+providerReference}}));
  const lookup=vi.fn(async (merchantReference:string)=>({status:'success',data:{merchant_reference:merchantReference,chapa_reference:providerReference,amount:5000,currency:'ETB',status:'SUCCESS',payment_method:'telebirr',mode:'test'}}));
  const transport:ChapaTransport={create:vi.fn(),direct,lookup,methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]}))};
  const {order}=await createCurrentDirectCheckout(db,payer.id,{key:randomUUID(),purpose:'BID',flow:'DIRECT',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},undefined,transport);
  const originalCheckout=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(originalCheckout.auctionId).toBe(auction.id);

  const suffix=randomUUID().slice(0,8);
  const category=await db.category.create({data:{name:`Audio ${suffix}`,slug:`prize-audio-${suffix}`,description:'Replacement item category'}});
  const product=await db.product.create({data:{title:'Soundcore R50i NC',titleAm:'Soundcore R50i NC የጆሮ ማዳመጫ',slug:`prize-soundcore-${suffix}`,description:'Replacement earbuds',condition:'New',categoryId:category.id,images:{create:{path:'/catalog/soundcore-test.svg',alt:'Soundcore earbuds',sortOrder:0}}}});
  const input={auctionId:auction.id,version:auction.controlVersion,productId:product.id,reason:'Replace the displayed and fulfilled auction item',confirmation:auction.code,key:randomUUID()};
  await expect(db.auction.update({where:{id:auction.id},data:{productId:product.id,categoryId:category.id}})).rejects.toThrow();
  expect((await replace(input,'')).status).toBe(401);
  expect((await replace({...input,confirmation:'wrong code'})).status).toBe(422);
  await db.product.update({where:{id:product.id},data:{visible:false}});
  expect((await replace(input)).status).toBe(422);
  await db.product.update({where:{id:product.id},data:{visible:true}});
  const first=await replace(input);
  const receipt=await first.json();
  expect(first.status,JSON.stringify(receipt)).toBe(200);
  expect(receipt).toMatchObject({auctionId:auction.id,productId:product.id,categoryId:category.id,controlVersion:auction.controlVersion+1,acceptedBids:1});
  expect(await (await replace(input)).json()).toEqual(receipt);
  expect((await replace({...input,key:randomUUID()})).status).toBe(409);

  const revisions=await db.auctionControlRevision.findMany({where:{auctionId:auction.id,kind:'PRODUCT_REPLACEMENT'}});
  expect(revisions).toHaveLength(1);
  expect(revisions[0]).toMatchObject({before:{productId:auction.productId},after:{productId:product.id,categoryId:category.id}});
  expect(await db.auction.findUniqueOrThrow({where:{id:auction.id}})).toMatchObject({publicCode:auction.publicCode,slug:auction.slug,startsAt:auction.startsAt,endsAt:auction.endsAt,acceptedBidCount:1});
  expect(await db.bid.findUniqueOrThrow({where:{id:savedBid.id},include:{operation:{select:{result:true,journal:{select:{id:true}}}}}})).toEqual(savedBid);
  expect(await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).toEqual(originalCheckout);
  expect(await getAuction(String(auction.publicCode))).toMatchObject({product:{title:product.title,images:[{path:'/catalog/soundcore-test.svg'}]},category:{slug:category.slug},terms:{version:1,entryFeePoints:'50'},bidCount:1,prizeUpdatedAt:revisions[0].createdAt.toISOString()});
  expect(await getChapaCheckout(db,payer.id,order.id)).toMatchObject({auctionTitle:product.title,auctionTitleAm:product.titleAm,feeVersion:1,merchantReference:order.merchantReference});

  await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(0)}});
  await verifyChapaCheckout(db,order.id,payer.id,undefined,transport,true);
  expect(await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).toMatchObject({status:'BID_ACCEPTED',auctionId:auction.id,amountCents:5000n,merchantReference:originalCheckout.merchantReference});
  expect(await db.bid.count({where:{auctionId:auction.id}})).toBe(2);
  expect(await db.auctionRefund.count({where:{userId:{in:[bidder.id,payer.id]}}})).toBe(0);
  expect(direct).toHaveBeenCalledTimes(1);
 });
});
