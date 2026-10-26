import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({path:'/profile'}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({status:'authenticated',queryIdentity:'fixture'})}));
vi.mock('../src/components/identity-state',()=>({IdentityState:()=> 'Account verification required.'}));
import {MiniLocaleProvider,type MiniLanguage} from '../src/components/mini-locale';
import {CustomerLoading,PageLoading} from '../src/components/loading-spinner';
import {MiniRouteSkeleton,CatalogSkeleton,BidPanelSkeleton} from '../src/components/mini-route-skeleton';
import {MiniRouteLoading} from '../src/components/mini-route-loading';
import {WalletFundingSkeleton} from '../src/components/wallet-funding-skeleton';
import {PrivateState} from '../src/components/private-query';

const render=(element:React.ReactNode,language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:element}));
const waiting={status:'authenticated',data:null,error:'',reload:()=>{}};
afterEach(()=>{state.path='/profile'});

describe('plain customer loading states',()=>{
 it('shows one accessible spinner and concise profile text, without placeholder cards',()=>{
  const html=render(createElement(MiniRouteLoading));
  expect(html).toContain('<p>Loading your profile…</p>');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).toContain('aria-busy="true"');
  expect(html.match(/class="loading-spinner-ring"/g)).toHaveLength(1);
  expect(html).not.toMatch(/skeleton|shimmer|<article|<i\b/);
 });
 it('uses Amharic for the visible loading message and keeps the ring decorative',()=>{
  const html=render(createElement(CustomerLoading,{en:'Loading your profile…',am:'መገለጫዎን በመጫን ላይ…'}),'am');
  expect(html).toContain('<p>መገለጫዎን በመጫን ላይ…</p>');
  expect(html).not.toContain('Loading your profile');
  expect(html).toContain('aria-hidden="true"');
  expect(html.match(/role="status"/g)).toHaveLength(1);
 });
 it.each([
  ['/auctions','Loading auctions…'],['/auctions/1234','Loading auction details…'],
  ['/wallet','Loading your wallet…'],['/payments','Loading bid payments…'],['/my-bids','Loading your bids…'],['/draws','Loading winners…'],
 ])('keeps route loading useful for %s', (path,label)=>{
  state.path=path;
  expect(render(createElement(MiniRouteSkeleton))).toContain(`<p>${label}</p>`);
  expect(render(createElement(PageLoading))).toContain(`<p>${label}</p>`);
 });
 it('replaces catalog, bid and historical payment placeholders with the same simple loader',()=>{
  for(const element of [createElement(CatalogSkeleton),createElement(BidPanelSkeleton),createElement(WalletFundingSkeleton,{variant:'deposits'})]){
   const html=render(element);
   expect(html).toContain('customer-loading');
   expect(html.match(/class="loading-spinner-ring"/g)).toHaveLength(1);
   expect(html).not.toMatch(/skeleton|shimmer|<article|<i\b/);
  }
 });
 it('uses the plain loader for both authentication and an empty private response',()=>{
  for(const status of ['loading','authenticated']){
   const html=render(createElement(PrivateState,{query:{...waiting,status},variant:'profile'}));
   expect(html).toContain('Loading your profile…');
   expect(html).toContain('loading-spinner-ring');
   expect(html).not.toContain('skeleton');
  }
 });
 it('shows a retryable error instead of retaining a spinner when a private request fails',()=>{
  const html=render(createElement(PrivateState,{query:{...waiting,error:'Timed out'},variant:'profile'}));
  expect(html).toContain('role="alert"');
  expect(html).toContain('Could not load this page. Please retry.');
  expect(html).toContain('Retry</button>');
  expect(html).not.toContain('loading-spinner-ring');
 });
 it('uses payment loading copy on the new page and retired route',()=>{
  state.path='/wallet';
  const html=render(createElement(PrivateState,{query:waiting}));
  expect(html).toContain('Loading your wallet…');
  expect(html).not.toContain('Loading your profile');
 });
 it('keeps existing data readable during background refresh and refresh errors',()=>{
  const refreshing=render(createElement(PrivateState,{query:{...waiting,data:{id:'fixture'},fetching:true}}));
  expect(refreshing).toContain('Updating…');
  expect(refreshing).not.toContain('customer-loading');
  const failedRefresh=render(createElement(PrivateState,{query:{...waiting,data:{id:'fixture'},error:'Timed out'}}));
  expect(failedRefresh).toContain('Showing saved details. Refresh failed.');
  expect(failedRefresh).toContain('Retry</button>');
  expect(failedRefresh).not.toContain('loading-spinner-ring');
 });
 it('keeps account verification gating and admin loading separate',()=>{
  expect(render(createElement(PrivateState,{query:{...waiting,status:'guest'}}))).toContain('Account verification required.');
  state.path='/admin';
  expect(render(createElement(PageLoading))).not.toContain('customer-loading');
 });
});
