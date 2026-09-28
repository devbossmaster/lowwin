import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
// Independent simulated users share one loopback address; isolate their rate-limit
// fixtures between cases without changing the server's production limit.
test.beforeEach(async()=>{const u=new URL(process.env.TEST_DATABASE_URL!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable database required');const db=new PrismaClient({datasourceUrl:u.toString()});try{await db.rateLimit.deleteMany()}finally{await db.$disconnect()}});
test('configured quote, channels, private OCR, fallback and verified receipt',async({page,context},info)=>{const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await context.grantPermissions(['clipboard-read','clipboard-write']);
 try{for(const channel of ['telebirr','cbe']){const latest=await db.paymentPolicy.findFirst({where:{channel},orderBy:{version:'desc'}});if(!latest)await db.paymentPolicy.create({data:{channel,version:1,enabled:true,account:channel==='cbe'?'0000000000000':'0000000000',accountName:channel==='cbe'?'DEMO CBE — NOT PAYABLE':'DEMO Telebirr — NOT PAYABLE',pointsNumerator:1n,centsDenominator:100n,minCents:100n,maxCents:100000n,terms:'DEMO only. Never send real funds. This isolated quote is for tests; eligibility, refunds and disputes require owner review before release.',reviewReference:'Browser fixture review only',actorId:'test:fixture'}})}
 const launch=signedLaunch({user:JSON.stringify({id:randomInt(9700000000,9800000000),first_name:'Payment demo'})});await page.addInitScript(raw=>{window.Telegram={WebApp:{initData:raw,ready(){},expand(){}}}},launch);
 await verifyFixtureContact(db,JSON.parse(new URLSearchParams(launch).get('user')!).id);
 const response=await page.request.post('/api/auth/telegram/miniapp/signin',{headers:{origin:'http://localhost:3110'},data:{initData:launch}});expect(response.status()).toBe(200);await page.goto('/wallet');await page.getByRole('button',{name:'Telebirr',exact:true}).click();await expect(page.locator('.payment-details')).toContainText('DEMO Telebirr');await page.getByRole('button',{name:'CBE',exact:true}).click();await expect(page.locator('.payment-details')).toContainText('DEMO CBE');await page.getByRole('button',{name:'Copy receiving account'}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('0000000000000');await page.getByLabel('Transfer amount (ETB)').fill('100');await expect(page.getByText('100 whole ETB')).toBeVisible();await page.screenshot({path:`docs/screenshots/phase6-wallet-quote-${info.project.name}.png`,fullPage:true});await page.getByRole('button',{name:'Accept quote & create request'}).click();await expect(page.getByText('Choose receipt input')).toBeVisible();await page.getByLabel('Scan screenshot',{exact:true}).check();
 const reference=`FT123456789${info.project.name==='mobile-360'?'3':'4'}`,image=await sharp(Buffer.from(`<svg width="1400" height="250"><rect width="100%" height="100%" fill="white"/><text x="30" y="90" font-size="44" font-family="Arial">CBE</text><text x="30" y="175" font-size="44" font-family="Arial">Reference: ${reference}</text></svg>`)).png().toBuffer();await page.getByLabel('Upload receipt image',{exact:true}).setInputFiles({name:'private-demo.png',mimeType:'image/png',buffer:image});await expect(page.getByLabel('Review extracted reference')).toHaveValue(reference,{timeout:30000});await page.getByLabel('I reviewed this reference and the saved quote.').check();await page.screenshot({path:`docs/screenshots/phase6-wallet-scan-${info.project.name}.png`,fullPage:true});await page.getByRole('button',{name:'Submit for verification'}).click();await expect(page.getByText('100 ETB credited. Receipt recorded.')).toBeVisible();await expect(page.locator('.wallet-summary')).toContainText('100');await expect(page.getByRole('link',{name:'ETB 100.00 available, open wallet'})).toBeVisible();await expect(page.getByLabel('Upload receipt image',{exact:true})).toBeDisabled();await expect(page.getByLabel('I reviewed this reference and the saved quote.')).toBeDisabled();await expect(page.getByLabel('Review extracted reference')).toHaveValue(reference);await page.screenshot({path:`docs/screenshots/phase6-wallet-receipt-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'Start another request'}).click();await page.getByRole('button',{name:'Telebirr',exact:true}).click();await page.getByRole('button',{name:'Accept quote & create request'}).click();await page.getByLabel('Scan screenshot',{exact:true}).check();const blank=await sharp({create:{width:200,height:100,channels:3,background:'white'}}).png().toBuffer();await page.getByLabel('Upload receipt image',{exact:true}).setInputFiles({name:'blank.png',mimeType:'image/png',buffer:blank});await expect(page.getByText(/You can enter the reference manually/)).toBeVisible({timeout:30000});await page.screenshot({path:`docs/screenshots/phase6-wallet-fallback-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 }finally{await db.$disconnect()}
});


test('ordinary browsers receive only the Telegram entry and cannot query the Mini App',async({page,request},info)=>{
 await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));
 for(const path of ['/','/wallet','/auctions','/profile','/winners']){const response=await request.get(path,{maxRedirects:0});expect(response.status()).toBe(307);expect(response.headers().location).toContain('/telegram');expect(response.headers()['cache-control']).toContain('no-store')}
 for(const path of ['/api/me','/api/wallet','/api/catalog/auctions','/api/results','/api/my-bids','/api/profile','/api/wallet/top-ups'])expect((await request.get(path,{headers:{'user-agent':'Telegram','x-telegram-user-id':'778899'}})).status()).toBe(401);
 for(const path of ['/logo-transparent.png','/fonts/NotoSansEthiopic-Bold.ttf']){const asset=await request.get(path,{maxRedirects:0});expect(asset.status()).toBe(200);expect(asset.headers()['content-type']).not.toContain('text/html')}
 await page.goto('/');await expect(page.getByRole('link',{name:'Continue with the bot'})).toHaveAttribute('href','https://t.me/lowin_fixture_bot?start=lowin');await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('.launch-loader')).toHaveCount(0);await page.screenshot({path:`docs/screenshots/phase6-telegram-entry-${info.project.name}.png`,fullPage:true});
 const oldSession=await request.post('/api/auth/telegram/miniapp/signin',{headers:{origin:'http://localhost:3110'},data:{initData:'forged'}});expect(oldSession.status()).toBe(401);
 await page.goto('/admin/login');await expect(page.getByLabel('Staff email')).toBeVisible();
});

test('loading artwork follows real authentication and contact reads, with reduced motion',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const launch=signedLaunch({user:JSON.stringify({id:randomInt(9300000000,9400000000),first_name:'Loading fixture'})});
 let releaseAuth!:()=>void,releaseContact!:()=>void,contactStarted!:()=>void;
 const authGate=new Promise<void>(r=>releaseAuth=r),contactGate=new Promise<void>(r=>releaseContact=r),contactRequest=new Promise<void>(r=>contactStarted=r);
 try{
  await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.addInitScript(({raw,platform})=>{window.Telegram={WebApp:{initData:raw,platform,ready(){},expand(){},isVersionAtLeast(){return true},requestContact(){(window as unknown as {contactPromptForTest:number}).contactPromptForTest=((window as unknown as {contactPromptForTest:number}).contactPromptForTest??0)+1},requestFullscreen(){(window as unknown as {fullscreenForTest:number}).fullscreenForTest=((window as unknown as {fullscreenForTest:number}).fullscreenForTest??0)+1;document.documentElement.style.setProperty('--tg-safe-area-inset-top','24px');document.documentElement.style.setProperty('--tg-content-safe-area-inset-top','56px');document.documentElement.style.setProperty('--tg-safe-area-inset-bottom','20px');document.documentElement.style.setProperty('--tg-viewport-stable-height',`${innerHeight}px`)}}}},{raw:launch,platform:info.project.name==='mobile-360'?'android':'ios'});
  await page.route('**/api/auth/telegram/miniapp/signin',async r=>{await authGate;await r.continue()});
  await page.route('**/api/onboarding/contact',async r=>{contactStarted();await contactGate;await r.continue()});
  await page.goto('/telegram');await expect(page.locator('.launch-loader')).toHaveCount(1);await expect(page.locator('.launch-loader')).toBeVisible();await expect(page.locator('.loading-screen,.launch-loader .wordmark')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {fullscreenForTest?:number}).fullscreenForTest??0)).toBe(1);
  await expect(page.locator('.launch-loader .loader')).toBeVisible();
  const logo=page.locator('.launch-mark img');await expect(logo).toHaveAttribute('alt','Lowwin');await expect.poll(()=>logo.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.launch-mark [lang="am"]')).toHaveText('በዝቅተኛ ዋጋ ተጫረቱ፣ ያሸንፉ!');
  const style=await page.locator('.launch-loader').evaluate(el=>({background:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage,ring:getComputedStyle(el.querySelector('.loader')!).borderRightColor,animation:getComputedStyle(el.querySelector('.loader')!).animationName,loaderSize:getComputedStyle(el.querySelector('.loader')!).width,loader:el.querySelector('.loader')!.getBoundingClientRect().toJSON(),logo:el.querySelector('.launch-mark img')!.getBoundingClientRect().toJSON(),logoBorder:getComputedStyle(el.querySelector('.launch-mark img')!).borderTopWidth,text:el.querySelector('.launch-mark p')!.getBoundingClientRect().toJSON(),screenWidth:innerWidth,screenHeight:innerHeight}));
  expect(style.background).toBe('rgb(109, 148, 16)');expect(style.image).toBe('none');await expect(page.locator('.launch-loader h1,.loader-fill')).toHaveCount(0);expect(style.ring).toBe('rgb(255, 255, 255)');expect(style.animation).toBe('l15');expect(Math.abs(style.logo.left+style.logo.width/2-style.screenWidth/2)).toBeLessThan(2);
  expect(style.loaderSize).toBe('50px');expect(style.logoBorder).toBe('0px');expect(style.logo.width).toBeLessThanOrEqual(160);expect(style.loader.top).toBeGreaterThan(style.text.bottom);expect(style.loader.bottom).toBeLessThan(style.screenHeight);expect(await page.evaluate(()=>(window as unknown as {fullscreenForTest:number}).fullscreenForTest)).toBe(1);expect(await page.locator('.launch-loader').evaluate(el=>getComputedStyle(el).paddingTop)).toBe('112px');await expect(page.locator('link[rel="preload"][href="/bg.png"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`docs/screenshots/welcome-loading-${info.project.name}.png`});
  await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.launch-loader .loader').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');await page.screenshot({path:`docs/screenshots/welcome-loading-reduced-${info.project.name}.png`});
  releaseAuth();await contactRequest;await expect(page.locator('.launch-loader .loader')).toBeVisible();releaseContact();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {contactPromptForTest?:number}).contactPromptForTest??0)).toBe(1);await expect(page.locator('.launch-loader .loader')).toBeVisible();await expect(page.locator('.contact-gate')).toHaveCount(0);expect(errors).toEqual([]);
 }finally{releaseAuth();releaseContact()}
});

