import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'category-fixture',name:'Tester'},wallet:{available:'750',held:'10',demo:true}}}));
 await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
});

test('legacy category links redirect to the canonical filtered view and preserve supported filters',async({page},info)=>{
 await page.goto('/categories/watches?status=live&sort=ending');
 await expect(page).toHaveURL(/\/auctions\/all\?status=live&category=watches&sort=ending/);
 await expect(page.getByRole('heading',{level:1,name:'Watches'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Live auctions'})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Auction status'}).getByRole('link',{name:/Live/})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('heading',{name:'Upcoming auctions'})).toHaveCount(0);
 if(await page.locator('.featured-carousel article').count())await expect(page.locator('.featured-carousel article').first()).toBeVisible();
 const code=page.locator('.featured-carousel .facts>div:last-child strong').first();
 if(await code.count())await expect(code).toHaveText(/^\d+$/);
 const auctionLink=page.locator('a[href^="/auctions/"]').filter({has:page.locator('img')}).last();
 if(await auctionLink.count())await expect(auctionLink).toHaveAttribute('href',/^\/auctions\/\d+$/);
 // A carousel must remain in normal flow; the Live badge uses absolute positioning.
 for(const carousel of await page.locator('.featured-carousel').all()){
  await expect(carousel).not.toHaveCSS('position','absolute');
  const fits=await carousel.evaluate(element=>{
   const card=element.querySelector('article'),section=element.closest('section');
   if(!card||!section)return false;
   const bounds=card.getBoundingClientRect(),container=element.getBoundingClientRect();
   const heading=section.querySelector('h2')?.getBoundingClientRect();
   return bounds.width>=container.width*.75&&bounds.left>=container.left-1
    &&bounds.right<=container.right+1&&(!heading||bounds.top>=heading.bottom);
  });
  expect(fits).toBe(true);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/auctions/all?category=watches');
 await expect(page.getByRole('heading',{name:'Live auctions'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Upcoming auctions'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Closed auctions'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`docs/screenshots/category-watches-${info.project.name}.png`,fullPage:true});
});
