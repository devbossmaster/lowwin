import {expect,test} from '@playwright/test';
import {inlineFixture,openBid} from '../checkout-v2-inline-browser/fixtures';

for(const am of [false,true])test(`standard checkout opens without a coupon request or control ${am?'AM':'EN'}`,async({page},info)=>{
 test.skip(info.project.name!=='360','The removed checkout controls are covered once per language.');
 const f=await inlineFixture(page,am),retiredRequests:string[]=[];
 page.on('request',request=>{if(/coupon-count|discount-quote/.test(new URL(request.url()).pathname))retiredRequests.push(request.url())});
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const dialog=await openBid(page,f.title);
  await expect(dialog.locator('[data-bid-step=entry]')).toBeVisible();
  await expect(dialog.locator('[data-bid-coupons]')).toHaveCount(0);
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  expect(retiredRequests).toEqual([]);expect(f.commands).toHaveLength(0);
 }finally{await f.cleanup()}
});