test('failed Telegram verification removes the loading artwork and offers retry',async({page})=>{
 await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'unverified',ready(){},expand(){}}}});
 await page.route('**/api/auth/telegram/miniapp/signin',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.goto('/telegram');
 await expect(page.locator('.telegram-entry [role="alert"]')).toContainText('Sign-in is not available');await expect(page.locator('.launch-loader')).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry connection'})).toBeVisible();await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
});

test('unsupported contact clients request the private bot keyboard and Cancel closes',async({page,context},info)=>{
 const launch=signedLaunch({user:JSON.stringify({id:randomInt(9400000000,9500000000),first_name:'Legacy client fixture'})});let requested=0;
 await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.addInitScript(raw=>{window.Telegram={WebApp:{initData:raw,ready(){},expand(){},isVersionAtLeast(){return false},requestContact(){throw Error('Unsupported native method must not be called')},close(){(window as unknown as {closedForTest:boolean}).closedForTest=true}}}},launch);
 // Delivery is independently checked by the server-side reply-keyboard test.
 await page.route('**/api/onboarding/contact',async r=>{if(r.request().method()==='POST'){requested++;await r.fulfill({status:200,contentType:'application/json',body:'{"sent":true}'});return}await r.continue()});
 await page.goto('/telegram');await expect.poll(()=>requested).toBe(1);expect((await context.request.get('/api/me')).status()).toBe(401);await expect(page.locator('.contact-gate')).toHaveCount(0);
 await page.screenshot({path:`docs/screenshots/welcome-contact-fallback-${info.project.name}.png`});expect(await page.evaluate(()=>(window as unknown as {closedForTest:boolean}).closedForTest)).toBe(true);await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
});

