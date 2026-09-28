import {expect,test} from '@playwright/test';

test('shared header and Home hero use the lime surface without mobile overflow',async({page},info)=>{
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'lime-fixture',name:'Tester'},wallet:{available:'750',held:'10',demo:true}}}));
  await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
  await page.goto('/');
  const header=page.getByRole('banner',{name:'Mini App header'});
  const banner=page.getByRole('link',{name:'Explore Lowwin auctions',exact:true});
  await expect(header).toHaveCSS('background-color','rgb(145, 200, 62)');
  await expect(banner).toBeVisible();
  expect(await banner.evaluate(node=>getComputedStyle(node.parentElement!).backgroundColor)).toBe('rgb(145, 200, 62)');
  const language=header.getByRole('button',{name:'Language'});
  await language.click();
  await expect(header.getByRole('menuitemradio')).toHaveText(['En','አማ']);
  await header.getByRole('menuitemradio',{name:'አማ'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','am');
  await header.getByRole('button',{name:'ቋንቋ'}).click();
  await expect(header.getByRole('menu')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/home-lime-${info.project.name}.png`});
  const footer=page.locator('.page-footer');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toHaveCSS('background-color','rgb(163, 230, 53)');
  await expect(footer).toHaveCSS('color','rgb(23, 39, 32)');
  await footer.screenshot({path:`docs/screenshots/footer-lime-${info.project.name}.png`});
});
