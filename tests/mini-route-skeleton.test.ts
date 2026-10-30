import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';

const route=vi.hoisted(()=>({path:'/'}));
vi.mock('next/navigation',()=>({usePathname:()=>route.path}));
import {MiniLocaleProvider} from '../src/components/mini-locale';
import {BidPanelSkeleton,MiniRouteSkeleton,miniSkeletonVariant} from '../src/components/mini-route-skeleton';

const render=(path:string)=>{route.path=path;return renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(MiniRouteSkeleton)}))};
afterEach(()=>{route.path='/'});

describe('customer route loading geometry',()=>{
 it('distinguishes route families and their existing redirect aliases',()=>{
  const destinations={
   '/':'home','/auctions/all?page=2':'catalog','/auctions/phone-123#bid-review':'auction','/categories/phones':'category',
   '/winners':'winners','/winners/all':'winners','/winners/1001':'winner','/draws':'winners',
   '/my-bids':'bids','/winning-bids':'bids','/profile/wins':'bids','/payments':'payments',
   '/profile':'profile','/wallet/deposit':'wallet','/profile/favorites':'catalog','/profile/alerts':'home',
   '/profile/support':'support','/faq':'faq','/terms':'legal','/privacy':'legal',
  } as const;
  for(const [path,variant] of Object.entries(destinations))expect(miniSkeletonVariant(path),path).toBe(variant);
 });
 it('reserves different content structures instead of reusing one page spinner',()=>{
  expect(render('/')).toContain('data-skeleton-part="hero"');
  expect(render('/auctions/phone-123')).toContain('data-skeleton-part="auction-detail"');
  expect(render('/my-bids')).toContain('data-skeleton-part="bid-rows"');
  expect(render('/payments')).toContain('data-skeleton-part="payment-rows"');
  expect(render('/profile')).toContain('data-skeleton-part="profile-identity"');
  expect(render('/profile')).not.toContain('data-skeleton-part="hero"');
 });
 it.each(['/','/auctions/all','/auctions/phone-123','/winners','/winners/1001','/my-bids','/payments','/profile','/wallet','/faq','/terms'])('announces %s loading once without inventing financial data',path=>{
  const html=render(path);
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).toContain('aria-busy="true"');expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('Loading page…');
  expect(html).not.toMatch(/loading-spinner|<img|ETB|0\.00|role="dialog"/);
 });
 it('keeps the existing bid modal loading affordance compact',()=>{
  const html=renderToStaticMarkup(createElement(BidPanelSkeleton));
  expect(html).toContain('customer-loading-compact');expect(html).toContain('loading-spinner-ring');
  expect(html).not.toContain('data-route-skeleton');
 });
});
