import {expect,test,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';

async function website(page:Page,am=false){
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),prefix='Website '+randomUUID().slice(0,8),auctions:Awaited<ReturnType<typeof bidAuction>>[]=[];
 for(let i=0;i<3;i++){const auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000});auctions.push(auction);await db.product.update({where:{id:auction.productId!},data:{title:`${prefix} ${i+1}`,titleAm:`${prefix} የሙከራ ዕቃ ${i+1}`,images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Isolated browser test product',sourceType:'ORIGINAL'}}}})}
 const external:string[]=[],errors:string[]=[],approvals:string[]=[],charges:string[]=[],readiness:string[]=[],starts:{provider:string;callbackURL:string;errorCallbackURL:string;disableRedirect:boolean}[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('https://api.chapa.global/**',route=>{external.push(route.request().url());return route.abort()});
 await page.route('https://oauth.telegram.org/**',route=>{external.push(route.request().url());return route.abort()});
 await page.route(url=>url.origin==='https://oauth.telegram.org'&&url.pathname==='/auth',route=>{approvals.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<h1>Isolated official-login handoff fixture</h1>'})});
 await page.route('**/api/payments/**',route=>{if(route.request().method()==='POST'){charges.push(route.request().url());return route.abort()}return route.continue()});
 await page.addInitScript(language=>{localStorage.setItem('lowwin-language',language);localStorage.setItem('lowwin:introduction:v1','dismissed');(window as unknown as {nativeContactRequests:number}).nativeContactRequests=0;window.Telegram={WebApp:{initData:'',platform:'unknown',ready(){},requestContact(){(window as unknown as {nativeContactRequests:number}).nativeContactRequests++}}}},am?'am':'en');
 await page.context().addCookies([{name:'lowwin-language',value:am?'am':'en',domain:'localhost',path:'/'}]);
 await page.route('**/api/auth/telegram/config',route=>{readiness.push(route.request().url());return route.fulfill({json:{enabled:true,configured:true}})});
 await page.route('**/api/auth/sign-in/social',route=>{expect(route.request().method()).toBe('POST');starts.push(route.request().postDataJSON());return route.fulfill({json:{url:'https://oauth.telegram.org/auth?client_id=123456789&state=isolated-fixture&code_challenge=public-fixture&code_challenge_method=S256',redirect:true}})});
 return {db,home:'/?q='+encodeURIComponent(prefix),prefix,auctions,external,errors,starts,approvals,charges,readiness,async close(){await db.$disconnect()}};
}

for(const am of [false,true])test(`ordinary website browsing and explicit official login ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await website(page,am);
 try{
  await page.goto(f.home);const frame=page.locator('.app-frame');await expect(frame).toHaveAttribute('data-app-environment','browser');await expect(page.locator('.auction-card')).toHaveCount(3);
  const websiteOrigin=new URL(page.url()).origin;
  const geometry=await frame.evaluate(node=>{const box=node.getBoundingClientRect();return {width:box.width,left:box.left,viewport:document.documentElement.clientWidth}});
  expect(geometry.width).toBeCloseTo(Math.min(geometry.viewport,430),0);
  expect(geometry.left).toBeCloseTo((geometry.viewport-geometry.width)/2,0);
  expect(await page.locator('.auction-card').first().evaluate(node=>getComputedStyle(node.parentElement!).gridTemplateColumns.split(' ').length)).toBe(1);
  // Guest browsing keeps the verified-customer navigation hidden at every width.
  await expect(page.locator('.mini-bottom-navigation')).toHaveCount(0);
  await page.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-browser-telegram-login]')).toBeVisible();await expect(dialog.locator('input')).toHaveCount(0);await expect(dialog.getByRole('button',{name:am?'በTelegram ይቀጥሉ':'Continue with Telegram',exact:true})).toBeEnabled();expect(f.starts).toHaveLength(0);expect(f.approvals).toHaveLength(0);expect(f.charges).toHaveLength(0);expect(await page.evaluate(()=>(window as unknown as {nativeContactRequests:number}).nativeContactRequests)).toBe(0);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await dialog.screenshot({path:info.outputPath(`browser-login-${am?'am':'en'}.png`)});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).first()).toBeFocused();
  await page.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).first().click();await dialog.getByRole('button',{name:am?'በTelegram ይቀጥሉ':'Continue with Telegram',exact:true}).click();await expect(page.getByRole('heading',{name:'Isolated official-login handoff fixture'})).toBeVisible();expect(f.starts).toHaveLength(1);expect(f.readiness).toHaveLength(0);const start=f.starts[0],destination=new URL(start.callbackURL,websiteOrigin);expect(destination.origin).toBe(websiteOrigin);expect(destination.pathname).toBe('/');expect(destination.searchParams.get('q')).toBe(f.prefix);expect([...destination.searchParams.keys()]).toEqual(['q']);const errorCallback=new URL(start.errorCallbackURL,destination.origin);expect(start.provider).toBe('telegram-oidc');expect(start.disableRedirect).toBe(true);expect(errorCallback.origin).toBe(destination.origin);expect(errorCallback.searchParams.get('lang')).toBe(am?'am':'en');expect(errorCallback.searchParams.get('login')).toBe('1');expect(errorCallback.searchParams.get('next')).toBe(start.callbackURL);expect(f.approvals).toHaveLength(1);expect(new URL(f.approvals[0]).origin).toBe('https://oauth.telegram.org');expect(f.charges).toHaveLength(0);expect(f.external).toHaveLength(0);expect(f.errors).toHaveLength(0);
 }finally{await f.close()}
});

test('registered browser restores its owned account without Mini App SDK or another login',async({page},info)=>{
 test.skip(info.project.name!=='360','One account-restoration/security path; viewport coverage runs separately.');
 const f=await website(page),tid=randomInt(8000000000,8900000000);
 try{
  await verifyFixtureContact(f.db,tid);const user=await f.db.user.findUniqueOrThrow({where:{telegramId:String(tid)}}),token=randomBytes(32).toString('hex');
  await f.db.session.create({data:{id:randomUUID(),token,userId:user.id,expiresAt:new Date(Date.now()+86400000),telegramLaunchId:String(tid),telegramAuthSource:'TELEGRAM_OIDC'}});
  await page.context().addCookies([{name:'__Secure-better-auth.session_token',value:encodeURIComponent(`${token}.${await makeSignature(token,process.env.BETTER_AUTH_SECRET!)}`),domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  await page.goto('/profile');await expect(page.locator('[data-profile-ready]')).toBeVisible();await expect(page.locator('.app-frame')).toHaveAttribute('data-app-environment','browser');await expect(page.getByRole('dialog')).toHaveCount(0);const me=await page.request.get('/api/me');expect(me.status()).toBe(200);expect((await me.json()).user.id).toBe(user.id);expect(f.starts).toHaveLength(0);expect(f.approvals).toHaveLength(0);expect(f.charges).toHaveLength(0);expect(await page.evaluate(()=>(window as unknown as {nativeContactRequests:number}).nativeContactRequests)).toBe(0);expect(f.external).toHaveLength(0);
 }finally{await f.close()}
});

test('cancelled browser approval returns a truthful retry card without a session',async({page},info)=>{
 test.skip(info.project.name!=='360','One cancellation path.');const f=await website(page);
 try{await page.goto('/?telegramLoginError=cancelled&next=%2Fpayments');const card=page.locator('[data-browser-telegram-login]');await expect(card).toBeVisible();await expect(card.getByRole('alert')).toContainText('cancelled');expect((await page.request.get('/api/me')).status()).toBe(401);await card.getByRole('button',{name:'Keep browsing',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(new URL(page.url()).searchParams.has('telegramLoginError')).toBe(false);expect(f.starts).toHaveLength(0);expect(f.external).toHaveLength(0)}finally{await f.close()}
});

test('slow website sign-in gives immediate feedback and retries the original destination',async({page},info)=>{
 test.skip(info.project.name!=='360','One slow-network exercise.');
 const f=await website(page),destination='/payments?type=topups#results',attempts:string[]=[];
 let release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve});
 try{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/auth/sign-in/social',async route=>{
   attempts.push(route.request().postDataJSON().callbackURL);
   if(attempts.length!==1)return route.fallback();
   await hold;await route.fulfill({status:503,json:{error:'Isolated connection failure'}});
  });
  await page.goto('/?'+new URLSearchParams({telegramLoginError:'expired',next:destination}));
  const card=page.locator('[data-browser-telegram-login]');
  await expect(card.getByRole('alert')).toContainText('expired');
  const start=card.getByRole('button',{name:'Continue with Telegram',exact:true});
  await start.click();
  const pending=card.getByRole('button',{name:'Opening Telegram…',exact:true});
  await expect(pending).toBeDisabled();await expect(pending).toHaveAttribute('aria-busy','true');
  expect(await pending.locator('svg').evaluate(icon=>getComputedStyle(icon).animationName)).toBe('none');
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect.poll(()=>attempts.length).toBe(1);
  expect(f.readiness).toHaveLength(0);expect(f.approvals).toHaveLength(0);
  release();await expect(card.getByRole('alert')).toContainText('Telegram could not open');
  await start.click();await expect(page.getByRole('heading',{name:'Isolated official-login handoff fixture'})).toBeVisible();
  expect(attempts).toEqual([destination,destination]);expect(f.approvals).toHaveLength(1);
 }finally{release();await f.close()}
});

test('an unavailable website session can be retried inside the login sheet',async({page},info)=>{
 test.skip(info.project.name!=='360','One session-recovery exercise.');
 const f=await website(page);
 let reads=0,release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve});
 try{
  await page.route('**/api/me',async route=>{
   if(++reads===1)return route.fulfill({status:503,json:{error:'Isolated account lookup failure'}});
   await hold;return route.fulfill({status:401,json:{error:'No active session'}});
  });
  await page.goto('/?telegramLoginError=expired&next=%2Fprofile');
  const card=page.locator('[data-browser-telegram-login]'),login=card.getByRole('button',{name:'Continue with Telegram',exact:true});
  await expect(login).toHaveCount(0);
  await card.getByRole('button',{name:'Retry connection',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('Restoring your account');
  release();await expect(login).toBeEnabled();
  expect(reads).toBe(2);expect(f.starts).toHaveLength(0);expect(f.approvals).toHaveLength(0);
 }finally{release();await f.close()}
});
