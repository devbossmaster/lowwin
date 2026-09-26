import { test, expect } from '@playwright/test';
test('mobile shell, navigation and honest account states',async({page},testInfo)=>{
  const hydrationErrors:string[]=[];
  page.on('console',message=>{if(message.type()==='error' && message.text().includes('hydrated')) hydrationErrors.push(message.text());});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Small is good. Unique is better.'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  await expect(page.getByText('Opening your Lowin…')).toBeHidden({timeout:20000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(hydrationErrors).toEqual([]);
  await page.screenshot({path:`docs/screenshots/home-${testInfo.project.name}.png`});
  await page.screenshot({path:`docs/screenshots/home-full-${testInfo.project.name}.png`,fullPage:true});
  await page.getByRole('link',{name:'Explore auctions'}).click();
  await expect(page.getByRole('heading',{name:'The catalog is on its way'})).toBeVisible();
  await page.getByRole('navigation').getByRole('link',{name:'Profile'}).click();
  await expect(page.getByRole('heading',{name:'Your corner of Lowin.'})).toBeVisible();
  await page.getByRole('link',{name:'Point wallet',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Top up coming later'})).toBeVisible();
  await page.screenshot({path:`docs/screenshots/wallet-${testInfo.project.name}.png`});
});
test('expired Telegram launch offers retry, never fake authentication',async({page})=>{
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'tampered',ready(){},expand(){}}};});
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/auth/telegram/miniapp/signin',route=>route.fulfill({status:401,json:{error:'Invalid launch'}}));
  await page.goto('/profile');
  await expect(page.getByRole('heading',{name:'Let’s reconnect'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry connection'})).toBeVisible();
});
