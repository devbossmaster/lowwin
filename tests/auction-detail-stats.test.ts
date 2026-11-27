import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {CatalogAuction} from '../src/modules/auctions/catalog';

const state=vi.hoisted(()=>({activity:null as null|{bids:number;bidders:number;status:'live';startsAt:string;endsAt:string},catalog:null as null|{items:CatalogAuction[];serverNow:string}}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:()=>{}})}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('../src/components/auction-activity',()=>({useAuctionActivity:()=>({activity:state.activity,views:null,refreshActivity:()=>{}}),useAuctionRefresh:()=>{}}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:null})}));
vi.mock('../src/components/public-query',()=>({usePublicQuery:(url:string)=>({data:url.includes('?')?state.catalog:null})}));
vi.mock('../src/components/auction-card',()=>({AuctionCard:({auction}:{auction:CatalogAuction})=>createElement('article',{'data-related-auction':auction.code},auction.product.title)}));
vi.mock('../src/components/auction-gallery',()=>({AuctionGallery:()=>createElement('div',{'data-product-gallery':true})}));
vi.mock('../src/components/auction-share',()=>({AuctionShareOptions:()=>createElement('div',{'data-share-options':true})}));
import {AuctionDetail} from '../src/components/auction-detail';
import {MiniLocaleProvider} from '../src/components/mini-locale';

const now='2026-10-30T00:33:00Z',endsAt='2026-11-20T00:33:00Z';
const auction={code:'5',slug:'bid-total-fixture',status:'live',isDemo:false,result:null,bidCount:42,viewCount:'100',startsAt:now,endsAt,
 product:{title:'Power bank',description:'A product',condition:'New',images:[]},category:{slug:'accessories',name:'Accessories'},fulfillment:{summary:'Collect the prize',region:'Addis Ababa'},
 terms:{version:1,ruleVersion:'lowest-unique-v4',entryFeePoints:'50',minPoints:'1',maxPoints:null,stepPoints:'0.01',maxDistinctBids:100,noWinnerTerms:'Frozen terms',cancellationTerms:'Frozen terms'},
} as unknown as CatalogAuction;
const render=(language:'en'|'am'='en',item=auction)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(AuctionDetail,{auction:item,serverNow:now})}));
beforeEach(()=>{state.activity=null;state.catalog=null});

describe('public auction total accepted bids',()=>{
 it('shows the saved accepted-bid total while the activity request is unavailable',()=>{
  const html=render();expect(html).toContain('<strong>42</strong><small>Total bids</small>');expect(html).not.toContain('Bidders');
 });
 it('uses total bids rather than distinct people after live activity updates',()=>{
  state.activity={bids:137,bidders:3,status:'live',startsAt:now,endsAt};
  const html=render();expect(html).toContain('<strong>137</strong><small>Total bids</small>');expect(html).not.toContain('<strong>3</strong>');
 });
 it('preserves a real zero and the Amharic total-bids label',()=>{
  state.activity={bids:0,bidders:0,status:'live',startsAt:now,endsAt};
  expect(render('am')).toContain('<strong>0</strong><small>ጠቅላላ ጨረታዎች</small>');
 });
 it('shows the published fee, code and bid action without the standalone disclosure',()=>{
  const html=render();
  expect(html).toContain('<h1>Power bank</h1>');expect(html).toContain('data-share-options');
  expect(html).toContain('Fee per bid');expect(html).toContain('ETB 50.00');expect(html).toContain('Auction code');
  expect(html).toContain('data-auction-bid');expect(html).toContain('Place a bid');expect(html).not.toContain('Pay ETB 50.00 &amp; bid');
  expect(html).not.toContain('Chosen numbers stay private until the result is published.');
  expect(html).not.toContain('Frozen terms');expect(html).not.toContain('Collect the prize');
  expect(html).not.toContain('href="/terms"');
  expect(html.indexOf('Fee per bid')).toBeLessThan(html.indexOf('More chances'));
  expect(html.indexOf('Total bids')).toBeLessThan(html.indexOf('More chances'));
  expect(html.indexOf('More chances')).toBeLessThan(html.indexOf('data-share-options'));
  expect(html.indexOf('data-product-gallery')).toBeLessThan(html.indexOf('<h1>'));
 });
 it('keeps the existing countdown and scheduled Ethiopian-time information',()=>{
  const html=render();expect(html).toContain('role="timer"');expect(html).toContain(`dateTime="${endsAt}"`);expect(html).toContain('03:33</time>');
 });
 it('puts the short description in one section before more chances without an expand control',()=>{
  const html=render();
  expect(html.match(/A product/g)).toHaveLength(1);
  expect(html.indexOf('Product details')).toBeLessThan(html.indexOf('More chances'));
  expect(html).not.toContain('Read more');
 });
 it('previews long descriptions in the selected language and skips blank descriptions',()=>{
  const descriptionAm='ተንቀሳቃሽ የኃይል ባንክ። '.repeat(12)+'የመጨረሻ ዝርዝር';
  const item={...auction,product:{...auction.product,descriptionAm}};
  const html=render('am',item);
  expect(html).toContain('ተንቀሳቃሽ የኃይል ባንክ።');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('ተጨማሪ አንብብ');
  expect(html).not.toContain('የመጨረሻ ዝርዝር');
  expect(render('en',{...auction,product:{...auction.product,description:'  '}})).not.toContain('data-product-description');
 });
 it('recommends only other auctions still accepting entries',()=>{
  state.catalog={serverNow:now,items:[auction,{...auction,code:'6',product:{...auction.product,title:'Other live prize'}},{...auction,code:'7',endsAt:now},{...auction,code:'8',status:'upcoming'}]};
  const html=render();expect(html).toContain('data-related-auction="6"');
  for(const code of ['5','7','8'])expect(html).not.toContain(`data-related-auction="${code}"`);
  expect(html).toContain('href="/#discover-auctions"');
 });
 it('omits the recommendations when no other live auction is available',()=>{
  state.catalog={serverNow:now,items:[auction]};expect(render()).not.toContain('data-more-chances');
 });
});
