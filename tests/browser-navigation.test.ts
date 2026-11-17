import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({path:'/my-bids',state:{status:'authenticated',queryIdentity:'account-a:session-a',me:{user:{id:'account-a'}},environment:'browser'} as {status:string;queryIdentity:string|null;me:{user:{id:string}}|null;environment:string}}));
vi.mock('next/navigation',()=>({usePathname:()=>f.path}));
vi.mock('next/link',()=>({default:({href,children,...props}:{href:string;children:ReactNode})=>createElement('a',{href,...props},children)}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({href,children,scroll,...props}:{href:string;children:ReactNode;scroll?:boolean})=>createElement('a',{href,...props},children)}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>f.state}));
vi.mock('../src/components/auction-quick-list',()=>({AuctionQuickList:({className}:{className?:string})=>createElement('div',null,createElement('button',{type:'button',className,'aria-label':'Browse auctions','aria-haspopup':'dialog','data-auction-shortcut':true},createElement('span',{className:'lucide-gavel'})))}));
import {BrowserNavigation,CustomerNavigation} from '../src/components/browser-navigation';
import {BottomNavigation} from '../src/components/bottom-navigation';
import {activeCustomerNavigation} from '../src/components/customer-navigation-items';
import {MiniLocaleProvider,type MiniLanguage} from '../src/components/mini-locale';
import {miniNavigationState,publicMiniNavigationState} from '../src/components/mini-navigation-state';
const render=(language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(BrowserNavigation)}));
const renderMobile=(language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(BottomNavigation)}));
const renderShared=(language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(CustomerNavigation)}));
beforeEach(()=>{f.path='/my-bids';f.state={status:'authenticated',queryIdentity:'account-a:session-a',me:{user:{id:'account-a'}},environment:'browser'};miniNavigationState.setIdentity(f.state.queryIdentity)});
afterEach(()=>{miniNavigationState.setIdentity(null);publicMiniNavigationState.setIdentity(null);publicMiniNavigationState.setIdentity('public')});

describe('server-confirmed customer navigation',()=>{
 it.each(['loading','guest','contact-required','error'])('hides navigation while %s even with a retained account snapshot',status=>{
  f.state.status=status;
  for(const html of [render(),renderMobile(),renderShared()]){expect(html).not.toContain('<nav');expect(html).not.toContain('data-browser-navigation');expect(html).not.toMatch(/href="\/(?:my-bids|payments|profile)/)}
 });
 it.each(['me','queryIdentity'])('requires a confirmed %s before showing navigation',missing=>{
  if(missing==='me')f.state.me=null;else f.state.queryIdentity=null;
  for(const html of [render(),renderMobile()]){expect(html).not.toContain('<nav');expect(html).not.toContain('data-browser-navigation')}
 });
 it.each(['en','am'] as const)('renders accessible current-route links after confirmed registration in %s',language=>{
  const html=render(language);expect(html).toContain('data-browser-navigation');expect(html).toContain('<nav');expect(html).toContain('aria-current="page"');
  for(const path of ['/','/winners','/my-bids','/profile'])expect(html).toContain(`href="${path}"`);
  expect(html).not.toContain('href="/payments"');expect(html).toContain('lucide-gavel');expect(html).toContain(language==='en'?'Main navigation':'ዋና አሰሳ');expect(html).not.toContain('<aside');
 });
 it('restores only the current account’s saved destination and drops it after logout/account change',()=>{
  miniNavigationState.remember('account-a:session-a','/my-bids?view=finished',400);
  expect(render()).toContain('href="/my-bids?view=finished"');
  f.state={status:'guest',queryIdentity:null,me:null,environment:'browser'};miniNavigationState.setIdentity(null);expect(render()).not.toContain('view=finished');
  f.state={status:'authenticated',queryIdentity:'account-b:session-b',me:{user:{id:'account-b'}},environment:'browser'};miniNavigationState.setIdentity(f.state.queryIdentity);
  const html=render();expect(html).toContain('href="/my-bids"');expect(html).not.toContain('view=finished');
 });
 it('restores public Home filters from the same memory as the loaded pages and scroll',()=>{
  publicMiniNavigationState.remember('public','/?q=QA%20client%20flow&sort=fee-low',3202);
  publicMiniNavigationState.rememberPage('public','/?sort=fee-low&q=QA+client+flow',2);
  for(const html of [render(),renderMobile(),renderShared()])expect(html).toContain('href="/?q=QA%20client%20flow&amp;sort=fee-low"');
  miniNavigationState.setIdentity('account-b:session-b');f.state.queryIdentity='account-b:session-b';
  expect(renderMobile()).toContain('href="/?q=QA%20client%20flow&amp;sort=fee-low"');
  expect(publicMiniNavigationState.page('public','/?sort=fee-low&q=QA+client+flow')).toBe(2);
 });
 it('lets Home render the shared links without a second standalone brand/header',()=>{
  f.path='/';expect(render()).toBe('');
  for(const html of [renderShared('en'),renderShared('am')]){
   expect(html).toContain('data-customer-navigation');expect(html).not.toContain('<header');
   expect(html).toMatch(/href="\/"[^>]*aria-current="page"/);
   for(const path of ['/','/winners','/my-bids','/profile'])expect(html).toContain(`href="${path}"`);
  }
 });
 it('uses the same navigation for an owned Mini App account and browser OAuth account',()=>{
  const browser=render();f.state.environment='mini';const mini=render();
  for(const html of [browser,mini,renderMobile()]){expect(html).not.toContain('href="/payments"');expect(html).toContain('href="/my-bids"');expect(html).toContain('lucide-gavel')}
  expect(renderMobile()).toContain('data-bid="true"');
 });
 it.each(['en','am'] as const)('keeps the five mobile actions ordered with a real auction shortcut in %s',language=>{
  const html=renderMobile(language),positions=['href="/"','href="/my-bids"','data-auction-shortcut="true"','href="/winners"','href="/profile"'].map(value=>html.indexOf(value));
  expect(positions.every((position,index)=>position>=0&&(index===0||position>positions[index-1]))).toBe(true);
  expect(html.match(/href="/g)).toHaveLength(4);expect(html.match(/data-auction-shortcut="true"/g)).toHaveLength(1);
  expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain(language==='en'?'>Bid<':'>ይጫረቱ<');expect(html).toContain(language==='en'?'>Me<':'>እኔ<');
  expect(html).not.toContain('href="/bid"');expect(html).not.toContain('href="/payments"');
  const desktop=renderShared(language);expect(desktop.indexOf('href="/winners"')).toBeLessThan(desktop.indexOf('href="/my-bids"'));expect(desktop).not.toContain('data-auction-shortcut');
 });
 it.each(['/payments','/payments/receipt','/wallet','/wallet/history'])('keeps %s under Profile without adding a Transactions navigation link',path=>{
  f.path=path;expect(activeCustomerNavigation(path)).toBe('/profile');
  for(const html of [render(),renderMobile()]){expect(html).toContain('href="/profile"');expect(html).toMatch(/href="\/profile"[^>]*aria-current="page"/);expect((html.match(/<nav[\s\S]*?<\/nav>/)?.[0].match(/href="/g)??[]).length).toBe(4)}
 });
});
