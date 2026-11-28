import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const f=vi.hoisted(()=>({environment:'browser',referral:{configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',webShareUrl:'https://lowwin.shop/?ref=abcdefghijkl',rewardEtb:'12.50' as string|null,totalEarnedEtb:'12.50',counts:{signedUp:2,qualified:1,earned:1},recentInvites:[] as Array<{registeredAt:string;firstBidAccepted:boolean}>}}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('../src/components/private-query',()=>({usePrivateQuery:(url:string)=>({status:'authenticated',data:url==='/api/referrals'?f.referral:url==='/api/profile'?{displayName:'Player',bio:'',counts:{bids:7}}:{available:'25.00'},error:'',reload:()=>{}}),PrivateState:()=>null}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({environment:f.environment,queryIdentity:'fixture',me:null,refreshMe:async()=>{},signOut:async()=>{}})}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({children,...props}:{children:React.ReactNode;href:string})=>createElement('a',props,children)}));
vi.mock('../src/components/wallet-top-up-trigger',()=>({WalletTopUpTrigger:({children,...props}:{children:React.ReactNode})=>createElement('button',props,children)}));
import Profile from '../src/app/(mini)/profile/page';
import Affiliate from '../src/app/(mini)/affiliate/page';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=(page=Affiliate)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(page)}));
beforeEach(()=>{f.environment='browser';Object.assign(f.referral,{configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',webShareUrl:'https://lowwin.shop/?ref=abcdefghijkl',rewardEtb:'12.50',totalEarnedEtb:'12.50',counts:{signedUp:2,qualified:1,earned:1},recentInvites:[{registeredAt:'2026-11-25T19:00:00Z',firstBidAccepted:false},{registeredAt:'2026-11-24T21:30:00Z',firstBidAccepted:true}]})});

describe('Affiliate referral readiness and wallet rewards',()=>{
 it('moves referral controls and earnings out of Me',()=>{
  const html=render(Profile);expect(html).toContain('Total bids');expect(html).not.toContain('data-referral-channel');expect(html).not.toContain('Referral earnings');
 });
 it('shows the wallet reward and amount credited with no coupon controls',()=>{
  Object.assign(f.referral,{totalEarnedEtb:'25.00'});
  const html=render();expect(html).toContain('first accepted bid');expect(html).toContain('goes straight to your wallet');expect(html).toContain('Referral earnings');expect(html).toContain('>ETB 12.50</strong>');expect(html).toContain('>ETB 25.00</strong>');expect(html).not.toContain('My discounts');
 });
 it('selects the website or bot URL while showing the same referral counts',()=>{
  const website=render();
  expect(website).toContain('data-referral-channel="website"');
  expect(website).toContain('value="https://lowwin.shop/?ref=abcdefghijkl"');
  expect(website).not.toContain('https://t.me/lowwin_fixture_bot');
  expect(website).toContain('<dd>2</dd>');
  f.environment='mini';
  const telegram=render();
  expect(telegram).toContain('data-referral-channel="telegram"');
  expect(telegram).toContain('value="https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl"');
  expect(telegram).not.toContain('https://lowwin.shop/?ref=');
  expect(telegram).toContain('<dd>2</dd>');
 });
 it('pauses new invitations and keeps posted earnings visible',()=>{
  Object.assign(f.referral,{enabled:false,shareUrl:null,webShareUrl:null});const html=render();expect(html).toContain('New invitations are paused');expect(html).toContain('Rewards you already earned stay in your wallet');expect(html).toContain('>ETB 12.50</strong>');expect(html).not.toContain('Copy referral link');
 });
 it('shows recent invitation dates in Addis Ababa time and the first bid status',()=>{
  const html=render();expect(html).toContain('Recent invitations');expect(html).toContain('25 Nov 2026, 12:30 AM');expect(html).toContain('>Accepted<');expect(html).toContain('>Pending<');
  f.referral.recentInvites=[];expect(render()).toContain('No one has registered with your link yet.');
 });
 it('does not claim reward terms or availability before storage/policy configuration',()=>{
  Object.assign(f.referral,{configured:false,enabled:false,shareUrl:null,webShareUrl:null,rewardEtb:null,totalEarnedEtb:'0.00'});const html=render();expect(html).toContain('Your invite link is currently unavailable');expect(html).not.toContain('ETB 12.50');expect(html).not.toContain('Copy referral link');
 });
});
