import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'category-fixture',name:'Tester'},wallet:{available:'750',held:'10',demo:true}}}));
 await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
});

test('category routes show live, upcoming and closed auctions with numeric codes',async({page},info)=>{
 await page.goto('/categories/watches');
 await expect(page.getByRole('heading',{level:1,name:'Watches'})).toBeVisible();
 await expect(page.getByLabel('Auction status counts')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Live auctions'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Upcoming auctions'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Closed auctions'})).toBeVisible();
 const code=page.getByText('Auction code').locator('..').locator('strong').first();
 if(await code.count())await expect(code).toHaveText(/^\d+$/);
 const auctionLink=page.locator('a[href^="/auctions/"]').filter({has:page.locator('img')}).first();
 if(await auctionLink.count())await expect(auctionLink).toHaveAttribute('href',/^\/auctions\/\d+$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`docs/screenshots/category-watches-${info.project.name}.png`,fullPage:true});
});
