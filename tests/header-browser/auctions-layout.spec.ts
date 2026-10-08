import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'auction-layout-fixture',name:'Tester'},wallet:{available:'0',held:'0',demo:true}}}));
 await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
 await page.route('**/api/favorites/*',route=>route.fulfill({json:{saved:false}}));
});

test('canonical auction browsing groups rich cards and keeps controls within the viewport',async({page})=>{
 await page.goto('/auctions/all');
 await expect(page.getByRole('navigation',{name:'Auction status'})).toBeVisible();
 for(const heading of ['Live auctions','Upcoming auctions','Closed auctions'])await expect(page.getByRole('heading',{name:heading})).toBeVisible();
 const listing=page.locator('.groups');
 const cards=listing.locator('.featured-carousel article, .closed-auction-carousel article');
 await expect(cards.first()).toBeVisible();
 await expect(page.locator('a[href="/auctions/all?status=live"]')).toBeVisible();
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
 await page.getByRole('button',{name:'Language'}).click();
 await page.getByRole('menuitemradio',{name:'አማ'}).click();
 await checkLayout();
 const upcoming=page.getByRole('navigation',{name:'Auction status'}).getByRole('link',{name:/የሚመጡ/});
 await upcoming.click();
 await expect(page).toHaveURL(/status=upcoming/);
 await expect(upcoming).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('heading',{name:/የሚመጡ.*ጨረታዎች/})).toBeVisible();
 await page.screenshot({path:`docs/screenshots/auction-upcoming-${test.info().project.name}.png`,fullPage:true});
 await page.goto('/auctions?search=Watch&status=live&category=watches&sort=ending');
 await expect(page).toHaveURL(/\/auctions\/all\?q=Watch&status=live&category=watches&sort=ending/);
 await expect(page.locator('input[name="q"]')).toHaveValue('Watch');
 await expect(page.getByRole('combobox').nth(0)).toHaveValue('live');
 await expect(page.getByRole('combobox').nth(1)).toHaveValue('watches');
 await expect(page.getByRole('combobox').nth(2)).toHaveValue('ending');
 await page.goto('/auctions/all?status=live&sort=ending&page=2');
 await expect(page).toHaveURL(/status=live&sort=ending&page=2/);
 await expect(page.locator('.featured-carousel article').first()).toBeVisible();
 await page.screenshot({path:`docs/screenshots/auction-live-page2-${test.info().project.name}.png`,fullPage:true});
});
