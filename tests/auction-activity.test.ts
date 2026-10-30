import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {activityCodesSchema,readAuctionActivity,recordAuctionView} from '../src/modules/auctions/activity';
import {submitBid} from '../src/modules/auctions/bids';
import {processDueAuction} from '../src/modules/auctions/settlement';

it('bounds and deduplicates public activity codes',()=>{
 expect(activityCodesSchema.parse(['12','2','12'])).toEqual([2,12]);
 for(const codes of [[],['0'],['-1'],['2147483648'],Array(51).fill('1'),['private-slug']])expect(activityCodesSchema.safeParse(codes).success).toBe(false);
});

const url=process.env.ACTIVITY_TEST_DATABASE_URL;
describe.skipIf(!url)('live public activity on disposable PostgreSQL',()=>{
 let client:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(url!);
  if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Activity tests require disposable loopback *_test PostgreSQL.');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  client=new PrismaClient({datasourceUrl:url});
 },60000);
 afterAll(async()=>{await client?.$disconnect();const {db}=await import('../src/lib/db');await db.$disconnect()});

 it('returns only public aggregates and reads never increment views',async()=>{
  const auction=await bidAuction(client),codes=[auction.publicCode];
  const first=await readAuctionActivity(client,codes),second=await readAuctionActivity(client,codes);
  expect(first).toEqual(second);
  expect(first[0]).toMatchObject({code:String(auction.publicCode),views:'0',bids:0,bidders:0,status:'live',resultReady:false});
  expect(Object.keys(first[0]).sort()).toEqual(['bidders','bids','code','endsAt','resultReady','startsAt','status','views']);
 });

 it('counts people once when they place multiple accepted bids',async()=>{
  const auction=await bidAuction(client),first=await bidUser(client),second=await bidUser(client);
  await submitBid(client,{userId:first,auctionSlug:auction.slug!,amount:'4',key:randomUUID()});
  await submitBid(client,{userId:first,auctionSlug:auction.slug!,amount:'5',key:randomUUID()});
  await submitBid(client,{userId:second,auctionSlug:auction.slug!,amount:'6',key:randomUUID()});
  expect((await readAuctionActivity(client,[auction.publicCode]))[0]).toMatchObject({bids:3,bidders:2});
 });

 it('deduplicates concurrent views across numeric and legacy slug URLs',async()=>{
  const auction=await bidAuction(client);
  const recorded=await Promise.all(Array.from({length:20},(_,index)=>recordAuctionView(client,index%2?auction.slug!:String(auction.publicCode),'same-verified-viewer')));
  expect(recorded.every(value=>value&&/^\d+$/.test(value.views))).toBe(true);
  expect((await readAuctionActivity(client,[auction.publicCode]))[0].views).toBe('1');
  const unique=await Promise.all(Array.from({length:19},(_,index)=>recordAuctionView(client,String(auction.publicCode),`verified-viewer-${index}`)));
  expect(unique.every(value=>value?.counted)).toBe(true);
  expect((await client.auction.findUniqueOrThrow({where:{id:auction.id}})).publicViewCount).toBe(20n);
  expect(await recordAuctionView(client,'does-not-exist','verified-viewer')).toBeNull();
 });

 it('hides draft inventory, invisible products and invisible categories for both reads and increments',async()=>{
  const auction=await bidAuction(client),draft=await client.auction.create({data:{code:`PRIVATE-${randomUUID()}`}});
  expect(await readAuctionActivity(client,[draft.publicCode])).toEqual([]);
  expect(await recordAuctionView(client,String(draft.publicCode),'verified-viewer')).toBeNull();
  await client.product.update({where:{id:auction.productId!},data:{visible:false}});
  expect(await readAuctionActivity(client,[auction.publicCode])).toEqual([]);
  expect(await recordAuctionView(client,auction.slug!,'verified-viewer')).toBeNull();
  await client.product.update({where:{id:auction.productId!},data:{visible:true}});
  await client.category.update({where:{id:auction.categoryId!},data:{visible:false}});
  expect(await readAuctionActivity(client,[auction.publicCode])).toEqual([]);
  expect(await recordAuctionView(client,String(auction.publicCode),'verified-viewer')).toBeNull();
  expect((await client.auction.findUniqueOrThrow({where:{id:auction.id}})).publicViewCount).toBe(0n);
 });

 it('keeps a committed settlement private until its result is explicitly published',async()=>{
  const auction=await bidAuction(client,{endDelayMs:1800}),user=await bidUser(client);
  await submitBid(client,{userId:user,auctionSlug:auction.slug!,amount:'4',key:randomUUID()});
  expect((await readAuctionActivity(client,[auction.publicCode]))[0]).toMatchObject({bids:1,bidders:1,status:'live',resultReady:false});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+30)));
  expect((await readAuctionActivity(client,[auction.publicCode]))[0]).toMatchObject({status:'closing',resultReady:false});
  expect(await processDueAuction(client)).toMatchObject({status:'settled',auctionId:auction.id});
  expect((await readAuctionActivity(client,[auction.publicCode]))[0]).toMatchObject({status:'closed',resultReady:false});
  const settlement=await client.auctionSettlement.findUniqueOrThrow({where:{auctionId:auction.id}});
  expect(await client.resultPublication.count({where:{settlementId:settlement.id}})).toBe(0);
  // Publication is an explicit fixture fact, separate from automatic settlement.
  await client.resultPublication.create({data:{settlementId:settlement.id,proofHash:'synthetic-activity-publication',reason:'Reviewed result publication fixture'}});
  expect((await readAuctionActivity(client,[auction.publicCode]))[0]).toMatchObject({status:'closed',resultReady:true});
  expect(await client.auctionSettlement.count({where:{auctionId:auction.id}})).toBe(1);
  expect(await processDueAuction(client)).toEqual({status:'idle'});
 });

 it('serves uncached aggregate responses and rejects oversized or invalid requests',async()=>{
  const auction=await bidAuction(client),{GET}=await import('../src/app/api/catalog/activity/route');
  const response=await GET(new Request(`http://localhost/api/catalog/activity?codes=${auction.publicCode}`));
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await response.json()).items).toHaveLength(1);
  for(const codes of ['', '0', '2147483648', Array(51).fill('1').join(',')])expect((await GET(new Request(`http://localhost/api/catalog/activity?codes=${codes}`))).status).toBe(422);
 });
});
