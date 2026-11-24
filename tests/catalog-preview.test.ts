import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {CatalogAuction} from '../src/modules/auctions/catalog';
import {catalogProductPreview,recentWinnerPreview} from '../src/lib/catalog-preview';
const f=vi.hoisted(()=>({auction:vi.fn(),list:vi.fn(),winners:vi.fn(),session:vi.fn(),db:{}}));
vi.mock('../src/modules/auctions/catalog',()=>({getAuction:f.auction,listAuctions:f.list,listQuickAuctions:f.list,getAuctionSummary:f.list,catalogQuerySchema:{safeParse:()=>({success:true,data:{status:'closed',page:1}})}}));
vi.mock('../src/modules/auctions/results',()=>({listCompletedWinners:f.winners}));
vi.mock('../src/modules/auctions/staging-demo',()=>({stagingDemoEnabled:()=>false}));
vi.mock('../src/lib/db',()=>({db:f.db}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:f.session}));
import {GET as detail} from '../src/app/api/catalog/auctions/[slug]/route';
import {GET as list} from '../src/app/api/catalog/auctions/route';
import {GET as recent} from '../src/app/api/results/recent-winners/route';
const source={slug:'published-product',code:'42',status:'closed',publishedAt:'2026-11-12T12:00:00.000Z',featured:true,isDemo:false,bidCount:10,viewCount:'20',startsAt:'2026-11-10T12:00:00.000Z',endsAt:'2026-11-11T12:00:00.000Z',product:{title:'Published product',images:[{path:'/catalog/product.webp',alt:'Product'}]},terms:{entryFeePoints:'10'},fulfillment:{summary:'Published delivery terms'},category:{slug:'accessories',name:'Accessories'},result:{outcome:'WINNER',source:'SETTLED',publishedAt:'2026-11-12T12:00:00.000Z',closedAt:'2026-11-11T12:00:00.000Z',isDemo:false,demoLabel:null,winningPoints:'private-winning-number',decision:'LOWEST_UNIQUE',explanation:'private-result-explanation',winnerDisplay:'private-winner-name',winnerUsername:'private-winner-username',winnerPhoneMasked:'private-phone',acceptedBidCount:10,winnerPhotoPath:'/api/media/private-winner-photo',winnerBannerPath:'/api/media/private-banner',winnerBannerVersion:1},unexpectedPrivateField:'private-unexpected-field'} as unknown as CatalogAuction;
beforeEach(()=>{vi.clearAllMocks();f.session.mockResolvedValue({user:{id:'registered-player'}});f.auction.mockResolvedValue(source);f.list.mockResolvedValue({items:[source],page:1,total:1});f.winners.mockResolvedValue({items:[source],page:1,total:1,totalPages:1,serverNow:'2026-11-12T12:00:00.000Z'})});
function assertNoProtectedResult(value:unknown){const text=JSON.stringify(value);expect(text).not.toMatch(/private-|unexpectedPrivateField/)}
describe('read-only public product and Home announcement projections',()=>{
 it('keeps published product, fee, terms, revision and counts while removing the result record',()=>{const preview=catalogProductPreview({...source,presentationVersion:7});expect(preview).toMatchObject({code:'42',product:source.product,terms:source.terms,bidCount:10,presentationVersion:7,result:null});assertNoProtectedResult(preview);expect(source.result?.winnerDisplay).toBe('private-winner-name')});
 it('allows only prize announcement metadata on Home, without protected winner facts',()=>{const preview=recentWinnerPreview(source);expect(preview.result).toMatchObject({outcome:'WINNER',source:'SETTLED',publishedAt:source.result!.publishedAt,winningPoints:null,winnerDisplay:null,winnerPhoneMasked:null,winnerPhotoPath:null,winnerBannerPath:null});assertNoProtectedResult(preview)});
 it('publishes approved banner artwork for every visitor without serializing private winner details',async()=>{
  const path='/api/media/155a36cf-cf33-4415-b45d-809e06b5c96b',result=source.result;
  if(result?.source!=='SETTLED')throw Error('Expected a settled winner fixture');
  const winner={...source,result:{...result,winnerBannerPath:path,winnerBannerVersion:3}};
  f.winners.mockResolvedValue({items:[winner],page:1,total:1,totalPages:1});
  const response=await recent(),body=await response.json();
  expect(response.headers.get('cache-control')).toBe('no-store');expect(f.session).not.toHaveBeenCalled();
  expect(body.items[0].result).toMatchObject({winnerBannerPath:path,winnerBannerVersion:3,winnerDisplay:null,winnerPhoneMasked:null,winnerPhotoPath:null,winningPoints:null});assertNoProtectedResult(body);
  expect(recentWinnerPreview({...winner,isDemo:true}).result?.winnerBannerPath).toBeNull();
  expect(recentWinnerPreview({...winner,status:'live'}).result?.winnerBannerPath).toBeNull();
 });
 it('denies a guest detail read before loading the auction',async()=>{f.session.mockResolvedValue(null);const response=await detail(new Request('https://lowwin.test/api/catalog/auctions/42'),{params:Promise.resolve({slug:'42'})});expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(f.auction).not.toHaveBeenCalled()});
 it('serves authenticated product details and strips results from the actual handler',async()=>{const response=await detail(new Request('https://lowwin.test/api/catalog/auctions/42'),{params:Promise.resolve({slug:'42'})});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');const body=await response.json();expect(body.result).toBeNull();assertNoProtectedResult(body)});
 it('strips results from every catalog-list item even when closed auctions are requested',async()=>{const response=await list(new Request('https://lowwin.test/api/catalog/auctions?status=closed'));expect(response.status).toBe(200);const body=await response.json();expect(body.items[0].result).toBeNull();assertNoProtectedResult(body)});
 it('ignores pagination/query expansion on the fixed bounded Home announcement endpoint',async()=>{const response=await recent();expect(response.status).toBe(200);expect(f.winners).toHaveBeenCalledWith(f.db,1,12);assertNoProtectedResult(await response.json())});
 it('never exposes provider/database failures through the public projection',async()=>{f.auction.mockRejectedValue(Error('private-database-secret'));f.winners.mockRejectedValue(Error('private-database-secret'));for(const response of [await detail(new Request('https://lowwin.test/api/catalog/auctions/42'),{params:Promise.resolve({slug:'42'})}),await recent()]){expect(response.status).toBe(503);expect(await response.text()).not.toContain('private-database-secret')}});
});
