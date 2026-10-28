import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

const sdk='https://telegram.org/js/telegram-web-app.js';
async function launchFixture(){
 const database=process.env.TEST_DATABASE_URL!,url=new URL(database);
 if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database});
 try{
  const id=randomInt(9200000000,9300000000);await verifyFixtureContact(db,id);
  return signedLaunch({user:JSON.stringify({id,first_name:'Launch readiness fixture'})},process.env.TELEGRAM_BOT_TOKEN);
 }finally{await db.$disconnect()}
}

test('spinner and loading text wait for a delayed SDK, then sign in once and preserve the destination',async({page},info)=>{
 const launch=await launchFixture();let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve});
 const errors:string[]=[],documents:string[]=[];let signins=0,sdkRequests=0;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/auth/telegram/miniapp/signin')signins++;if(request.resourceType()==='document')documents.push(url.pathname)});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route(sdk,async route=>{sdkRequests++;await gate;await route.fulfill({contentType:'application/javascript',body:`window.Telegram={WebApp:{initData:${JSON.stringify(launch)},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};`})});
 try{
  await page.goto('/telegram?next='+encodeURIComponent('/?sort=newest#discover-auctions'),{waitUntil:'domcontentloaded'});
  const splash=page.locator('.launch-loader');
  await expect(splash).toBeVisible();await expect(splash.locator('img')).toHaveCount(0);await expect(splash.locator('p')).toHaveText('Loading…');
  await expect(splash.getByRole('status')).toHaveCount(1);
  await expect(splash.locator('.loading-spinner-ring')).toHaveCSS('animation-name','none');
  await page.waitForTimeout(1000);await expect(splash).toBeVisible();expect(signins).toBe(0);
  const root=process.env.LAUNCH_REPORT_DIR??'test-results/launch-fast/after';mkdirSync(root,{recursive:true});
  await page.screenshot({path:`${root}/spinner-text-${info.project.name}.png`});
  release();await expect(page.locator('#home-headline')).toBeVisible();
  await expect(page).toHaveURL(/\/\?sort=newest#discover-auctions$/);
  expect(signins).toBe(1);expect(sdkRequests).toBe(1);expect(documents).toEqual(['/telegram']);
  await expect(page.locator(`script[src="${sdk}"]`)).toHaveCount(1);
  expect(errors).toEqual([]);
 }finally{release()}
});

test('SDK failure shows recovery controls and a late SDK can recover without duplicate sign-in',async({page})=>{
 const launch=await launchFixture();let signins=0;
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/telegram/miniapp/signin')signins++});
 await page.route(sdk,route=>route.abort('failed'));
 await page.goto('/telegram',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('button',{name:'Retry connection',exact:true})).toBeVisible({timeout:15000});
 await expect(page.locator('main').getByRole('alert')).toContainText('Telegram could not load');expect(signins).toBe(0);
 await expect(page.getByRole('button',{name:'Reload app',exact:true})).toBeVisible();
 await page.evaluate(({launch,sdk})=>{
  window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};
  document.querySelector(`script[src="${sdk}"]`)!.dispatchEvent(new Event('load'));
 },{launch,sdk});
 await expect(page.locator('#home-headline')).toBeVisible();expect(signins).toBe(1);
});

test('staff sign-in does not download the Telegram SDK',async({page})=>{
 let sdkRequests=0;page.on('request',request=>{if(request.url()===sdk)sdkRequests++});
 await page.goto('/admin/login',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
 expect(sdkRequests).toBe(0);await expect(page.locator(`script[src="${sdk}"]`)).toHaveCount(0);
});
