import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

test('compact header, language keyboard controls and banner assets',async({page},info)=>{
 const client=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const root='docs/redesign/screenshots/polish';mkdirSync(root,{recursive:true});
 try{
  const id=randomInt(9500000000,9800000000);await verifyFixtureContact(client,id);
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{data:signedLaunch({user:JSON.stringify({id,first_name:'Header fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
  // Only the notification count is a transport fixture. Authentication and
  // banner/fonts use the application against the disposable loopback database.
  await page.route('**/api/alerts?**',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('summary')?{unread:7}:{items:[],total:0,totalPages:1,unread:7,categories:['draws','payments']}}));
  let releaseProfile!:()=>void;const profileReady=new Promise<void>(resolve=>{releaseProfile=resolve});
  await page.route('**/api/profile',async route=>{await profileReady;await route.continue()});
  await page.goto('/profile');
  const header=page.getByRole('banner',{name:'Mini App header'});
  await expect(header).toBeVisible();
  await expect(page.getByText('Loading your profile…',{exact:true})).toBeVisible();
  await expect(page.locator('.private-skeleton,.mini-route-skeleton')).toHaveCount(0);
  await page.screenshot({path:`${root}/profile-loading-${info.project.name}-en.png`});releaseProfile();
  const bell=header.getByRole('button',{name:/^Notifications/});await expect(bell).toHaveAccessibleName('Notifications, 7 unread');
  await bell.click();const notifications=page.getByRole('dialog',{name:'Notifications'});await expect(notifications).toBeVisible();await page.keyboard.press('Escape');await expect(bell).toBeFocused();
  const bids=header.getByRole('link',{name:'My Bids',exact:true});await expect(bids).toHaveAttribute('href','/my-bids');await bids.click();await expect(page).toHaveURL(/\/my-bids$/);
  await page.goto('/');await expect(page.getByRole('button',{name:'Learn more',exact:true})).toBeVisible();
  const banner=page.locator('section[aria-label="Lowin"] img');await expect.poll(()=>banner.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
  for(const path of ['/images/lowin-family-hero.webp','/fonts/dm-sans-latin-500.woff2','/fonts/noto-sans-ethiopic-variable.woff2'])expect((await page.request.get(path,{maxRedirects:0})).status(),path).toBe(200);
  for(const control of await header.getByRole('button').all()){const box=await control.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${root}/home-${info.project.name}-en.png`});
  const language=header.getByRole('button',{name:'Language: English'});await language.focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitemradio',{name:'English',exact:true})).toBeFocused();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitemradio',{name:'አማርኛ',exact:true})).toBeFocused();
  await page.screenshot({path:`${root}/language-${info.project.name}-en.png`});
  await page.keyboard.press('Enter');await expect(header.getByRole('button',{name:'ቋንቋ: አማርኛ'})).toBeFocused();await expect(page.locator('html')).toHaveAttribute('lang','am');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${root}/home-${info.project.name}-am.png`});
  await header.getByRole('button',{name:'ቋንቋ: አማርኛ'}).click();await page.keyboard.press('Escape');await expect(header.getByRole('button',{name:'ቋንቋ: አማርኛ'})).toBeFocused();
  const bad=await page.evaluate(async()=>{await document.fonts.ready;return Array.from(document.images).filter(image=>image.src.includes('lowin-family-hero')&&(!image.complete||image.naturalWidth===0)).length});expect(bad).toBe(0);
  expect(errors).toEqual([]);
 }finally{await client.$disconnect()}
});
