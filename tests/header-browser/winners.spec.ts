import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'winners-ui',name:'Tester'},wallet:{available:'750',held:'10',demo:true}}}));
  await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
  await page.route('**/api/catalog/auctions/*/view',route=>route.fulfill({json:{views:'4'}}));
});

test('winners list is searchable, private and mobile-safe',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/winners');
  await expect(page.getByRole('heading',{name:'Winners & results'})).toBeVisible();
  await expect(page.getByText('Winner outcomes')).toBeVisible();
  const cards=page.locator('article');await expect(cards.first()).toBeVisible();
  await expect(cards.first().getByText('Anonymous winner')).toBeVisible();
  await expect(cards.first().getByText(/ETB \d+\.00/)).toBeVisible();
  await expect(cards.first().getByText('DEMO · no real bids')).toBeVisible();
  await expect(cards.first().getByRole('link',{name:'View results'})).toHaveAttribute('href',/\/winners\/DEMO-/);
  const text=await page.locator('main').innerText();expect(text).not.toMatch(/\b0\d{2,}\*+\d+\b/);
  await page.locator('main').screenshot({path:`docs/screenshots/winners-${info.project.name}.png`});
  await page.getByRole('link',{name:'No winner'}).click();
  await expect(page).toHaveURL(/status=no_winner/);
  await expect(page.getByText('Ceramic vase')).toBeVisible();
  await expect(page.getByText('Anonymous winner')).toHaveCount(0);
  await page.getByLabel('Search results').fill('Everyday tote');
  await page.getByRole('button',{name:'Submit result search'}).click();
  await expect(page.getByText('No matching outcomes')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
