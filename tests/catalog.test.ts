import {Prisma as MoneyPrisma} from '@prisma/client';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { seedCatalog } from '../scripts/seed-catalog';

const testUrl=process.env.CATALOG_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)('public catalog on disposable PostgreSQL',()=>{
  let client:PrismaClient;
  let catalog:typeof import('../src/modules/auctions/catalog');
  beforeAll(async()=>{
    const url=new URL(testUrl!);
    if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Catalog tests require a disposable loopback *_test database');
    Object.assign(process.env,{DATABASE_URL:testUrl,DIRECT_URL:testUrl,APP_ENV:'local',NODE_ENV:'test'});
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
    client=new PrismaClient();
    await seedCatalog(client);
    catalog=await import('../src/modules/auctions/catalog');
  },60000);
  afterAll(async()=>{await client?.$disconnect();const {db}=await import('../src/lib/db');await db.$disconnect()});
  it('seeds all nine categories and is idempotent',async()=>{
    await seedCatalog(client);
    expect(await client.category.count()).toBe(9);
    expect(await client.auction.count({where:{code:{startsWith:'DEMO-'}}})).toBe(14);
    expect(await client.productImage.count()).toBe(14);
    expect(await client.auctionTerms.count()).toBe(14);
  });
  it('returns a small public-only live header list with numeric detail codes',async()=>{
    const result=await catalog.listQuickLiveAuctions(1);
    expect(result.total).toBe(8);expect(result.items).toHaveLength(8);expect(result.pageSize).toBe(10);
    for(const item of result.items){
      expect(item.code).toMatch(/^[1-9]\d*$/);
      expect(Object.keys(item).sort()).toEqual(['bidCount','code','endsAt','isDemo','product','slug','startsAt','status','terms']);
      expect(Object.keys(item.product).sort()).toEqual(['images','title','titleAm']);
      expect(item.product.images.length).toBeLessThanOrEqual(1);
      expect(item.status).toBe('live');expect(Object.keys(item.terms).sort()).toEqual(['entryFeePoints','ruleVersion','version']);
    }
    expect(JSON.stringify(result)).not.toContain('winningUserId');
  });
  it('keeps live/upcoming quick totals, schedules and count-only summary consistent',async()=>{
    const now=await catalog.serverNow(),summary=await catalog.getAuctionSummary(now);
    expect(summary).toEqual({totalLive:8,totalUpcoming:3,serverNow:now.toISOString()});
    for(const status of ['live','upcoming'] as const){
      const result=await catalog.listQuickAuctions(status,1,now);
      expect(result.total).toBe(status==='live'?summary.totalLive:summary.totalUpcoming);
      expect(result.total).toBe((await catalog.listAuctions({q:'',status,sort:'code',page:1},now)).total);
      expect(result.items.every(item=>item.status===status&&new Date(item.endsAt)>now)).toBe(true);
      expect(result.items.every(item=>status==='live'?new Date(item.startsAt)<=now:new Date(item.startsAt)>now)).toBe(true);
      expect((await catalog.listQuickAuctions(status,2,now)).items).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(/description|winningUserId|telegramId|walletId|participant|frequency|uniqueHint|amounts/);
    }
    const later=new Date(now.getTime()+10*24*60*60*1000);
    expect(await catalog.getAuctionSummary(later)).toEqual({totalLive:0,totalUpcoming:0,serverNow:later.toISOString()});
  });
  it('derives live, upcoming and closed status and never shows a live animal listing',async()=>{
    const now=await catalog.serverNow();
    const categories=await catalog.listCategories(now);
    expect(categories).toHaveLength(8);
    expect(categories.find(item=>item.slug==='animals')).toBeUndefined();
    expect(categories.every(item=>item.counts.all>0)).toBe(true);
    expect((await catalog.listAuctions({q:'',status:'live',sort:'ending',page:1},now)).total).toBe(8);
    expect((await catalog.listAuctions({q:'',status:'upcoming',sort:'ending',page:1},now)).total).toBe(3);
    expect((await catalog.listAuctions({q:'',status:'closed',sort:'ending',page:1},now)).total).toBe(3);
  });
  it('filters and paginates deterministically',async()=>{
    const query={q:'',status:'all' as const,sort:'ending' as const,page:1};
    const first=await catalog.listAuctions(query),second=await catalog.listAuctions({...query,page:2});
    expect(first.total).toBe(14);expect(first.totalPages).toBe(3);expect(first.items).toHaveLength(6);
    expect(first.items.every(item=>item.status==='live')).toBe(true);
    expect(second.items).toHaveLength(6);
    expect(new Set([...first.items,...second.items].map(item=>item.code)).size).toBe(12);
    const phones=await catalog.listAuctions({...query,category:'phones'});
    expect(phones.total).toBe(2);expect(phones.items.every(item=>item.category.slug==='phones')).toBe(true);
    const watch=await client.auction.findUniqueOrThrow({where:{code:'DEMO-WAT-002'},select:{publicCode:true}});
    expect((await catalog.listAuctions({...query,q:'DEMO-WAT-002'})).items.map(item=>item.code)).toEqual([watch.publicCode.toString()]);
    expect((await catalog.listAuctions({...query,q:watch.publicCode.toString()})).items.map(item=>item.code)).toEqual([watch.publicCode.toString()]);
  });
  it('count-only tabs match the public listing filters without loading cards',async()=>{
    const now=await catalog.serverNow();
    for(const status of ['all','live','upcoming','closing','closed'] as const){
      for(const category of [undefined,'phones']){
        const query={q:'',status,category,sort:'code' as const,page:1};
        expect(await catalog.countAuctions(query,now)).toBe((await catalog.listAuctions(query,now)).total);
      }
    }
    const query={q:'DEMO-WAT-002',status:'all' as const,sort:'title' as const,page:2};
    expect(await catalog.countAuctions(query,now)).toBe(1);
    expect(await catalog.countAuctions({...query,q:'not-present'},now)).toBe(0);
  });
  it('allowlists public response data and hides unpublished inventory and future results',async()=>{
    const {GET}=await import('../src/app/api/catalog/auctions/route');
    const response=await GET(new Request('http://localhost:3000/api/catalog/auctions?status=live'));
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body.total).toBe(8);
    expect(JSON.stringify(body)).not.toMatch(/telegramId|walletId|auctionHold|postings|bidderId|winnerLabel|requestHash|frequency|uniqueHint/);
    expect(body.items.every((item:{result:unknown})=>item.result===null)).toBe(true);
    const closed=await (await GET(new Request('http://localhost:3000/api/catalog/auctions?status=closed'))).json();
    expect(JSON.stringify(closed)).not.toMatch(/winnerLabel|walletId|bidderId/);
    const hidden=await client.auction.create({data:{code:'CATALOG-HIDDEN-TEST'}});
    expect(await catalog.getAuction(hidden.code)).toBeNull();
    await client.auction.delete({where:{id:hidden.id}});
  });
  it('keeps published terms immutable and demo results explicit',async()=>{
    const row=await client.auction.findUniqueOrThrow({where:{code:'DEMO-FUR-001'},include:{terms:true}});
    await expect(client.auctionTerms.update({where:{id:row.terms!.id},data:{entryFeePoints:new MoneyPrisma.Decimal("1")}})).rejects.toThrow();
    const results=await catalog.listResults();
    expect(results.total).toBe(3);
    expect(results.items.every(item=>item.result?.isDemo&&item.result.explanation.includes('DEMO'))).toBe(true);
    expect(await catalog.getResult('DEMO-WAT-002')).not.toBeNull();
    expect(await catalog.getResult('DEMO-FUR-001')).toBeNull();
  });
});
