import {Prisma} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const f=vi.hoisted(()=>({findMany:vi.fn(),count:vi.fn(),raw:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{auction:{findMany:f.findMany,count:f.count},$queryRaw:f.raw}}));
vi.mock('../src/modules/cache/public-data',()=>({cachedPublicData:(_key:string,_ttl:number,load:()=>unknown)=>load()}));
import {listAuctions,type CatalogQuery} from '../src/modules/auctions/catalog';
import {parseBrowseQuery,parseHomeQuery} from '../src/modules/auctions/browse-query';
import {catalogBatchUrl} from '../src/lib/catalog-query';
import {homeFilterQuery} from '../src/lib/home-filter-query';

const now=new Date('2026-10-30T12:00:00Z');
function row(id:string,code:number,featured:boolean,published:string,ends:string,homeOrder:number|null=null){
 return {id,slug:id,code:`AUCTION-${code}`,publicCode:code,status:'LIVE',publishedAt:new Date(published),startsAt:new Date('2026-10-01'),endsAt:new Date(ends),featured,homeOrder,isDemo:false,acceptedBidCount:0,publicViewCount:0n,presentation:null,fulfillmentSummary:'Collect item',fulfillmentSummaryAm:null,fulfillmentRegion:'Addis Ababa',fulfillmentRegionAm:null,
  product:{title:id,titleAm:null,description:'Product',descriptionAm:null,condition:'New',conditionAm:null,images:[]},category:{slug:'accessories',name:'Accessories',nameAm:null},terms:{version:1,ruleVersion:'lowest-unique-v4',minParticipants:2,minPoints:new Prisma.Decimal(1),maxPoints:null,stepPoints:new Prisma.Decimal('.01'),entryFeePoints:new Prisma.Decimal(10),maxDistinctBids:100,noWinnerTerms:'Terms',cancellationTerms:'Terms',fulfillmentSnapshot:'Terms'},feeRevisions:[],result:null,settlement:null,winnerPresentation:null};
}
const rows=[
 row('featured-later',1,true,'2026-10-28','2026-11-02'),
 row('unfeatured-soonest',2,false,'2026-10-11','2026-10-30T13:00:00Z'),
 row('unfeatured-later',4,false,'2026-10-29','2026-11-01'),
 row('featured-sooner',3,true,'2026-10-20','2026-10-31'),
 row('tie-low',5,false,'2026-10-25','2026-10-31'),
 row('tie-high',6,false,'2026-10-25','2026-10-31'),
];
let fixtures=rows;
type Direction='asc'|'desc';
beforeEach(()=>{
 vi.clearAllMocks();fixtures=rows;f.count.mockResolvedValue(rows.length);
 // Model the database's scalar ordering before LIMIT/OFFSET, rather than
 // sorting the returned page in the application and losing featured rows.
 f.findMany.mockImplementation(async({orderBy,skip=0,take=6}:{orderBy:Record<string,Direction|{sort:Direction;nulls:'last'}>[];skip:number;take:number})=>[...fixtures].sort((a,b)=>{
  const scalar=(value:unknown)=>value===null?Infinity:value instanceof Date?value.getTime():typeof value==='boolean'?Number(value):value;
  for(const order of orderBy){const [key,option]=Object.entries(order)[0],direction=typeof option==='string'?option:option.sort,left=scalar(a[key as keyof typeof a]),right=scalar(b[key as keyof typeof b]);const difference=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right));if(!difference)continue;return direction==='desc'?-difference:difference}return 0;
 }).slice(skip,skip+take));
});

