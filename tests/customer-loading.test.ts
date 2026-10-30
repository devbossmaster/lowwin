import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({path:'/profile'}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path,useSearchParams:()=>new URLSearchParams(),useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({status:'authenticated',queryIdentity:'fixture'})}));
vi.mock('../src/components/identity-state',()=>({IdentityState:()=> 'Account verification required.'}));
vi.mock('../src/components/mini-header',()=>({MiniHeader:()=>createElement('header',null,'Home header')}));
import {MiniLocaleProvider,type MiniLanguage} from '../src/components/mini-locale';
import {CustomerLoading,PageLoading} from '../src/components/loading-spinner';
import {BrandedLaunchLoading,LaunchSplash} from '../src/components/launch-splash';
import {HomePageContent} from '../src/components/home-page-content';
import {MiniRouteSkeleton,CatalogSkeleton,BidPanelSkeleton} from '../src/components/mini-route-skeleton';
import {MiniRouteLoading} from '../src/components/mini-route-loading';
import {WalletFundingSkeleton} from '../src/components/wallet-funding-skeleton';
import {PrivateState} from '../src/components/private-query';

const render=(element:React.ReactNode,language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:element}));
const waiting={status:'authenticated',data:null,error:'',reload:()=>{}};
afterEach(()=>{state.path='/profile'});

describe('launch and route-specific customer loading',()=>{
 it.each(['en','am'] as const)('limits the new logo, spinner and concise loading copy to launch in %s',language=>{
  const html=render(createElement(LaunchSplash),language);
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html.match(/<img\b/g)).toHaveLength(1);expect(html).toContain('/images/lowwin-logo-20261030.webp');
  expect(html).toContain('alt="Lowwin"');expect(html).toContain('data-lowwin-logo');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html.match(/class="loading-spinner-ring"/g)).toHaveLength(1);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain(language==='en'?'Loading…':'በመጫን ላይ…');
  expect(html).not.toMatch(/Connecting securely|Opening Lowin|data-route-skeleton/);
 });
 it('can embed branded launch status without another main landmark',()=>{
  const html=render(createElement(BrandedLaunchLoading));
  expect(html).not.toMatch(/<main\b/);expect(html).toContain('/images/lowwin-logo-20261030.webp');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html.match(/class="loading-spinner-ring"/g)).toHaveLength(1);
 });
 it('uses the Home layout skeleton on route loading without replaying launch branding',()=>{
  state.path='/';const html=render(createElement(MiniRouteLoading));
  expect(html).toContain('data-route-skeleton="home"');expect(html).toContain('data-skeleton-part="hero"');
  expect(html).not.toMatch(/<main\b|<img|loading-spinner-ring|Home header/);
 });
 it('preserves the stable hidden header slot while cold Home reserves its actual layout',()=>{
  const client=new QueryClient(),query={q:'',status:'live' as const,sort:'code' as const,page:1};
  const html=render(createElement(QueryClientProvider,{client},createElement(HomePageContent,{query,children:null})));
  expect(html).toContain('<div class="home-header-slot" hidden=""><header>Home header</header></div>');
  expect(html).toContain('data-route-skeleton="home"');expect(html).toContain('data-skeleton-part="hero"');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).not.toMatch(/<main\b|<img|loading-spinner-ring/);client.clear();
 });
 it.each([
  ['/auctions','catalog'],['/auctions/1234','auction'],['/categories/phones','category'],
  ['/wallet','wallet'],['/payments','payments'],['/my-bids','bids'],['/draws','winners'],
  ['/winners/1234','winner'],['/profile','profile'],['/faq','faq'],['/privacy','legal'],
 ])('keeps every page loading entry aligned with the destination %s', (path,variant)=>{
  state.path=path;
  for(const element of [createElement(MiniRouteSkeleton),createElement(PageLoading),createElement(CustomerLoading)]){
   const html=render(element);expect(html).toContain(`data-route-skeleton="${variant}"`);
   expect(html.match(/role="status"/g)).toHaveLength(1);expect(html).toContain('aria-busy="true"');
   expect(html).not.toMatch(/loading-spinner-ring|<img/);
  }
 });
 it('announces page skeleton loading in Amharic without a visible page spinner',()=>{
  const html=render(createElement(CustomerLoading),'am');
  expect(html).toContain('ገጹን በመጫን ላይ…');expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('loading-spinner-ring');
 });
 it('keeps compact modal loading as a decorative spinner with the requested copy',()=>{
  const html=render(createElement(CustomerLoading,{compact:true,en:'Loading payment details…',am:'የክፍያ ዝርዝሮችን በመጫን ላይ…'}),'am');
  expect(html).toContain('<p>የክፍያ ዝርዝሮችን በመጫን ላይ…</p>');expect(html).toContain('customer-loading-compact');
  expect(html.match(/class="loading-spinner-ring"/g)).toHaveLength(1);expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).not.toContain('data-route-skeleton');
 });
 it('uses auction geometry for the catalog while retaining compact bid/payment modal loaders',()=>{
  const catalog=render(createElement(CatalogSkeleton));
  expect(catalog).toContain('data-route-skeleton="catalog"');expect(catalog).toContain('data-skeleton-part="auction-card"');
  expect(catalog).not.toContain('loading-spinner-ring');
  for(const element of [createElement(BidPanelSkeleton),createElement(WalletFundingSkeleton,{variant:'deposits'})]){
   const html=render(element);expect(html).toContain('customer-loading-compact');
   expect(html.match(/class="loading-spinner-ring"/g)).toHaveLength(1);expect(html).not.toContain('data-route-skeleton');
  }
 });
 it('reserves the private page layout while authentication or the initial response is pending',()=>{
  for(const status of ['loading','authenticated']){
   const html=render(createElement(PrivateState,{query:{...waiting,status},variant:'profile'}));
   expect(html).toContain('data-route-skeleton="profile"');expect(html).not.toMatch(/<img|loading-spinner-ring/);
  }
 });
 it('shows a retryable error rather than loading geometry after an initial request fails',()=>{
  const html=render(createElement(PrivateState,{query:{...waiting,error:'Timed out'},variant:'profile'}));
  expect(html).toContain('role="alert"');expect(html).toContain('Could not load this page. Please retry.');
  expect(html).toContain('Retry</button>');expect(html).not.toMatch(/loading-spinner-ring|data-route-skeleton/);
 });
 it('uses wallet geometry on the retired wallet route',()=>{
  state.path='/wallet';expect(render(createElement(PrivateState,{query:waiting}))).toContain('data-route-skeleton="wallet"');
 });
 it('keeps existing private data readable during background refresh and refresh errors',()=>{
  const refreshing=render(createElement(PrivateState,{query:{...waiting,data:{id:'fixture'},fetching:true}}));
  expect(refreshing).toContain('Updating…');expect(refreshing).not.toMatch(/customer-loading|data-route-skeleton/);
  const failed=render(createElement(PrivateState,{query:{...waiting,data:{id:'fixture'},error:'Timed out'}}));
  expect(failed).toContain('Showing saved details. Refresh failed.');expect(failed).toContain('Retry</button>');
  expect(failed).not.toMatch(/loading-spinner-ring|data-route-skeleton/);
 });
 it('keeps verification gating and the admin loading system separate',()=>{
  expect(render(createElement(PrivateState,{query:{...waiting,status:'guest'}}))).toContain('Account verification required.');
  state.path='/admin';expect(render(createElement(PageLoading))).not.toMatch(/customer-loading|data-route-skeleton|<img/);
 });
});
