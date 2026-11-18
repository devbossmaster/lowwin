import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
const sdk='https://telegram.org/js/telegram-web-app.js';
async function launchFixture(){
 const database=process.env.TEST_DATABASE_URL!,url=new URL(database);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database});try{const id=randomInt(9200000000,9300000000);await verifyFixtureContact(db,id);return signedLaunch({user:JSON.stringify({id,first_name:'Launch readiness fixture'})},process.env.TELEGRAM_BOT_TOKEN)}finally{await db.$disconnect()}
}
function sdkBody(launch:string){return `window.Telegram={WebApp:{initData:${JSON.stringify(launch)},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};`}
async function dismissIntro(page:import('@playwright/test').Page){await page.addInitScript(()=>localStorage.setItem('lowwin:mini-introduction:v2','dismissed'))}

test('a delayed SDK keeps the launch splash and preserves the destination until verification',async({page})=>{
 const launch=await launchFixture();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});const errors:string[]=[],documents:string[]=[];let signins=0,sdkRequests=0;
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/auth/telegram/miniapp/signin')signins++;if(request.resourceType()==='document')documents.push(url.pathname)});
 await dismissIntro(page);await page.route(sdk,async route=>{sdkRequests++;await gate;await route.fulfill({contentType:'application/javascript',body:sdkBody(launch)})});
 try{
  await page.goto('/telegram?next='+encodeURIComponent('/?sort=newest#discover-auctions')+'&tgWebAppPlatform=android',{waitUntil:'domcontentloaded'});
  await expect(page).toHaveURL(/\/telegram\?/);await expect(page.locator('.launch-loader')).toBeVisible();
  await expect(page.locator('#home-headline')).toHaveCount(0);await expect(page.getByRole('button',{name:/^(Log in|Continue with Telegram)$/})).toHaveCount(0);
  expect(signins).toBe(0);release();
  await expect(page).toHaveURL(/\/\?sort=newest#discover-auctions$/);await expect(page.locator('#home-headline')).toBeVisible();
  await expect(page.locator('[data-header-balance]')).toBeVisible();await expect.poll(()=>signins).toBe(1);expect(sdkRequests).toBe(1);expect(documents).toEqual(['/telegram']);await expect(page.locator(`script[src="${sdk}"]`)).toHaveCount(1);expect(errors).toEqual([]);
 }finally{release()}
});
test('hinted Mini SDK failure keeps the gate with a reopen action; a late SDK signs in once',async({page})=>{
 const launch=await launchFixture();let signins=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/telegram/miniapp/signin')signins++});await dismissIntro(page);await page.route(sdk,route=>route.abort('failed'));
 await page.goto('/telegram?tgWebAppPlatform=android');
 await expect(page.getByRole('link',{name:/\b(?:open|reopen)\b.*(?:telegram|bot)/i})).toHaveAttribute('href',/https:\/\/t\.me\//,{timeout:15000});
 await expect(page.locator('#home-headline')).toHaveCount(0);await expect(page.getByRole('button',{name:/^(Log in|Continue with Telegram)$/})).toHaveCount(0);expect(signins).toBe(0);
 await page.evaluate(({launch,sdk})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};document.querySelector(`script[src="${sdk}"]`)!.dispatchEvent(new Event('load'))},{launch,sdk});
 await expect(page.locator('[data-header-balance]')).toBeVisible();expect(signins).toBe(1);
});
test('a failed Mini sign-in blocks Home until an explicit reconnect succeeds',async({page})=>{
 const launch=await launchFixture();let signins=0;await dismissIntro(page);await page.route(sdk,route=>route.fulfill({contentType:'application/javascript',body:sdkBody(launch)}));
 await page.route('**/api/auth/telegram/miniapp/signin',route=>{signins++;return signins===1?route.fulfill({status:503,json:{error:'Synthetic temporary failure'}}):route.continue()});
 await page.goto('/');await expect.poll(()=>signins).toBe(1);
 const retry=page.getByRole('button',{name:/^(Reconnect|Retry connection|Try again)$/});
 await expect(retry).toBeEnabled();await expect(page.locator('#home-headline')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^(Log in|Continue with Telegram)$/})).toHaveCount(0);
 expect(signins).toBe(1);await retry.click();await expect(page.locator('[data-header-balance]')).toBeVisible();expect(signins).toBe(2);
});
test('staff sign-in does not download the Telegram SDK',async({page})=>{
 let sdkRequests=0;page.on('request',request=>{if(request.url()===sdk)sdkRequests++});await page.goto('/admin/login',{waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();expect(sdkRequests).toBe(0);await expect(page.locator(`script[src="${sdk}"]`)).toHaveCount(0);
});
