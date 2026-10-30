import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomInt,randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {publishFixtureResult} from './publish-result-fixture';
import {closeAuction,cancelAuction} from '../src/modules/auctions/settlement';
import {getPersonalBids} from '../src/modules/profile/personal';
import {reconcile} from '../src/modules/wallet/ledger';
import {verifyFixtureContact} from './contact-fixtures';
import {signedLaunch,TEST_TOKEN} from './helpers';

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('accepted My Bids accuracy on isolated PostgreSQL',()=>{
 let db:PrismaClient,first:string,second:string,secondTelegramId:number,live:Awaited<ReturnType<typeof bidAuction>>,ownProviderBid:string,wrongOwnerBid:string,providerRef:string;
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback *_test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'my-bids-fixture',PHONE_CONTACT_KEYS:JSON.stringify({'my-bids-fixture':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),ARIFPAY_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();
  first=await bidUser(db,'2000');second=await bidUser(db,'2000');secondTelegramId=randomInt(4000000000,5000000000);
  for(const [userId,telegramId] of [[first,randomInt(4000000000,5000000000)],[second,secondTelegramId]] as const){await db.user.update({where:{id:userId},data:{telegramId:String(telegramId)}});await verifyFixtureContact(db,telegramId)}
  live=await bidAuction(db,{ruleVersion:'lowest-unique-v4',fee:2,isDemo:false});
  const accepted:Awaited<ReturnType<typeof submitBid>>[]=[];
  for(let amount=1;amount<=25;amount++)accepted.push(await submitBid(db,{userId:first,auctionSlug:live.slug!,amount:String(amount),key:randomUUID(),feeVersion:1}));
  ownProviderBid=accepted[0].bid.id;wrongOwnerBid=accepted[1].bid.id;providerRef='fixture-provider-'+randomUUID();
  const winner=await bidAuction(db,{fee:3,isDemo:false,endDelayMs:1800});await submitBid(db,{userId:first,auctionSlug:winner.slug!,amount:'4',key:randomUUID()});await submitBid(db,{userId:second,auctionSlug:winner.slug!,amount:'5',key:randomUUID()});
  const cancelled=await bidAuction(db,{fee:4,isDemo:false});await submitBid(db,{userId:first,auctionSlug:cancelled.slug!,amount:'8',key:randomUUID()});await cancelAuction(db,{auctionId:cancelled.id,actor:{id:'fixture-owner',permission:'auction:cancel'},reason:'Isolated My Bids cancellation fixture',key:randomUUID()});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,winner.endsAt!.getTime()-Date.now()+30)));await closeAuction(db,winner.id);await publishFixtureResult(db,winner.id);await publishFixtureResult(db,cancelled.id);
  const credit=(userId:string)=>db.journal.findFirstOrThrow({where:{kind:'DEV_CREDIT',operation:{userId}},select:{id:true}});
  for(const [userId,bidId,amount,transactionId] of [[first,ownProviderBid,'1',providerRef],[second,wrongOwnerBid,'2','other-customer-secret-reference-'+randomUUID()]] as const){const journal=await credit(userId);await db.arifPayCheckout.create({data:{userId,auctionId:live.id,auctionSlug:live.slug!,key:randomUUID(),requestHash:'fixture-read-projection',bidNumber:amount,feeVersion:1,fee:2,channel:'TELEBIRR',phoneCipher:'private-fixture-cipher',phoneHash:'private-fixture-hash',nonce:randomUUID(),sessionId:randomUUID(),transactionId,status:'BID_ACCEPTED',creditJournalId:journal.id,bidId,expiresAt:new Date(Date.now()+600000)}})}
  await db.arifPayCheckout.create({data:{userId:first,auctionId:live.id,auctionSlug:live.slug!,key:randomUUID(),requestHash:'failed-attempt-must-not-count',bidNumber:'999',feeVersion:1,fee:2,channel:'MPESA',phoneCipher:'failed-attempt-private-cipher',phoneHash:'failed-attempt-private-hash',nonce:randomUUID(),status:'FAILED',expiresAt:new Date(Date.now()+600000)}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 it('counts accepted records globally, excludes failed attempts and pages newest-first 20+7',async()=>{
  const firstPage=await getPersonalBids(db,first,{page:1}),next=await getPersonalBids(db,first,{page:2}),active=await getPersonalBids(db,first,{view:'live'}),history=await getPersonalBids(db,first,{view:'history'});
  expect(firstPage.counts).toEqual({total:27,active:25,won:1,live:25,history:2});expect(next.counts).toEqual(firstPage.counts);expect(firstPage.pageSize).toBe(20);expect(firstPage.totalPages).toBe(2);expect(firstPage.items).toHaveLength(20);expect(next.items).toHaveLength(7);expect(new Set([...firstPage.items,...next.items].map(row=>row.id)).size).toBe(27);
  const all=[...firstPage.items,...next.items];expect(all.map(row=>row.acceptedAt)).toEqual(all.map(row=>row.acceptedAt).sort().reverse());expect(all.some(row=>row.amount==='999')).toBe(false);expect(all.filter(row=>row.outcome==='WON')).toHaveLength(1);expect(active.total).toBe(25);expect(active.counts).toEqual(firstPage.counts);expect(active.items.every(row=>row.outcome==='LIVE')).toBe(true);expect(history.total).toBe(2);expect(history.items.some(row=>row.outcome==='CANCELLED')).toBe(true);
  expect((await getPersonalBids(db,second)).counts).toEqual({total:1,active:0,won:0,live:0,history:1});
 });
 it('projects only supported own payment evidence, never a gateway flow for other wallet bids',async()=>{
  const pages=await Promise.all([getPersonalBids(db,first,{page:1}),getPersonalBids(db,first,{page:2})]),rows=pages.flatMap(page=>page.items);
  expect(rows.find(row=>row.id===ownProviderBid)?.payment).toEqual({checkoutId:null,status:'PAID',method:'ARIFPAY_TELEBIRR',transactionRef:providerRef});expect(rows.find(row=>row.id===wrongOwnerBid)?.payment).toEqual({checkoutId:null,status:'PAID',method:'WALLET',transactionRef:null});expect(rows.filter(row=>row.id!==ownProviderBid).every(row=>row.payment.method==='WALLET'&&row.payment.transactionRef===null)).toBe(true);
  const payload=JSON.stringify(pages);for(const privateValue of [second,'private-fixture-cipher','private-fixture-hash','other-customer-secret-reference','failed-attempt-private-cipher'])expect(payload).not.toContain(privateValue);
  expect(await reconcile(db)).toEqual([]);
 });
 it('keeps 20-record ownership checks on the actual authenticated route and rejects user overrides',async()=>{
  const telegramId=secondTelegramId;
  const {handleAuth}=await import('../src/modules/auth/handler'),auth=await handleAuth(new Request('http://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'My Bids private API fixture'})})})}));expect(auth.status).toBe(200);const cookie=auth.headers.get('set-cookie')!.split(';')[0];
  const {GET}=await import('../src/app/api/my-bids/route'),own=await GET(new Request('http://localhost:3000/api/my-bids?view=all&page=1',{headers:{cookie}}));expect(own.status).toBe(200);expect(own.headers.get('cache-control')).toContain('no-store');expect(own.headers.get('vary')).toBe('Cookie');const data=await own.json();expect(data.counts.total).toBe(1);expect(data.items.every((row:{id:string})=>row.id!==ownProviderBid&&row.id!==wrongOwnerBid)).toBe(true);
  expect((await GET(new Request(`http://localhost:3000/api/my-bids?userId=${first}`,{headers:{cookie}}))).status).toBe(422);expect((await GET(new Request('http://localhost:3000/api/my-bids'))).status).toBe(401);
 });
});
