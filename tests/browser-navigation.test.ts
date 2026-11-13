import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({path:'/my-bids',state:{status:'authenticated',queryIdentity:'account-a:session-a',me:{user:{id:'account-a'}},environment:'browser'} as {status:string;queryIdentity:string|null;me:{user:{id:string}}|null;environment:string}}));
vi.mock('next/navigation',()=>({usePathname:()=>f.path}));
vi.mock('next/link',()=>({default:({href,children,...props}:{href:string;children:ReactNode})=>createElement('a',{href,...props},children)}));
vi.mock('../src/components/intent-prefetch-link',()=>({IntentPrefetchLink:({href,children,scroll,...props}:{href:string;children:ReactNode;scroll?:boolean})=>createElement('a',{href,...props},children)}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>f.state}));
import {BrowserNavigation} from '../src/components/browser-navigation';
import {BottomNavigation} from '../src/components/bottom-navigation';
import {MiniLocaleProvider,type MiniLanguage} from '../src/components/mini-locale';
import {miniNavigationState} from '../src/components/mini-navigation-state';
const render=(language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(BrowserNavigation)}));
const renderMobile=(language:MiniLanguage='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(BottomNavigation)}));
beforeEach(()=>{f.path='/my-bids';f.state={status:'authenticated',queryIdentity:'account-a:session-a',me:{user:{id:'account-a'}},environment:'browser'};miniNavigationState.setIdentity(f.state.queryIdentity)});
afterEach(()=>miniNavigationState.setIdentity(null));

describe('server-confirmed customer navigation',()=>{
 it.each(['loading','guest','contact-required','error'])('hides navigation while %s even with a retained account snapshot',status=>{
  f.state.status=status;
  for(const html of [render(),renderMobile()]){expect(html).not.toContain('<nav');expect(html).not.toContain('data-browser-navigation');expect(html).not.toMatch(/href="\/(?:my-bids|payments|profile)/)}
 });
 it.each(['me','queryIdentity'])('requires a confirmed %s before showing navigation',missing=>{
  if(missing==='me')f.state.me=null;else f.state.queryIdentity=null;
  for(const html of [render(),renderMobile()]){expect(html).not.toContain('<nav');expect(html).not.toContain('data-browser-navigation')}
 });
 it.each(['en','am'] as const)('renders accessible current-route links after confirmed registration in %s',language=>{
  const html=render(language);expect(html).toContain('data-browser-navigation');expect(html).toContain('<nav');expect(html).toContain('aria-current="page"');
  for(const path of ['/','/winners','/my-bids','/payments','/profile'])expect(html).toContain(`href="${path}"`);
  expect(html).toContain(language==='en'?'Transactions':'ግብይቶች');expect(html).toContain(language==='en'?'Main navigation':'ዋና አሰሳ');expect(html).not.toContain('<aside');
 });
 it('restores only the current account’s saved destination and drops it after logout/account change',()=>{
  miniNavigationState.remember('account-a:session-a','/my-bids?view=finished',400);
  expect(render()).toContain('href="/my-bids?view=finished"');
  f.state={status:'guest',queryIdentity:null,me:null,environment:'browser'};miniNavigationState.setIdentity(null);expect(render()).not.toContain('view=finished');
  f.state={status:'authenticated',queryIdentity:'account-b:session-b',me:{user:{id:'account-b'}},environment:'browser'};miniNavigationState.setIdentity(f.state.queryIdentity);
  const html=render();expect(html).toContain('href="/my-bids"');expect(html).not.toContain('view=finished');
 });
 it('uses the same navigation for an owned Mini App account and browser OAuth account',()=>{
  const browser=render();f.state.environment='mini';const mini=render();
  expect(browser).toContain('href="/payments"');expect(mini).toContain('href="/payments"');
  expect(renderMobile()).toContain('href="/payments"');
 });
});
