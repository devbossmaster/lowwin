import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';
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

test('guests reach Home before protected page content or auction details',async({page})=>{
 const origin=process.env.BETTER_AUTH_URL!;
 for(const path of ['/auctions','/auctions/42','/categories/watches','/profile','/payments/chapa/return?checkout=11111111-1111-4111-a111-111111111111']){
  const response=await page.request.get(path,{maxRedirects:0});
  expect(response.status(),path).toBe(307);
  const destination=new URL(response.headers().location,origin);
  expect(destination.origin).toBe(new URL(origin).origin);
  expect(destination.pathname).toBe('/');
  expect(destination.searchParams.get('next')).toBe(path);
  expect(response.headers()['cache-control']).toContain('no-store');
 }
 const retired=await page.request.get('/auctions/all',{maxRedirects:0});
 expect(retired.status()).toBe(307);
 expect(new URL(retired.headers().location,origin).pathname).toBe('/');
 for(const path of ['/api/catalog/auctions/42','/api/auctions/fixture-auction/bids','/api/results/42/breakdown','/api/my-bids']){
  const response=await page.request.get(path,{maxRedirects:0});
  expect(response.status(),path).toBe(401);
  expect(response.headers()['cache-control']).toContain('no-store');
 }
 const staff=await page.request.get('/admin/users',{maxRedirects:0});
 expect(staff.status()).toBe(307);
 expect(new URL(staff.headers().location,origin).pathname).toBe('/');
 expect(staff.headers()['cache-control']).toContain('no-store');

 const initData=await launchFixture();
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000});
  const signIn=await page.request.post('/api/auth/telegram/miniapp/signin',{headers:{origin},data:{initData}});
  expect(signIn.status()).toBe(200);
  expect(await signIn.json()).toMatchObject({status:'authenticated'});
  const detail=await page.request.get(`/api/catalog/auctions/${auction.publicCode}`,{maxRedirects:0});
  expect(detail.status()).toBe(200);
  expect(detail.headers()['cache-control']).toContain('no-store');
  expect(await detail.json()).toMatchObject({code:String(auction.publicCode),result:null});
  const pageResponse=await page.request.get(`/auctions/${auction.publicCode}`,{maxRedirects:0,timeout:120000});
  expect(pageResponse.status()).toBe(200);
  expect(pageResponse.headers()['cache-control']).toContain('no-store');
 }finally{await db.$disconnect()}
});
