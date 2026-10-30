import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const f=vi.hoisted(()=>({referral:{configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',discountPercent:13 as number|null,expiryDays:20 as number|null,counts:{signedUp:2,qualified:1,earned:1,available:1},coupons:[{id:'fixture-coupon',percent:13,expiresAt:'2026-11-19T00:00:00Z',status:'AVAILABLE'}]}}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('../src/components/private-query',()=>({usePrivateQuery:(url:string)=>({status:'authenticated',data:url==='/api/profile'?{displayName:'Player',bio:'',counts:{bids:7},referral:f.referral}:{available:'25.00'},error:'',reload:()=>{}}),PrivateState:()=>null}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:'fixture',me:null,refreshMe:async()=>{},signOut:async()=>{}})}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({children,...props}:{children:React.ReactNode;href:string})=>createElement('a',props,children)}));
vi.mock('../src/components/wallet-top-up-trigger',()=>({WalletTopUpTrigger:({children,...props}:{children:React.ReactNode})=>createElement('button',props,children)}));
import Profile from '../src/app/(mini)/profile/page';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=()=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(Profile)}));
beforeEach(()=>{Object.assign(f.referral,{configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',discountPercent:13,expiryDays:20,counts:{signedUp:2,qualified:1,earned:1,available:1},coupons:[{id:'fixture-coupon',percent:13,expiresAt:'2026-11-19T00:00:00Z',status:'AVAILABLE'}]})});

describe('Profile referral readiness and earned coupons',()=>{
 it('displays the saved percentage and expiry with an actionable invitation and earned discount',()=>{
  const html=render();expect(html).toContain('>Active</span>');expect(html).toContain('one 13% discount');expect(html).toContain('after 20 days');expect(html).toContain('13% off one submission fee');expect(html).toContain('href="/auctions/all"');expect(html).not.toContain('free bid');
 });
 it('pauses new invitations without hiding already-earned coupons or changing their terms',()=>{
  Object.assign(f.referral,{enabled:false,shareUrl:null});const html=render();expect(html).toContain('>Paused</span>');expect(html).toContain('earned discounts keep their original expiry');expect(html).toContain('13% off one submission fee');expect(html).toContain('Use a discount');
 });
 it('does not claim reward terms or availability before storage/policy configuration',()=>{
  Object.assign(f.referral,{configured:false,enabled:false,shareUrl:null,discountPercent:null,expiryDays:null,coupons:[]});const html=render();expect(html).toContain('>Unavailable</span>');expect(html).not.toContain('13%');expect(html).not.toContain('0 available');expect(html).not.toContain('Use a discount');
 });
});
