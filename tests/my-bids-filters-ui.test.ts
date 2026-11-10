import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({view:null as string|null,status:null as string|null,language:'en',outcome:'LIVE',urls:[] as string[],queryOptions:[] as Array<Record<string,unknown>>}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:'verified-player'})}));
vi.mock('../src/components/mini-query-state',()=>({useMiniQueryState:()=>({params:new URLSearchParams({...state.view?{view:state.view}:{},...state.status?{status:state.status}:{}}),set:()=>{}}),useMiniPage:()=>[1,()=>{}]}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/mini-locale',()=>({useMiniLocale:()=>({language:state.language})}));
vi.mock('../src/components/auction-activity',()=>({useAuctionActivity:()=>({activity:null})}));
vi.mock('../src/components/auction-countdown',()=>({AuctionCountdown:()=>createElement('span',null,'Countdown')}));
vi.mock('../src/components/catalog-image',()=>({CatalogImage:({src,alt}:{src:string;alt:string})=>createElement('img',{src,alt})}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({href,children}:{href:string;children:React.ReactNode})=>createElement('a',{href},children)}));
vi.mock('../src/components/private-query',()=>({PrivateState:()=>null,usePrivateQuery:(url:string,options:Record<string,unknown>)=>{
 state.urls.push(url);state.queryOptions.push(options);
 return {data:{items:[{id:'accepted-one',amount:'1.00',acceptedAt:'2026-11-01T10:00:00Z',outcome:state.outcome,auction:{title:'Accepted product',titleAm:'የተቀበለ ምርት',code:'5',slug:'accepted-product',image:{path:'/images/test.webp',alt:'Product'},status:'LIVE',startsAt:'2026-11-01T09:00:00Z',endsAt:'2027-01-01T00:00:00Z',ruleVersion:'lowest-unique-v4',isDemo:false}},{id:'accepted-two',amount:'1.01',acceptedAt:'2026-11-01T10:00:00Z',outcome:state.outcome,auction:{title:'Accepted product',titleAm:'የተቀበለ ምርት',code:'5',slug:'accepted-product',image:null,status:'LIVE',startsAt:'2026-11-01T09:00:00Z',endsAt:'2027-01-01T00:00:00Z',ruleVersion:'lowest-unique-v4',isDemo:false}}],page:1,pageSize:20,hasNext:false,serverNow:'2026-11-01T10:00:00Z'},updatedAt:Date.now(),status:'authenticated',error:'',fetching:false,isPlaceholderData:false,reload:()=>{}};
}}));
import {MyBidsPage} from '../src/components/my-bids-page';
import {myBidListView,myBidOutcomeLabel,myBidsQueryUrl} from '../src/components/my-bids-list-copy';
const render=()=>renderToStaticMarkup(createElement(MyBidsPage));
beforeEach(()=>{state.view=null;state.status=null;state.language='en';state.outcome='LIVE';state.urls=[];state.queryOptions=[]});

describe('Compact My Bids accepted records',()=>{
 it('shows exactly Live and Finished, without totals, attempts, IDs or payment panels',()=>{
  const html=render();expect((html.match(/role="tab"/g)??[])).toHaveLength(2);
  expect(html).toContain('>Live</button>');expect(html).toContain('>Finished</button>');
  for(const label of ['Payment attempts','Bid details','Payment information','data-my-bids-summary','Fee paid','transactionRef'])expect(html).not.toContain(label);
  expect(state.urls).toEqual(['/api/my-bids?view=live&page=1&language=en']);
 });
 it('keeps separate stable bids with the same auction and number badges without charging semantics',()=>{
  const html=render();expect(html).toContain('data-bid-id="accepted-one"');expect(html).toContain('data-bid-id="accepted-two"');
  expect((html.match(/data-bid-thumbnail/g)??[])).toHaveLength(2);expect(html).toContain('chosen number 1.00');
  expect(html).not.toContain('ETB');expect(html).not.toContain('Fee');
 });
 it('uses Finished and historical finite freshness without a polling loop',()=>{
  state.view='finished';state.outcome='PENDING';const html=render();
  expect(state.urls).toEqual(['/api/my-bids?view=finished&page=1&language=en']);
  expect(state.queryOptions[0]).toEqual({freshnessMs:300000,cancelOnUnmount:true});expect(html).toContain('Finalizing result');expect(html).not.toContain('Not winning');expect(html).not.toContain('Countdown');
 });
 it('retains legacy completed/history navigation as Finished',()=>{
  expect(myBidListView('history')).toBe('finished');expect(myBidListView(null,'completed')).toBe('finished');expect(myBidListView('all')).toBe('live');
 });
 it('scopes the minimal query by tab, page and language',()=>{
  expect(myBidsQueryUrl('live',2,'am')).toBe('/api/my-bids?view=live&page=2&language=am');
  state.language='am';const html=render();expect(state.urls[0]).toContain('language=am');expect(html).toContain('የተቀበለ ምርት');expect(html).toContain('>ያለቁ</button>');
 });
 it('uses explicit server outcomes and defaults unknown state to finalizing',()=>{
  expect(myBidOutcomeLabel('WON',false)).toBe('Winning bid');expect(myBidOutcomeLabel('LOST',false)).toBe('Not winning');expect(myBidOutcomeLabel('CANCELLED',false)).toBe('Cancelled');expect(myBidOutcomeLabel('unknown',false)).toBe('Finalizing result');
 });
});
