import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const f=vi.hoisted(()=>({environment:'browser',referral:{configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',webShareUrl:'https://lowwin.shop/?ref=abcdefghijkl',rewardEtb:'12.50' as string|null,totalEarnedEtb:'12.50',counts:{signedUp:2,qualified:1,earned:1}}}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('../src/components/private-query',()=>({usePrivateQuery:(url:string)=>({status:'authenticated',data:url==='/api/profile'?{displayName:'Player',bio:'',counts:{bids:7},referral:f.referral}:{available:'25.00'},error:'',reload:()=>{}}),PrivateState:()=>null}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({environment:f.environment,queryIdentity:'fixture',me:null,refreshMe:async()=>{},signOut:async()=>{}})}));
vi.mock('../src/components/offline-retry',()=>({OfflineRetry:()=>null}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({children,...props}:{children:React.ReactNode;href:string})=>createElement('a',props,children)}));
vi.mock('../src/components/wallet-top-up-trigger',()=>({WalletTopUpTrigger:({children,...props}:{children:React.ReactNode})=>createElement('button',props,children)}));
import Profile from '../src/app/(mini)/profile/page';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=()=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(Profile)}));
beforeEach(()=>{f.environment='browser';Object.assign(f.referral,{configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',webShareUrl:'https://lowwin.shop/?ref=abcdefghijkl',rewardEtb:'12.50',totalEarnedEtb:'12.50',counts:{signedUp:2,qualified:1,earned:1}})});

describe('Profile referral readiness and wallet rewards',()=>{
 it('shows the wallet reward and amount credited with no coupon controls',()=>{
  const html=render();expect(html).toContain('>Active</span>');expect(html).toContain('Earn ETB 12.50 in your wallet');expect(html).toContain('Referral earnings');expect(html).toContain('>ETB 12.50</strong>');expect(html).not.toContain('My discounts');
 });
 it('selects the website or bot URL while showing the same referral counts',()=>{
  const website=render();
  expect(website).toContain('data-referral-channel="website"');
  expect(website).toContain('value="https://lowwin.shop/?ref=abcdefghijkl"');
  expect(website).not.toContain('https://t.me/lowwin_fixture_bot');
  expect(website).toContain('>2</strong>');
  f.environment='mini';
  const telegram=render();
  expect(telegram).toContain('data-referral-channel="telegram"');
  expect(telegram).toContain('value="https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl"');
  expect(telegram).not.toContain('https://lowwin.shop/?ref=');
  expect(telegram).toContain('>2</strong>');
 });
 it('pauses new invitations and keeps posted earnings visible',()=>{
  Object.assign(f.referral,{enabled:false,shareUrl:null,webShareUrl:null});const html=render();expect(html).toContain('>Paused</span>');expect(html).toContain('Rewards you already earned stay in your wallet');expect(html).toContain('>ETB 12.50</strong>');expect(html).not.toContain('Copy referral link');
 });
 it('does not claim reward terms or availability before storage/policy configuration',()=>{
  Object.assign(f.referral,{configured:false,enabled:false,shareUrl:null,webShareUrl:null,rewardEtb:null,totalEarnedEtb:'0.00'});const html=render();expect(html).toContain('>Unavailable</span>');expect(html).not.toContain('ETB 12.50');expect(html).not.toContain('Copy referral link');
 });
});
