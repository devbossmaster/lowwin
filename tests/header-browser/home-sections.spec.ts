import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'home-sections',name:'Tester'},wallet:{available:'750',held:'10',demo:true}}}));
  await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
  await page.route('**/api/favorites/*',route=>route.fulfill({json:{saved:false}}));
  await page.route('**/api/auctions/*/bids',route=>route.fulfill({json:{open:true,terms:{minPoints:'1',maxPoints:'100',stepPoints:'1',entryFeePoints:'0',maxDistinctBids:100},wallet:{available:'750',held:'10'},previousMax:'10',remainingSubmissions:100,ownBids:[]}}));
});

test('ending, closed, how-it-works and player stories stay mobile-safe',async({page},info)=>{
  let viewPosts=0;
  await page.route('**/api/catalog/auctions/*/view',route=>{viewPosts++;return route.fulfill({json:{views:String(viewPosts)}})});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const ending=page.getByLabel('Ending soon auctions');
  await ending.scrollIntoViewIfNeeded();
  await expect(ending.getByRole('timer')).toBeVisible();
  await expect(ending.getByText(/\d+ bids/)).toBeVisible();
  await ending.screenshot({path:`docs/screenshots/ending-${info.project.name}.png`});
  const closed=page.getByLabel('Closed auctions');
  await closed.scrollIntoViewIfNeeded();
  await expect(closed.getByText('DEMO example')).toBeVisible();
  await expect(closed.getByText('Illustrative winner')).toBeVisible();
  await expect(closed.getByText('DEMO',{exact:true})).toBeVisible();
  await expect(closed.getByRole('link',{name:'View results'})).toBeVisible();
  await expect.poll(()=>viewPosts,{timeout:4000}).toBeGreaterThan(0);
  await expect(closed.getByText(/1 view$/)).toBeVisible();
  await closed.screenshot({path:`docs/screenshots/closed-${info.project.name}.png`});
  const how=page.getByRole('heading',{name:'How it works'}).locator('..');
  await how.scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Verify your contact'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Choose an auction'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Bid low to win'})).toBeVisible();
  await page.locator('section').filter({has:page.getByRole('heading',{name:'How it works'})}).screenshot({path:`docs/screenshots/how-it-works-${info.project.name}.png`});
  await expect(page.getByText('Clear steps, quick browsing, and easy bidding.')).toBeVisible();
  await expect(page.getByText('Ermi',{exact:true})).toBeVisible();
  await expect(page.getByText('Nati',{exact:true})).toBeAttached();
  await expect(page.getByText('Helen',{exact:true})).toBeAttached();
  await page.locator('section').filter({has:page.getByRole('heading',{name:'Bidding made simple'})}).screenshot({path:`docs/screenshots/player-stories-${info.project.name}.png`});
  await expect(page.locator('.page-footer')).toContainText('Telegram Mini App');
  await page.locator('.page-footer').screenshot({path:`docs/screenshots/home-footer-${info.project.name}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
