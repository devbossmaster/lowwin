import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';

vi.mock('../src/components/admin-ui',()=>({ErrorNotice:()=>null,useAdminMutation:()=>({run:vi.fn(),clear:vi.fn(),error:''})}));
import AdminWinnerPhoto from '../src/components/admin-winner-photo';

describe('winner photo banner crop guidance',()=>{
 it('explains the canonical crop before an administrator chooses or publishes a photo',()=>{
  const html=renderToStaticMarkup(createElement(AdminWinnerPhoto,{winner:{auctionId:'synthetic-auction'},onSaved:()=>{}}));
  expect(html).toContain('1840 × 800');expect(html).toContain('2.3:1');expect(html).toContain('center-cropped without stretching');
  expect(html).toContain('aria-describedby="winner-photo-crop-help"');expect(html).toContain('save a photo before publishing');
  expect(html).not.toContain('data-winner-crop-preview');
 });
 it('previews an existing photo in the banner layout and retains the product-image reset action',()=>{
  const html=renderToStaticMarkup(createElement(AdminWinnerPhoto,{winner:{auctionId:'synthetic-auction',winnerPhotoId:'approved-photo',winnerPhotoPath:'/api/media/approved-photo'},onSaved:()=>{}}));
  expect(html).toContain('data-winner-crop-preview');expect(html).toContain('width="1840"');expect(html).toContain('height="800"');
  expect(html).toContain('result details stay on the left');expect(html).toContain('Use product image again');
 });
});
