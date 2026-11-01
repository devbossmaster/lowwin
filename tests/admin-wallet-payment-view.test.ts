import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({path:'',data:null as null|{item:Record<string,unknown>},loading:false,error:null as string|null}));
vi.mock('../src/components/admin-ui',()=>({
 centsToEtb:(value:string)=>{const cents=BigInt(value);return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`},
 eat:()=> '1 Nov 2026, 13:00 EAT',ErrorNotice:({error}:{error:string|null})=>error?createElement('p',{role:'alert'},error):null,
 Status:({value}:{value:string})=>createElement('span',null,value),
 useAdminRead:(path:string)=>{state.path=path;return {...state,reload:()=>{}}},
}));
vi.mock('../src/components/loading-spinner',()=>({LoadingSpinner:({label}:{label:string})=>createElement('span',{role:'status'},label)}));
import {AdminWalletBidPayment} from '../src/components/admin-wallet-bid-payment';
const render=()=>renderToStaticMarkup(createElement(AdminWalletBidPayment,{id:'owned-wallet-bid'}));
beforeEach(()=>{state.path='';state.data=null;state.loading=false;state.error=null});
describe('wallet fee payment details',()=>{
 it('shows the net deduction and coupon separately without provider verification controls',()=>{
  state.data={item:{id:'owned-wallet-bid',playerName:'Fixture Player',title:'Power Bank',auctionCode:'LW-5',amountCents:'4500',grossFee:'50',discountPoints:'5',status:'BID_ACCEPTED',createdAt:'2026-11-01T10:00:00Z'}};
  const html=render();expect(state.path).toBe('payments/wallet-bids/owned-wallet-bid');expect(html).toContain('Wallet');expect(html).toContain('45.00');expect(html).toContain('50.00');expect(html).toContain('5.00');expect(html).toContain('Power Bank');expect(html).toContain('BID_ACCEPTED');expect(html).not.toContain('Check with Chapa');expect(html).not.toContain('<form');
 });
 it('shows loading or an error without inventing a paid record',()=>{
  state.loading=true;expect(render()).toContain('Loading wallet payment details');state.loading=false;state.error='Staff credentials required.';
  const html=render();expect(html).toContain('role="alert"');expect(html).not.toContain('BID_ACCEPTED');expect(html).not.toContain('Paid from wallet');
 });
});
