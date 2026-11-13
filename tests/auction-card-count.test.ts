import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {CatalogAuction} from '../src/modules/auctions/catalog';
const state=vi.hoisted(()=>({activity:null as {bids:number}|null}));
vi.mock('../src/components/auction-activity',()=>({useAuctionActivity:()=>({activity:state.activity,views:null,refreshActivity:vi.fn()}),useAuctionRefresh:vi.fn()}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:null})}));
vi.mock('../src/components/auction-query',()=>({seedAuctionQuery:vi.fn()}));
vi.mock('../src/components/mini-prefetch',()=>({prefetchAuctionIntent:vi.fn()}));
vi.mock('../src/components/bid-sheet',()=>({default:()=>null}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({children,...props}:React.ComponentProps<'a'>)=>createElement('a',props,children)}));
vi.mock('../src/components/catalog-image',()=>({CatalogImage:()=>null}));
vi.mock('../src/components/auction-countdown',()=>({AuctionCountdown:()=>createElement('span',{role:'timer'},'2d 04:18:09')}));
import {AuctionCard} from '../src/components/auction-card';
import {MiniLocaleProvider} from '../src/components/mini-locale';

const auction={slug:'fixture',code:'123',status:'live',bidCount:31,viewCount:'17',startsAt:'2026-11-12T00:00:00Z',endsAt:'2026-11-20T00:00:00Z',product:{title:'Power bank',titleAm:'ፓወር ባንክ',images:[]},terms:{entryFeePoints:'50',ruleVersion:'lowest-unique-v4'},isDemo:false} as unknown as CatalogAuction;
function render(bidCount=31,language:'en'|'am'='en'){return renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(AuctionCard,{auction:{...auction,bidCount},serverNow:'2026-11-13T00:00:00Z'})}))}
afterEach(()=>{state.activity=null});
describe('auction-card accepted-bid count',()=>{
 it('shows the server catalog count beside the submission fee and retains the timer',()=>{const html=render();expect(html).toContain('data-card-bid-count="31"');expect(html).toContain('31 total bids');expect(html).toContain('ETB 50.00');expect(html).toContain('role="timer"')});
 it('uses the existing live activity count when available',()=>{state.activity={bids:42};expect(render()).toContain('data-card-bid-count="42"');expect(render()).not.toContain('31 total bids')});
 it('preserves confirmed zero from live activity instead of a stale catalog count',()=>{state.activity={bids:0};expect(render()).toContain('data-card-bid-count="0"');expect(render()).toContain('0 total bids')});
 it.each([Number.NaN,-1,1.2])('does not invent zero for unavailable/malformed count %s',value=>{const html=render(value);expect(html).toContain('data-card-bid-count="unavailable"');expect(html).toContain('Bid count unavailable');expect(html).not.toContain('0 total bids')});
 it('labels the count naturally in Amharic',()=>{const html=render(40,'am');expect(html).toContain('40 ጠቅላላ ጨረታዎች');expect(html).toContain('ጨረታ')});
});
