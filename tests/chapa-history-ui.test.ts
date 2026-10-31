import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const state=vi.hoisted(()=>({items:[] as ChapaCheckoutView[]}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:'owned-history'})}));
vi.mock('../src/components/mini-query-state',()=>({useMiniPage:()=>[1,()=>{}]}));
vi.mock('../src/components/private-query',()=>({PrivateState:()=>null,usePrivateQuery:()=>({data:{items:state.items,page:1,nextPage:null},status:'authenticated',fetching:false,isPlaceholderData:false,reload:()=>{}})}));
import {ChapaPaymentHistory} from '../src/components/chapa-payment-history';
import {MiniLocaleProvider} from '../src/components/mini-locale';

function render(overrides:Partial<ChapaCheckoutView>,language:'en'|'am'='en'){
 state.items=[{id:'owned-checkout',purpose:'TOP_UP',mode:'live',status:'PENDING',amount:'50.00',fundsPreserved:false,receipt:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),...overrides} as ChapaCheckoutView];
 return renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(ChapaPaymentHistory)}));
}
describe('transaction money movement presentation',()=>{
 it('marks committed top-ups as money in with an explicit plus',()=>{
  const html=render({status:'CREDITED'});expect(html).toContain('data-direction="incoming"');expect(html).toContain('Money in: ');expect(html).toContain('aria-hidden="true">+</span>ETB 50.00');expect(html).toContain('Wallet top-up');
 });
 it('marks an accepted bid fee as money out only with its accepted receipt',()=>{
  const receipt={bid:{id:'accepted-bid'}} as ChapaCheckoutView['receipt'];
  const html=render({purpose:'BID',status:'BID_ACCEPTED',receipt,auctionTitle:'Power bank',bidNumber:'4.25'});expect(html).toContain('data-direction="outgoing"');expect(html).toContain('Money out: ');expect(html).toContain('aria-hidden="true">−</span>ETB 50.00');expect(html).toContain('Power bank');expect(html).toContain('#4.25');
  expect(render({purpose:'BID',status:'BID_ACCEPTED',receipt:null})).toContain('data-direction="none"');
 });
 it.each(['PENDING','VERIFYING','AUTH_NEEDED','FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED','NEEDS_REVIEW'])('never shows a completed transfer for %s',status=>{
  const html=render({status,providerStatus:status==='NEEDS_REVIEW'?'SUCCESS':status});expect(html).toContain('data-direction="none"');expect(html).toContain('Payment amount: ');expect(html).not.toContain('Money in: ');expect(html).not.toContain('Money out: ');
 });
 it('shows funds preserved after an unaccepted bid as a wallet credit, not a spent bid fee',()=>{
  const html=render({purpose:'BID',status:'NEEDS_REVIEW',fundsPreserved:true});expect(html).toContain('data-direction="incoming"');expect(html).toContain('Payment saved to wallet');expect(html).not.toContain('Money out: ');
 });
 it('keeps test labeling and localized transaction wording explicit',()=>{
  const html=render({status:'CREDITED',mode:'test'},'am');expect(html).toContain('የሙከራ ክፍያ');expect(html).toContain('የገባ ገንዘብ፦ ');expect(html).toContain('የዋሌት ገቢ');
 });
});
