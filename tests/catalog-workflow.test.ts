import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bidAuction} from './bid-fixtures';

const url=process.env.CATALOG_WORKFLOW_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('catalog workflow on disposable PostgreSQL',()=>{
 let client:PrismaClient,catalog:typeof import('../src/modules/auctions/catalog');
 const marker=`workflow-${randomUUID().slice(0,8)}`;
 const expected:{id:string;code:string;fee:number;category:string}[]=[];
 beforeAll(async()=>{
  const target=new URL(url!);
  if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Workflow tests require a disposable loopback *_test database');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,APP_ENV:'local',NODE_ENV:'test'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  client=new PrismaClient();catalog=await import('../src/modules/auctions/catalog');
  for(const fee of [30,10,10,80,100,1]){
   const auction=await bidAuction(client,{fee,ruleVersion:'lowest-unique-v4',endDelayMs:3600000});
   await client.product.update({where:{id:auction.productId!},data:{title:`${marker} item`,visible:fee!==1}});
   if(fee===100)await client.auctionFeeRevision.create({data:{auctionId:auction.id,version:2,feePoints:5,reason:'Local fixture fee revision'}});
   if(fee!==1){const category=await client.category.findUniqueOrThrow({where:{id:auction.categoryId!}});expected.push({id:auction.id,code:String(auction.publicCode),fee:fee===100?5:fee,category:category.slug})}
  }
 },60000);
 afterAll(async()=>{await client?.$disconnect();const {db}=await import('../src/lib/db');await db.$disconnect()});
 it('sorts the displayed revision before pagination, including stable ties',async()=>{
  for(const sort of ['fee-low','fee-high'] as const){
   const ordered=[...expected].sort((a,b)=>(sort==='fee-low'?a.fee-b.fee:b.fee-a.fee)||a.id.localeCompare(b.id));
   const now=await catalog.serverNow();const seen:string[]=[];
   for(let page=1;page<=3;page++){
    const result=await catalog.listAuctions({q:marker,status:'all',sort,page},now,2);
    expect(result.total).toBe(5);expect(result.totalPages).toBe(3);
    expect(result.items.map(item=>[item.code,Number(item.terms.entryFeePoints)])).toEqual(ordered.slice((page-1)*2,page*2).map(item=>[item.code,item.fee]));
    seen.push(...result.items.map(item=>item.code));
   }
   expect(new Set(seen).size).toBe(5);
  }
 });
 it('keeps fee ordering inside status, search and category filters',async()=>{
  const now=await catalog.serverNow();
  const query={q:marker,status:'live' as const,sort:'fee-low' as const,page:1,category:expected[0].category};
  const result=await catalog.listAuctions(query,now);
  expect(result.items.map(item=>item.code)).toEqual([expected[0].code]);
  expect(result.total).toBe(await catalog.countAuctions(query,now));
  const categories=await catalog.listCategories(now);
  expect(categories.find(item=>item.slug===query.category)?.counts.live).toBe(1);
  expect((await catalog.listAuctions({...query,sort:'ending',status:'all'},now)).items).toHaveLength(1);
  expect((await catalog.listAuctions({...query,status:'upcoming'},now)).total).toBe(0);
  expect((await catalog.listAuctions({...query,q:'no-such-item'},now)).items).toEqual([]);
  const closed=await catalog.listAuctions({...query,category:undefined,status:'closed'},new Date(now.getTime()+7200000));
  expect(closed.items).toHaveLength(5);expect(closed.items.every(item=>item.status==='closing'&&item.result===null)).toBe(true);
 });
 it('accepts fee sorts through the public endpoint without private fields',async()=>{
  const {GET}=await import('../src/app/api/catalog/auctions/route');
  const response=await GET(new Request(`http://localhost/api/catalog/auctions?q=${marker}&sort=fee-low`));
  expect(response.status).toBe(200);const body=await response.json();
  expect(body.items.map((item:{terms:{entryFeePoints:string}})=>Number(item.terms.entryFeePoints))).toEqual([5,10,10,30,80]);
  expect(JSON.stringify(body)).not.toMatch(/telegramId|walletId|bidderId|winningUserId|requestHash|frequency|uniqueHint/);
 });
 it('returns current public fees, complete totals and stable ten-card quick batches',async()=>{
  const now=await catalog.serverNow();
  const initial=await catalog.listQuickAuctions('live',1,now);
  expect(initial.total).toBe(5);expect(initial.pageSize).toBe(10);
  for(const item of expected){
   const quick=initial.items.find(row=>row.code===item.code)!;expect(quick.terms.entryFeePoints).toBe(String(item.fee));expect(quick.terms.version).toBe(item.fee===5?2:1);expect(quick.terms.ruleVersion).toBe('lowest-unique-v4');
  }
  for(let i=0;i<7;i++)await bidAuction(client,{fee:10,ruleVersion:'lowest-unique-v4',endDelayMs:3600000});
  const first=await catalog.listQuickAuctions('live',1,now),second=await catalog.listQuickAuctions('live',2,now);
  expect(first.total).toBe(12);expect(first.pageSize).toBe(10);expect(first.totalPages).toBe(2);expect(first.items).toHaveLength(10);expect(second.items).toHaveLength(2);expect(second.total).toBe(12);expect(new Set([...first.items,...second.items].map(item=>item.code)).size).toBe(12);
  expect((await catalog.listQuickAuctions('live',3,now)).items).toEqual([]);
  expect(await catalog.getAuctionSummary(now)).toEqual({totalLive:12,totalUpcoming:0,serverNow:now.toISOString()});
 });
});
