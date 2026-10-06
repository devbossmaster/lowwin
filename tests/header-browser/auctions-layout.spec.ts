import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'auction-layout-fixture',name:'Tester'},wallet:{available:'0',held:'0',demo:true}}}));
 await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
 await page.route('**/api/favorites/*',route=>route.fulfill({json:{saved:false}}));
});

test('auction list follows the winners layout at phone widths',async({page})=>{
 await page.goto('/auctions/all');
 await expect(page.getByRole('navigation',{name:'Auction status'})).toBeVisible();
 const listing=page.locator('[data-auction-list]');
 const cards=listing.locator('article');
 await expect(cards.first()).toBeVisible();
 const checkLayout=async()=>{
  const frame=await page.locator('.app-frame').boundingBox();
  const content=await listing.boundingBox();
  expect(frame&&content).toBeTruthy();
  for(const card of await cards.all()){
   const bounds=await card.boundingBox();
   expect(bounds).toBeTruthy();
   expect(bounds!.width).toBeGreaterThan(frame!.width*.7);
   expect(bounds!.x).toBeGreaterThanOrEqual(content!.x);
   expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(content!.x+content!.width);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 };
 await checkLayout();
 const codes=await listing.locator('.card-code').allTextContents();
 expect(codes.map(value=>Number(value.match(/\d+$/)?.[0]))).toEqual(codes.map(value=>Number(value.match(/\d+$/)?.[0])).sort((a,b)=>a-b));
 await page.getByRole('combobox',{name:'Language'}).selectOption('am');
 await checkLayout();
 const upcoming=page.getByRole('navigation',{name:'Auction status'}).getByRole('link',{name:/የሚመጡ/});
 await upcoming.click();
 await expect(page).toHaveURL(/status=upcoming/);
 await expect(upcoming).toHaveAttribute('aria-current','page');
});
