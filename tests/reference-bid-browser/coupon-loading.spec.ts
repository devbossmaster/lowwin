import {expect,test} from '@playwright/test';
import {inlineFixture,openBid} from '../checkout-v2-inline-browser/fixtures';

for(const am of [false,true])test(`coupons render independently of slow bid details and reuse the account cache ${am?'AM':'EN'}`,async({page},info)=>{
 test.skip(info.project.name!=='360','Account query/cache behavior is covered once per language.');
 const f=await inlineFixture(page,am);let countReads=0,release=()=>{};
 const gate=new Promise<void>(resolve=>{release=resolve});
 try{
  await page.route('**/api/referrals/coupon-count',route=>{countReads++;return route.fulfill({json:{configured:true,available:3}})});
  await page.route(/\/api\/auctions\/[^/]+\/bids$/,async route=>{const response=await route.fetch();await gate;return route.fulfill({response})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  let dialog=await openBid(page,f.title);
  await expect(dialog.locator('[data-bid-coupons] b')).toHaveText('3');
  expect(countReads).toBe(1);expect(f.commands).toHaveLength(0);
  release();await expect(dialog.locator('[data-chapa-methods]')).toBeVisible();
  await dialog.getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).click();
  dialog=await openBid(page,f.title);
  await expect(dialog.locator('[data-bid-coupons] b')).toHaveText('3');
  expect(countReads).toBe(1);expect(f.commands).toHaveLength(0);
 }finally{release();await f.cleanup()}
});
