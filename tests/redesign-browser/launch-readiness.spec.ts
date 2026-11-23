import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';
import {richFinalResult} from '../result-fixtures';
import {maskResultPhone} from '../../src/modules/auctions/result-identity';
const sdk='https://telegram.org/js/telegram-web-app.js';
async function launchFixture(startParam?:string){
 const database=process.env.TEST_DATABASE_URL!,url=new URL(database);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database});try{const id=randomInt(9200000000,9300000000);await verifyFixtureContact(db,id);return signedLaunch({user:JSON.stringify({id,first_name:'Launch readiness fixture'}),...(startParam?{start_param:startParam}:{})},process.env.TELEGRAM_BOT_TOKEN)}finally{await db.$disconnect()}
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
 await expect(page.getByRole('heading',{name:'Share your Telegram contact',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^(Log in|Continue with Telegram)$/})).toHaveCount(0);
 expect(signins).toBe(1);await retry.click();await expect(page.locator('[data-header-balance]')).toBeVisible();expect(signins).toBe(2);
});
test('an unverified Mini launch offers a reopen action without treating it as registration',async({page})=>{
 await page.route(sdk,route=>route.fulfill({contentType:'application/javascript',body:sdkBody('unverified-fixture-launch')}));
 const signIn=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin');
 await page.goto('/telegram?tgWebAppPlatform=android');
 expect((await signIn).status()).toBe(401);
 await expect(page.getByRole('heading',{name:'Reopen Lowwin',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Reopen from the bot',exact:true})).toHaveAttribute('href',/https:\/\/t\.me\//);
 await expect(page.getByRole('heading',{name:'Share your Telegram contact',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^(Retry connection|Log in|Continue with Telegram)$/})).toHaveCount(0);
 await expect(page.locator('#home-headline')).toHaveCount(0);
});
test('a registered Mini App restores its session with an older signed launch',async({page})=>{
 const fresh=await launchFixture();
 const user=new URLSearchParams(fresh).get('user')!;
 let launch=fresh;
 await dismissIntro(page);
 await page.route(sdk,route=>route.fulfill({contentType:'application/javascript',body:sdkBody(launch)}));
 const open=async()=>{
  const signIn=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin');
  await page.goto('/telegram?tgWebAppPlatform=android');
  const response=await signIn;
  expect(response.status()).toBe(200);
  await expect(page.locator('[data-header-balance]')).toBeVisible();
  await expect(page.locator('#contact-heading,#telegram-recovery-heading,[data-browser-telegram-login]')).toHaveCount(0);
  return (await response.json()).me;
 };
 const first=await open();
 launch=signedLaunch({user,auth_date:String(Math.floor(Date.now()/1000)-600)},process.env.TELEGRAM_BOT_TOKEN);
 expect(await open()).toEqual(first);
});
test.describe('winner Mini App deep links',()=>{
 let db:PrismaClient,result:Awaited<ReturnType<typeof richFinalResult>>;
 test.beforeAll(async()=>{
  db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
  result=await richFinalResult(db);
 });
 test.afterAll(async()=>{
  try{if(result)await db.product.update({where:{id:result.auction.productId!},data:{visible:false}})}
  finally{await db?.$disconnect()}
 });
 for(const entry of ['/telegram','/'])test(`opens the winner sheet from ${entry} after sign-in`,async({page})=>{
  const launch=await launchFixture(`winner_${result.code}`);
  const signInPath='/api/auth/telegram/miniapp/signin';
  const dialog=page.getByRole('dialog',{name:'Auction result',exact:true});
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  await dismissIntro(page);
  await page.route(sdk,route=>route.fulfill({contentType:'application/javascript',body:sdkBody(launch)}));
  await page.route(`**${signInPath}`,async route=>{await gate;await route.fallback()});
  try{
   await Promise.all([page.waitForRequest(`**${signInPath}`),page.goto(entry,{waitUntil:'domcontentloaded'})]);
   await expect(page).toHaveURL(entry);
   await expect(dialog).toHaveCount(0);
   const authenticated=page.waitForResponse(`**${signInPath}`);
   release();
   expect((await authenticated).ok()).toBe(true);
   await expect(page).toHaveURL(`/winners/${result.code}`);
   await expect(dialog.getByRole('heading',{name:result.title,exact:true})).toBeVisible();
   await expect(dialog.getByRole('region',{name:'Confirmed result',exact:true})).toHaveAttribute('data-winner','true');
   await dialog.getByRole('button',{name:'Close',exact:true}).click();
   await expect(page).toHaveURL('/winners');
   await expect(dialog).toHaveCount(0);
  }finally{release()}
 });
 test('shows compact closed details, more chances and private participant rows',async({page},info)=>{
  const tail='Includes a USB-C charging cable.';
  const amTail='የዩኤስቢ ገመድ ተካቷል።';
  const more=await bidAuction(db,{fee:50,isDemo:false,ruleVersion:'lowest-unique-v5',endDelayMs:300000});
  const relatedTitle=`Related live auction ${more.publicCode}`,relatedTitleAm=`ተጨማሪ ክፍት ጨረታ ${more.publicCode}`;
  try{
   await db.product.update({where:{id:result.auction.productId!},data:{description:'A portable power bank that charges everyday devices. '.repeat(4)+tail,descriptionAm:'የዕለት ተዕለት መሣሪያዎችን የሚሞላ ተንቀሳቃሽ የኃይል ባንክ። '.repeat(4)+amTail}});
   await db.product.update({where:{id:more.productId!},data:{title:relatedTitle,titleAm:relatedTitleAm,images:{create:{path:'/catalog/accessory.svg',alt:'Fixture product illustration',sourceType:'ORIGINAL'}}}});
   const launch=await launchFixture(`auction_${result.code}`),am=info.project.name==='430';
   await page.emulateMedia({reducedMotion:'reduce'});
   if(am)await page.context().addCookies([{name:'lowwin-language',value:'am',url:process.env.BETTER_AUTH_URL!}]);
   await dismissIntro(page);
   await page.route(sdk,route=>route.fulfill({contentType:'application/javascript',body:sdkBody(launch)}));
   await page.goto('/telegram');
   await expect(page).toHaveURL(`/auctions/${result.code}`);
   const detail=page.locator('[data-auction-detail]');
   const summary=detail.getByTestId('result-summary');
   await expect(summary).toHaveAttribute('data-winner','true');
   await expect(summary).toHaveCSS('background-color','rgb(7, 49, 198)');
   await expect(summary.getByText(maskResultPhone(result.phone)!,{exact:true})).toBeVisible();
   await expect(detail.getByText(result.phone,{exact:true})).toHaveCount(0);
   await expect(detail.locator('[data-auction-bid]')).toHaveCount(0);
   await expect(detail.getByRole('region',{name:am?'የጨረታው እንቅስቃሴ':'Auction activity',exact:true}).getByRole('timer')).toHaveCount(0);
   await expect(detail.locator('time').first()).toContainText('GMT+3');
   await expect(detail.locator('[data-more-chances]').getByRole('heading',{name:am?relatedTitleAm:relatedTitle,exact:true})).toBeVisible();
   const readMore=detail.getByRole('button',{name:am?'ተጨማሪ አንብብ':'Read more',exact:true});
   await expect(detail.getByText(am?amTail:tail,{exact:false})).toHaveCount(0);
   await readMore.click();await expect(detail.getByText(am?amTail:tail,{exact:false})).toBeVisible();
   await detail.getByRole('button',{name:am?'በአጭሩ አሳይ':'Read less',exact:true}).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:info.outputPath('closed-auction.png')});
   await detail.getByRole('link',{name:am?'ሙሉ ውጤቱን ይመልከቱ':'View full result',exact:true}).click();
   await expect(page).toHaveURL(`/winners/${result.code}`);
   const sheet=page.getByRole('dialog',{name:am?'የጨረታ ውጤት':'Auction result',exact:true});
   await sheet.locator('[data-result-breakdown]').scrollIntoViewIfNeeded();
   await sheet.getByRole('button',{name:am?'በብዛት የተመረጡ':'Most picked',exact:true}).click();
   const amount=sheet.locator('[data-result-amount="50"]');await amount.click();
   const participantSheet=page.getByRole('dialog',{name:am?'የጨረታ ዝርዝር':'Bid details',exact:true});
   const rows=participantSheet.getByRole('listitem');
   await expect(rows).toHaveCount(20);
   await expect(rows.first()).toContainText('#1');
   await expect(rows.first()).toContainText(maskResultPhone(result.phone)!);
   await expect(rows.first().locator('time')).toContainText('GMT+3');
   await expect(participantSheet).not.toContainText('Bid fixture');
   await expect(participantSheet).toHaveAttribute('data-presentation','centered');
   expect(await participantSheet.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   await page.screenshot({path:info.outputPath('bid-details.png')});
   await participantSheet.getByRole('button',{name:am?'ቀጣይ':'Next',exact:true}).click();
   await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('#21');
   await page.keyboard.press('Escape');await expect(participantSheet).toHaveCount(0);await expect(amount).toBeFocused();
  }finally{await db.product.update({where:{id:more.productId!},data:{visible:false}})}
 });
});
test('a malformed signed winner launch falls back to Home',async({page})=>{
 const launch=await launchFixture('winner_5?next=/admin');
 await dismissIntro(page);
 await page.route(sdk,route=>route.fulfill({contentType:'application/javascript',body:sdkBody(launch)}));
 await page.goto('/telegram');
 await expect(page).toHaveURL('/');
 await expect(page.locator('[data-header-balance]')).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Auction result',exact:true})).toHaveCount(0);
});
test('staff sign-in stays on the admin entry without downloading the Telegram SDK',async({page})=>{
 let sdkRequests=0;page.on('request',request=>{if(request.url()===sdk)sdkRequests++});
 for(const path of ['/admin','/admin/login']){
  const response=await page.goto(path,{waitUntil:'domcontentloaded'});
  expect(response?.status()).toBe(200);expect(response?.headers()['cache-control']).toContain('no-store');
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
  await expect(page.locator(`script[src="${sdk}"]`)).toHaveCount(0);
 }
 expect(sdkRequests).toBe(0);
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
 expect(new URL(staff.headers().location,origin).pathname).toBe('/admin');
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
 }finally{await db.$disconnect()}
});
