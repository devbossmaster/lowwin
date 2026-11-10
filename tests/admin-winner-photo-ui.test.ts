import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
vi.mock('../src/components/admin-ui',()=>({ErrorNotice:()=>null,useAdminMutation:()=>({run:vi.fn(),clear:vi.fn(),error:''})}));
import AdminWinnerPhoto from '../src/components/admin-winner-photo';
describe('complete Winners banner guidance',()=>{
 it('explains the distinct canonical WebP banner without manual publication',()=>{
  const html=renderToStaticMarkup(createElement(AdminWinnerPhoto,{winner:{auctionId:'synthetic-auction'},onSaved:()=>{}}));
  expect(html).toContain('1840 × 800');expect(html).toContain('2.3:1');expect(html).toContain('center-cropped without stretching');expect(html).toContain('saved as WebP');
  expect(html).toContain('Results publish automatically');expect(html).toContain('aria-describedby=');expect(html).not.toContain('data-winner-banner-preview');expect(html).not.toContain('Publish result');
 });
 it('previews the complete image without adding a second result overlay',()=>{
  const html=renderToStaticMarkup(createElement(AdminWinnerPhoto,{winner:{auctionId:'synthetic-auction',winnerBannerId:'banner',winnerBannerPath:'/api/media/banner'},onSaved:()=>{}}));
  expect(html).toContain('data-winner-banner-preview');expect(html).toContain('width="1840"');expect(html).toContain('height="800"');expect(html).not.toContain('result details stay on the left');expect(html).toContain('Use product image again');
 });
 it('preserves the historical photograph layout until an explicit override',()=>{
  const html=renderToStaticMarkup(createElement(AdminWinnerPhoto,{winner:{auctionId:'synthetic-auction',winnerPhotoId:'old-photo',winnerPhotoPath:'/api/media/old-photo'},onSaved:()=>{}}));
  expect(html).toContain('Existing photograph layout retained');expect(html).not.toContain('data-winner-banner-preview');expect(html).toContain('Use product image again');
 });
});