test('contact callback alone cannot unlock Home; verified bot contact can',async({page,context},info)=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),id=randomInt(9800000000,9900000000),launch=signedLaunch({user:JSON.stringify({id,first_name:'Contact preview'})});
 try{
  let signIns=0;await page.route('**/api/auth/telegram/miniapp/signin',async route=>{signIns++;await route.continue()});
  await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.addInitScript(raw=>{window.Telegram={WebApp:{initData:raw,ready(){},expand(){},requestContact(callback){callback(true)},close(){}}}},launch);
  await page.goto('/telegram');await expect(page.locator('.launch-loader .loader')).toBeVisible();await expect(page.locator('.contact-gate')).toHaveCount(0);await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
  expect((await context.request.get('/api/me')).status()).toBe(401);await expect.poll(async()=>{const state=await context.request.get('/api/onboarding/contact');return state.ok()&&(await state.json()).verified===false}).toBe(true);const state=await context.request.get('/api/onboarding/contact');expect(state.headers()['cache-control']).toContain('no-store');
  await page.screenshot({path:`docs/screenshots/onboarding-after/contact-required-${info.project.name}.png`});await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
  await verifyFixtureContact(db,id);await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:20000});expect((await context.request.get('/api/me')).status()).toBe(200);expect(signIns).toBe(1);
  let releaseRetry!:()=>void,retryStarted!:()=>void;const retryGate=new Promise<void>(resolve=>releaseRetry=resolve),retryRequest=new Promise<void>(resolve=>retryStarted=resolve);
  await page.route('**/api/auth/telegram/miniapp/signin',async route=>{retryStarted();await retryGate;await route.continue()});
  try{
   await page.goto('/');await retryRequest;await expect(page.locator('.launch-loader .loader')).toBeVisible();await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
   releaseRetry();await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:20000});await expect(page.locator('.launch-loader')).toHaveCount(0);
  }finally{releaseRetry()}
 }finally{await db.$disconnect()}
});
test('declining native contact closes the app and never grants access',async({page,context},info)=>{
 const launch=signedLaunch({user:JSON.stringify({id:randomInt(9900000000,9999999999),first_name:'Cancellation preview'})});let botRequested=0;await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',async route=>{if(route.request().method()==='POST'){botRequested++;await route.fulfill({status:200,contentType:'application/json',body:'{"sent":true}'})}else await route.continue()});
 await page.addInitScript(raw=>{window.Telegram={WebApp:{initData:raw,ready(){},expand(){},requestContact(callback){callback(false)},close(){(window as unknown as {closedForTest:boolean}).closedForTest=true}}}},launch);
 await page.goto('/telegram');await expect.poll(()=>page.evaluate(()=>(window as unknown as {closedForTest?:boolean}).closedForTest??false)).toBe(true);expect(botRequested).toBe(1);await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);expect((await context.request.get('/api/wallet')).status()).toBe(401);await page.screenshot({path:`docs/screenshots/onboarding-after/contact-cancelled-${info.project.name}.png`});
});
