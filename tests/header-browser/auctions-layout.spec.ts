import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'auction-layout-fixture',name:'Tester'},wallet:{available:'0',held:'0',demo:true}}}));
 await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
 await page.route('**/api/favorites/*',route=>route.fulfill({json:{saved:false}}));
});

test('auction cards stay full width and inside the page at phone sizes',async({page})=>{
 await page.goto('/auctions/all');
 await expect(page.getByRole('heading',{level:1,name:'All auctions'})).toBeVisible();
 const auctionPage=page.locator('#main > main');
 await expect(auctionPage).toHaveCSS('background-color','rgb(255, 255, 255)');
 const carousels=page.locator('#featured .featured-carousel, #active .featured-carousel, #upcoming .featured-carousel');
 expect(await carousels.count()).toBeGreaterThan(0);
 const checkLayout=async()=>{
  const frame=await page.locator('.app-frame').boundingBox();
  expect(frame).toBeTruthy();
  for(const carousel of await carousels.all()){
   const section=await carousel.locator('xpath=ancestor::section[1]').boundingBox();
   const card=carousel.locator('article').first();
   await expect(card).toBeVisible();
   const bounds=await card.boundingBox();
   expect(section&&bounds).toBeTruthy();
   expect(bounds!.width).toBeGreaterThan(frame!.width*.7);
   expect(bounds!.x).toBeGreaterThanOrEqual(section!.x);
   expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(section!.x+section!.width);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 };
 await checkLayout();
 await page.getByRole('combobox',{name:'Language'}).selectOption('am');
 await checkLayout();
});
