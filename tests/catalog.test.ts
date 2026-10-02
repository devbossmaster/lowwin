import {Prisma as MoneyPrisma} from '@prisma/client';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { seedCatalog } from '../scripts/seed-catalog';

const testUrl=process.env.TEST_DATABASE_URL;
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
    expect(result.total).toBe(8);expect(result.items).toHaveLength(6);
    for(const item of result.items){
      expect(item.code).toMatch(/^[1-9]\d*$/);
      expect(Object.keys(item).sort()).toEqual(['bidCount','code','endsAt','isDemo','product','slug']);
      expect(Object.keys(item.product).sort()).toEqual(['images','title','titleAm']);
      expect(item.product.images.length).toBeLessThanOrEqual(1);
    }
    expect(JSON.stringify(result)).not.toContain('winningUserId');
  });
  it('derives live, upcoming and closed status and never shows a live animal listing',async()=>{
    const now=await catalog.serverNow();
    const categories=await catalog.listCategories(now);
    expect(categories).toHaveLength(9);
    expect(categories.find(item=>item.slug==='animals')?.counts).toEqual({all:0,live:0,upcoming:0,closed:0});
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
