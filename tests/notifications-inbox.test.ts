import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({identity:'owner:session' as string|null,data:{items:[{id:'deposit-1',kind:'DEPOSIT_CREDITED',title:'Deposit successful',body:'25.50 ETB was added to your wallet.',href:'/wallet',readAt:null as string|null,createdAt:'2026-11-16T09:00:00Z'},{id:'bid-1',kind:'BID_ACCEPTED',title:'Bid accepted',body:'Your number 4.25 was accepted.',href:'/my-bids',readAt:'2026-11-16T09:05:00Z',createdAt:'2026-11-16T08:00:00Z'}],total:2,totalPages:2,unread:1,categories:['all','draws','payments']}}));
vi.mock('next/link',()=>({default:({href,children,prefetch,...props}:{href:string;children:ReactNode;prefetch?:boolean})=>createElement('a',{href,...props},children)}));
vi.mock('../src/components/telegram-provider',()=>({useTelegram:()=>({queryIdentity:fixture.identity})}));
vi.mock('../src/components/private-query',()=>({usePrivateQuery:()=>({data:fixture.data}),PrivateState:()=>null,PersonalPagination:({page,totalPages}:{page:number;totalPages:number})=>createElement('span',{'data-pagination':`${page}/${totalPages}`})}));
vi.mock('../src/components/private-query-cache',()=>({invalidatePrivateQueries:vi.fn()}));
import {NotificationsInbox} from '../src/components/notifications-inbox';
import {MiniLocaleProvider} from '../src/components/mini-locale';
const render=(language:'en'|'am'='en')=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:language,children:createElement(NotificationsInbox)}));
beforeEach(()=>{fixture.identity='owner:session';fixture.data.unread=1;fixture.data.categories=['all','draws','payments'];fixture.data.items[0].readAt=null});
describe('notification inbox presentation',()=>{
 it('preserves receipt facts, owned links and pagination in compact rows',()=>{
  const html=render();expect(html).toContain('25.50 ETB was added to your wallet.');expect(html).toContain('Your number 4.25 was accepted.');expect(html).toContain('href="/wallet"');expect(html).toContain('href="/my-bids"');expect(html).toContain('data-pagination="1/2"');expect(html.match(/data-notification-row="true"/g)).toHaveLength(2);expect(html).toContain('lucide-wallet');expect(html).toContain('lucide-ticket');
 });
 it('marks only unread rows and keeps individual and bulk read actions available',()=>{
  const html=render();expect(html.match(/data-unread="true"/g)).toHaveLength(1);expect(html.match(/aria-label="Unread"/g)).toHaveLength(1);expect(html.match(/data-notification-mark-read="true"/g)).toHaveLength(1);expect(html).toContain('data-notifications-mark-all="true"');expect(html).toContain('dateTime="2026-11-16T09:00:00Z"');
 });
 it('keeps current filters without adding an unsupported promotions category',()=>{
  const html=render();for(const category of ['all','draws','payments'])expect(html).toContain(`data-notification-filter="${category}"`);expect(html).not.toContain('data-notification-filter="promotions"');expect(html).toContain('aria-pressed="true"');
 });
 it('localizes controls while leaving existing notification copy rules in place',()=>{
  const html=render('am');expect(html).toContain('የማሳወቂያ ምድብ');expect(html).toContain('የእርስዎ ማሳወቂያዎች');expect(html).toContain('aria-label="ያልተነበበ"');expect(html).toContain('ተነብቧል');expect(html).toContain('href="/wallet"');
 });
});
