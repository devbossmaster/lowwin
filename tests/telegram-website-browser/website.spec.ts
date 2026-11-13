import {expect,test,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';

async function website(page:Page,am=false){
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),prefix='Website '+randomUUID().slice(0,8),auctions:Awaited<ReturnType<typeof bidAuction>>[]=[];
 for(let i=0;i<3;i++){const auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000});auctions.push(auction);await db.product.update({where:{id:auction.productId!},data:{title:`${prefix} ${i+1}`,titleAm:`${prefix} የሙከራ ዕቃ ${i+1}`,images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Isolated browser test product',sourceType:'ORIGINAL'}}}})}
 const external:string[]=[],errors:string[]=[],starts:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('https://api.chapa.global/**',route=>{external.push(route.request().url());return route.abort()});
 await page.route('https://oauth.telegram.org/**',route=>{external.push(route.request().url());return route.abort()});
 await page.addInitScript(language=>{localStorage.setItem('lowwin-language',language);localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram={WebApp:{initData:'',platform:'unknown',ready(){}}}},am?'am':'en');
 await page.context().addCookies([{name:'lowwin-language',value:am?'am':'en',domain:'localhost',path:'/'}]);
 await page.route('**/api/auth/telegram/browser/config',route=>route.fulfill({json:{enabled:true,configured:true}}));
 await page.route('**/api/auth/telegram/browser/start?*',route=>{starts.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<h1>Isolated official-login handoff fixture</h1>'})});
 return {db,home:'/?q='+encodeURIComponent(prefix),prefix,auctions,external,errors,starts,async close(){await db.$disconnect()}};
}

for(const am of [false,true])test(`ordinary website browsing and explicit official login ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await website(page,am);
 try{
  await page.goto(f.home);const frame=page.locator('.app-frame');await expect(frame).toHaveAttribute('data-app-environment','browser');await expect(page.locator('.auction-card')).toHaveCount(3);
  const width=page.viewportSize()!.width;expect(await frame.evaluate(node=>node.getBoundingClientRect().width)).toBeLessThanOrEqual(width);
  expect(await page.locator('.auction-card').first().evaluate(node=>getComputedStyle(node.parentElement!).gridTemplateColumns.split(' ').length)).toBe(width>=1280?3:width>=640?2:1);
  // Guest browsing must not expose the authenticated desktop account navigation.
  await expect(page.locator('[data-browser-navigation]')).toHaveCount(0);
  await expect(page.locator('.mini-bottom-navigation')).toHaveCount(0);
  await page.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-browser-telegram-login]')).toBeVisible();await expect(dialog.locator('input')).toHaveCount(0);await expect(dialog.getByRole('button',{name:am?'በTelegram ይቀጥሉ':'Continue with Telegram',exact:true})).toBeEnabled();expect(f.starts).toHaveLength(0);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await dialog.screenshot({path:info.outputPath(`browser-login-${am?'am':'en'}.png`)});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).first()).toBeFocused();
  await page.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).first().click();await dialog.getByRole('button',{name:am?'በTelegram ይቀጥሉ':'Continue with Telegram',exact:true}).click();await expect(page.getByRole('heading',{name:'Isolated official-login handoff fixture'})).toBeVisible();expect(f.starts).toHaveLength(1);const start=new URL(f.starts[0]),destination=new URL(start.searchParams.get('next')!,start.origin);expect(destination.origin).toBe(start.origin);expect(destination.pathname).toBe('/');expect(destination.searchParams.get('q')).toBe(f.prefix);expect([...destination.searchParams.keys()]).toEqual(['q']);expect(start.searchParams.get('lang')).toBe(am?'am':'en');expect(f.external).toHaveLength(0);expect(f.errors).toHaveLength(0);
 }finally{await f.close()}
});

test('registered browser restores its owned account without Mini App SDK or another login',async({page},info)=>{
 test.skip(info.project.name!=='360','One account-restoration/security path; viewport coverage runs separately.');
 const f=await website(page),tid=randomInt(8000000000,8900000000);
 try{
  await verifyFixtureContact(f.db,tid);const user=await f.db.user.findUniqueOrThrow({where:{telegramId:String(tid)}}),token=randomBytes(32).toString('hex');
  await f.db.session.create({data:{id:randomUUID(),token,userId:user.id,expiresAt:new Date(Date.now()+86400000),telegramLaunchId:String(tid),telegramAuthSource:'TELEGRAM_OIDC'}});
  await page.context().addCookies([{name:'__Secure-better-auth.session_token',value:encodeURIComponent(`${token}.${await makeSignature(token,process.env.BETTER_AUTH_SECRET!)}`),domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  await page.goto('/profile');await expect(page.locator('[data-profile-ready]')).toBeVisible();await expect(page.locator('.app-frame')).toHaveAttribute('data-app-environment','browser');await expect(page.getByRole('dialog')).toHaveCount(0);const me=await page.request.get('/api/me');expect(me.status()).toBe(200);expect((await me.json()).user.id).toBe(user.id);expect(f.starts).toHaveLength(0);expect(f.external).toHaveLength(0);
 }finally{await f.close()}
});

test('cancelled browser approval returns a truthful retry card without a session',async({page},info)=>{
 test.skip(info.project.name!=='360','One cancellation path.');const f=await website(page);
 try{await page.goto('/?telegramLoginError=cancelled&next=%2Fpayments');const card=page.locator('[data-browser-telegram-login]');await expect(card).toBeVisible();await expect(card.getByRole('alert')).toContainText('cancelled');expect((await page.request.get('/api/me')).status()).toBe(401);await card.getByRole('button',{name:'Keep browsing',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(new URL(page.url()).searchParams.has('telegramLoginError')).toBe(false);expect(f.starts).toHaveLength(0);expect(f.external).toHaveLength(0)}finally{await f.close()}
});