describe('Home default featured and closing-time order',()=>{
 it('uses identical URL filters for streamed direct links and browser-only navigation',()=>{
  for(const search of ['','sort=code','sort=ending&category=phones&q=power','sort=bad&category=INVALID','sort=title&search=%20phone%20','q='+('x'.repeat(81)),'sort=fee-low&page=4&status=closed','sort=newest&sort=ending&q=&search=ignored']){
   const params=new URLSearchParams(search),values:Record<string,string[]>={};params.forEach((_,key)=>values[key]=params.getAll(key));
   expect(homeFilterQuery(params)).toEqual(parseHomeQuery(values));
  }
 });
 it('pins featured auctions above sooner unfeatured auctions, then sorts each group by closing time',async()=>{
  const result=await listAuctions(parseHomeQuery({}),now,10);
  expect(result.items.map(item=>item.slug)).toEqual(['featured-sooner','featured-later','unfeatured-soonest','tie-high','tie-low','unfeatured-later']);
  expect(f.findMany.mock.calls[0][0].orderBy).toEqual([{featured:'desc'},{homeOrder:{sort:'asc',nulls:'last'}},{endsAt:'asc'},{publishedAt:'desc'},{publicCode:'desc'},{id:'asc'}]);
 });
 it('sorts numbered auctions first within their groups and breaks equal numbers by closing time',async()=>{
  const positions:Record<string,number>={'featured-later':2,'unfeatured-later':2,'tie-low':2,'tie-high':1};
  fixtures=rows.map(item=>({...item,homeOrder:positions[item.slug]??null}));
  const result=await listAuctions(parseHomeQuery({}),now,10);
  expect(result.items.map(item=>item.slug)).toEqual(['featured-later','featured-sooner','tie-high','tie-low','unfeatured-later','unfeatured-soonest']);
 });
 it('orders the complete filtered result before stable pagination',async()=>{
  const query=parseHomeQuery({q:'power',category:'accessories'}),seen:string[]=[];
  for(let page=1;page<=3;page++){const result=await listAuctions({...query,page},now,2);seen.push(...result.items.map(item=>item.slug));expect(result.totalPages).toBe(3)}
  expect(seen).toEqual(['featured-sooner','featured-later','unfeatured-soonest','tie-high','tie-low','unfeatured-later']);expect(new Set(seen).size).toBe(6);
  expect(f.findMany.mock.calls.map(([options])=>options.skip)).toEqual([0,2,4]);
  expect(f.findMany.mock.calls[0][0].where.AND).toEqual(expect.arrayContaining([{category:{is:{slug:'accessories'}}}]));
  expect(JSON.stringify(f.findMany.mock.calls[0][0].where)).toContain('power');
 });
 it('maps saved Home Default/code links to featured while retaining independent browse defaults',()=>{
  expect(parseHomeQuery({sort:'code',category:'phones',page:'4'})).toMatchObject({sort:'featured',status:'live',category:'phones',page:1});
  expect(parseHomeQuery({sort:['code','ending']})).toMatchObject({sort:'featured'});
  expect(parseBrowseQuery({sort:'code'}).sort).toBe('code');expect(parseBrowseQuery({}).sort).toBe('newest');
  expect(catalogBatchUrl(parseHomeQuery({}))).toBe('/api/catalog/auctions?view=home&status=live&sort=featured&page=1');
  expect(catalogBatchUrl(parseBrowseQuery({status:'live',sort:'code'}))).toContain('sort=code');
 });
 it.each(['ending','newest','fee-low','fee-high'] as const)('preserves an explicitly selected Home %s sort',sort=>{
  expect(parseHomeQuery({sort,q:'phone',category:'phones'})).toMatchObject({sort,q:'phone',category:'phones'});
 });
 it('does not pin featured cards in explicit New, Ends soon or code ordering',async()=>{
  const expected:{sort:CatalogQuery['sort'];order:Record<string,string>[]}[]=[{sort:'newest',order:[{publishedAt:'desc'},{id:'asc'}]},{sort:'ending',order:[{endsAt:'asc'},{id:'asc'}]},{sort:'code',order:[{publicCode:'asc'}]}];
  for(const value of expected){await listAuctions({...parseHomeQuery({}),sort:value.sort},now,10);expect(f.findMany).toHaveBeenLastCalledWith(expect.objectContaining({orderBy:value.order}))}
 });
});
