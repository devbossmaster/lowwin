import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({section:null as string|null,filter:'all',referralsConfigured:true,urls:[] as string[]}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:'verified-player'})}));
vi.mock('../src/components/mini-query-state',()=>({useMiniQueryState:()=>({params:new URLSearchParams({status:state.filter,...(state.section?{section:state.section}:{})}),set:()=>{}}),useMiniPage:()=>[1,()=>{}]}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({href,children}:{href:string;children:React.ReactNode})=>createElement('a',{href},children)}));
vi.mock('../src/components/chapa-payment-history',()=>({ChapaTransactionDetails:()=>null}));
vi.mock('../src/components/private-query',()=>({PrivateState:()=>null,usePrivateQuery:(url:string)=>{
 state.urls.push(url);
 const data=url==='/api/profile'?{referral:{configured:state.referralsConfigured,counts:{available:2}}}:url.startsWith('/api/my-bids')?{items:[{id:'accepted-bid-id',amount:'1.00',feePoints:'50',acceptedAt:'2026-10-30T10:00:00Z',outcome:'LIVE',payment:{status:'PAID',method:'WALLET',transactionRef:null,checkoutId:null},auction:{title:'Accepted product',code:'5',ruleVersion:'lowest-unique-v4',isDemo:false}}],counts:{total:42,active:3,won:1,live:3,history:39},page:1,total:42,totalPages:3}:{items:[{id:'attempt-id',purpose:'BID',status:state.filter==='failed'?'FAILED':'PENDING',providerStatus:null,verificationState:'PENDING',amount:'50.00',amountCents:'5000',currency:'ETB',mode:'live',fundsPreserved:false,receipt:null,auctionTitle:'Attempted product',bidNumber:'7.00',createdAt:'2026-10-30T10:00:00Z',expiresAt:'2027-01-01T00:00:00Z',merchantReference:'LW-attempt'}],page:1,nextPage:null};
 return {data,status:'authenticated',error:'',fetching:false,isPlaceholderData:false,reload:()=>{}};
}}));
import {MyBidsPage} from '../src/components/my-bids-page';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=()=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(MyBidsPage)}));
beforeEach(()=>{state.section=null;state.filter='all';state.referralsConfigured=true;state.urls=[]});

describe('My Bids accepted records and payment attempts',()=>{
 it('defaults to accepted bids with accepted-only totals, real coupons and no attempt request',()=>{
  const html=render();expect(html).toContain('Total</span><strong>42</strong>');expect(html).toContain('Active</span><strong>3</strong>');expect(html).toContain('Won</span><strong>1</strong>');expect(html).toContain('Coupons</span><strong>2</strong>');
  expect(html).toContain('data-bid-id="accepted-bid-id"');expect(html).not.toContain('data-payment-id=');expect(state.urls.some(url=>url.startsWith('/api/payments/'))).toBe(false);
 });
 it.each(['pending','failed','cancelled','review'])('shows only unaccepted %s payment rows under its filter',filter=>{
  state.filter=filter;const html=render();expect(html).not.toContain('data-bid-id=');expect(html).toContain('data-payment-id="attempt-id"');expect(html).toContain('have not created an accepted bid');expect(state.urls).toContain(`/api/payments/chapa/checkouts?purpose=BID&page=1&view=unaccepted&status=${filter}`);
 });
 it('limits Successful to accepted bids rather than treating a paid attempt as an accepted entry',()=>{
  state.filter='successful';const html=render();expect(html).toContain('data-bid-id="accepted-bid-id"');expect(html).not.toContain('data-payment-id=');expect(state.urls.some(url=>url.startsWith('/api/payments/'))).toBe(false);
 });
 it('uses the server active-auction view and shows accepted-specific subfilters',()=>{
  state.filter='active';const html=render();expect(state.urls).toContain('/api/my-bids?view=live&page=1');for(const label of ['Accepted bids','Payment attempts','All','Active','Completed'])expect(html).toContain(`>${label}</button>`);expect(html).not.toContain('>Failed</button>');
 });
 it('shows all attempts only in their selected section with organized attempt subfilters',()=>{
  state.section='attempts';const html=render();expect(html).not.toContain('data-bid-id=');expect(html).toContain('data-payment-id="attempt-id"');expect(state.urls).toContain('/api/payments/chapa/checkouts?purpose=BID&page=1&view=unaccepted');
  for(const label of ['All','Pending','Failed','Cancelled','Needs review'])expect(html).toContain(`>${label}</button>`);expect(html).not.toContain('>Active</button>');
 });
 it('uses completed auction history without mixing in payment attempts',()=>{
  state.filter='completed';const html=render();expect(state.urls).toContain('/api/my-bids?view=history&page=1');expect(html).not.toContain('data-payment-id=');
 });
 it('keeps coupon availability unknown when referral storage is not configured',()=>{
  state.referralsConfigured=false;const html=render();expect(html).toContain('Coupons</span><strong>—</strong>');expect(html).not.toContain('Coupons</span><strong>0</strong>');expect(html).not.toContain('Coupons</span><strong>2</strong>');
 });
});
