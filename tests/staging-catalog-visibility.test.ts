import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
const fixture=vi.hoisted(()=>({query:vi.fn(),many:vi.fn(),count:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{$queryRaw:fixture.query,auction:{findMany:fixture.many,count:fixture.count}}}));
import {countAuctions,getAuctionSummary,listAuctions,listCategories,listQuickAuctions,listQuickLiveAuctions,publicWhere} from '../src/modules/auctions/catalog';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const pinned={APP_ENV:'staging',NODE_ENV:'development',STAGING_DEMO_ENABLED:'true',DATABASE_URL:'postgresql://postgres.kgwjolbhtvfwuohrtjya@aws-1-eu-west-1.pooler.supabase.com/postgres',DIRECT_URL:'postgresql://postgres@db.kgwjolbhtvfwuohrtjya.supabase.co/postgres',MINI_APP_URL:'https://fixture.ngrok-free.dev',BETTER_AUTH_URL:'https://fixture.ngrok-free.dev',STAGING_DEMO_ORIGIN_HASH:hash('https://fixture.ngrok-free.dev'),TELEGRAM_BOT_TOKEN:'123:fixture',STAGING_DEMO_BOT_HASH:hash('123')};
const now=new Date('2026-10-24T12:00:00Z'),visible={OR:[{testRunId:null},{isDemo:true,testRunId:{not:null}}]};
function environment(change:Record<string,string|undefined>={}){
 for(const [name,value] of Object.entries({...pinned,...change}))vi.stubEnv(name,value);vi.stubEnv('VERCEL','');
 fixture.query.mockImplementation((strings:TemplateStringsArray)=>strings.join('').includes('SELECT now() AS now')?Promise.resolve([{now}]):Promise.resolve([]));fixture.many.mockResolvedValue([]);fixture.count.mockResolvedValue(0);
}
function statements(){return fixture.query.mock.calls.map(call=>Prisma.sql(call[0] as TemplateStringsArray,...call.slice(1)).sql)}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
describe('bounded tagged preview catalog reads',()=>{
 it('keeps publication, product/category visibility and terms requirements on preview rows',()=>{
  expect(publicWhere(now,pinned)).toMatchObject({...visible,publishedAt:{lte:now},slug:{not:null},status:{in:['SCHEDULED','LIVE','CLOSED','CANCELLED']},product:{is:{visible:true,category:{visible:true}}},category:{is:{visible:true}},terms:{isNot:null}});
  for(const change of [{NODE_ENV:'production'},{APP_ENV:'production'},{STAGING_DEMO_ENABLED:'false'},{VERCEL:'1'},{TELEGRAM_BOT_TOKEN:'456:other'},{MINI_APP_URL:'https://other.example'},{DIRECT_URL:'postgresql://postgres@db.otherproject.supabase.co/postgres'}]){
   expect(publicWhere(now,{...pinned,...change})).toMatchObject({testRunId:null});expect(publicWhere(now,{...pinned,...change}).OR).toBeUndefined();
  }
 });
 it.each(['fee-low','fee-high','ending'] as const)('keeps %s SQL and count predicates consistent',async sort=>{
  environment();await listAuctions({q:'',status:'all',sort,page:1},now);
  expect(statements()[0]).toContain('(a."testRunId" IS NULL OR (a."isDemo"=true AND a."testRunId" IS NOT NULL))');
  expect(fixture.count.mock.calls[0][0].where.AND[0]).toMatchObject(visible);
 });
 it('includes preview category counts and quick summaries under the same capability',async()=>{
  environment();await listCategories(now);expect(statements()[0]).toContain('(a."testRunId" IS NULL OR (a."isDemo"=true AND a."testRunId" IS NOT NULL))');
  await listQuickLiveAuctions();expect(fixture.many.mock.calls[0][0].where.AND[0]).toMatchObject(visible);
  await countAuctions({q:'',status:'live',sort:'code',page:1},now);expect(fixture.count.mock.calls.at(-1)![0].where.AND[0]).toMatchObject(visible);
 });
 it('retains strict tagged-record exclusion for normal catalog SQL and summary paths',async()=>{
  environment({NODE_ENV:'production'});await listAuctions({q:'',status:'all',sort:'fee-low',page:1},now);await listCategories(now);await listQuickLiveAuctions();
  for(const statement of statements().filter(value=>value.includes('"testRunId"')))expect(statement).not.toContain('OR (a."isDemo"=true');
  expect(fixture.count.mock.calls[0][0].where.AND[0]).toMatchObject({testRunId:null});expect(fixture.many.mock.calls[0][0].where.AND[0]).toMatchObject({testRunId:null});
 });
 it.each([true,false])('reads both summary counts in one public-only query (preview=%s)',async preview=>{
  environment(preview?{}:{NODE_ENV:'production'});fixture.query.mockResolvedValue([{totalLive:4,totalUpcoming:2,serverNow:now}]);
  expect(await getAuctionSummary(now)).toEqual({totalLive:4,totalUpcoming:2,serverNow:now.toISOString()});
  expect(fixture.query).toHaveBeenCalledTimes(1);expect(fixture.many).not.toHaveBeenCalled();expect(fixture.count).not.toHaveBeenCalled();
  const sql=statements()[0];expect(sql).toContain('a."publishedAt"<=');expect(sql).toContain("a.status IN ('SCHEDULED','LIVE')");expect(sql).toContain('p.visible AND pc.visible AND c.visible');expect(sql).toContain('JOIN "AuctionTerms"');expect(sql).not.toMatch(/"Bid"|"user"|"Settlement"|"ProductImage"|"AuctionFeeRevision"/);
  expect(sql.includes('OR (a."isDemo"=true')).toBe(preview);
 });
 it('shares browse visibility predicates and bounds each quick tab to ten thumbnail-only cards',async()=>{
  environment();await listQuickAuctions('upcoming',2,now);
  const args=fixture.many.mock.calls[0][0];expect(args.where.AND[0]).toMatchObject(visible);expect(args.where.AND[2]).toMatchObject({startsAt:{gt:now},status:{in:['SCHEDULED','LIVE']}});expect(args.take).toBe(10);expect(args.skip).toBe(10);expect(args.select.product.select.images.take).toBe(1);expect(args.select.terms.select).toEqual({version:true,ruleVersion:true,entryFeePoints:true});expect(args.select).not.toHaveProperty('bids');expect(args.select).not.toHaveProperty('settlement');expect(args.select.product.select).not.toHaveProperty('description');
 });
});
