import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {CatalogAuction} from '../src/modules/auctions/catalog';

const state=vi.hoisted(()=>({activity:null as null|{bids:number;bidders:number;status:'live';startsAt:string;endsAt:string}}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('../src/components/auction-activity',()=>({useAuctionActivity:()=>({activity:state.activity,views:null,refreshActivity:()=>{}}),useAuctionRefresh:()=>{}}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:null})}));
vi.mock('../src/components/private-query',()=>({usePrivateQuery:()=>({data:null})}));
vi.mock('../src/components/auction-gallery',()=>({AuctionGallery:()=>null}));
vi.mock('../src/components/auction-share',()=>({AuctionShare:()=>null}));
import {AuctionDetail} from '../src/components/auction-detail';
import {MiniLocaleProvider} from '../src/components/mini-locale';

const now='2026-10-30T00:33:00Z',endsAt='2026-11-20T00:33:00Z';
const auction={code:'5',slug:'bid-total-fixture',status:'live',isDemo:false,result:null,bidCount:42,viewCount:'100',startsAt:now,endsAt,
 product:{title:'Power bank',description:'A product',condition:'New',images:[]},category:{slug:'accessories',name:'Accessories'},fulfillment:{summary:'Collect the prize',region:'Addis Ababa'},
 terms:{version:1,ruleVersion:'lowest-unique-v4',entryFeePoints:'50',minPoints:'1',maxPoints:null,stepPoints:'0.01',maxDistinctBids:100,noWinnerTerms:'Frozen terms',cancellationTerms:'Frozen terms'},
} as unknown as CatalogAuction;
const render=(language:'en'|'am'='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(AuctionDetail,{auction,serverNow:now})}));
beforeEach(()=>{state.activity=null});

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
});
