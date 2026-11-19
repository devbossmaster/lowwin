import {expect,test} from '@playwright/test';
import {fixture} from '../chapa-browser/fixtures';
import {randomBytes,randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';

for(const am of [false,true])test(`signed-in product detail, sharing and explicit bid action ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await fixture(page,am),code=f.auction.publicCode.toString(),financial:string[]=[],errors:string[]=[];
 try{
  const guest=await page.request.get('/auctions/'+code,{maxRedirects:0});
  expect(guest.status()).toBe(307);
  const destination=new URL(guest.headers().location,process.env.BETTER_AUTH_URL);
  expect(destination.pathname).toBe('/');
  expect(destination.searchParams.get('next')).toBe('/auctions/'+code);
  const token=randomBytes(32).toString('hex');await f.db.session.create({data:{id:randomUUID(),token,userId:f.user.id,expiresAt:new Date(Date.now()+86400000),telegramLaunchId:f.user.telegramId,telegramAuthSource:'TELEGRAM_OIDC'}});
  await page.context().addCookies([{name:'__Secure-better-auth.session_token',value:encodeURIComponent(token+'.'+await makeSignature(token,process.env.BETTER_AUTH_SECRET!)),domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(language=>{
   localStorage.setItem('lowwin-language',language);localStorage.setItem('lowwin:introduction:v1','dismissed');
   Reflect.set(window,'detailShares',[]);
   const telegram:NonNullable<Window['Telegram']>={WebApp:{initData:'',platform:'unknown',ready(){},openTelegramLink(url){(Reflect.get(window,'detailShares') as string[]).push(url)}}};
   // The reused fixture also installs Mini App launch data. Keep this browser
   // presentation independent of Playwright's init-script execution order.
   Object.defineProperty(window,'Telegram',{configurable:true,get:()=>telegram,set:()=>{}});
  },am?'am':'en');
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:f.user.id,name:'Detail fixture'},sessionKey:'detail-only'}}));
  await page.route('**/api/alerts**',route=>route.fulfill({json:{unread:0,items:[],total:0,totalPages:0}}));
  await page.route('**/api/**',route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(request.method()==='POST'&&/^\/api\/(?:payments\/|auctions\/[^/]+\/bids|wallet\/(?:top-ups|deposit))/.test(path)){financial.push(path);return route.abort()}
   return route.fallback();
  });
  await page.goto('/auctions/'+code);const detail=page.locator('[data-auction-detail]:visible');await expect(detail).toHaveCount(1);await expect(detail).toBeVisible();
  const frame=page.locator('.app-frame');
  await expect(frame).toHaveAttribute('data-app-environment','browser');await expect(detail.getByRole('heading',{level:1})).toHaveText(f.title);
  const image=detail.locator('[data-auction-hero] img').first();await expect(image).toBeVisible();await expect(image).toHaveCSS('object-fit','contain');
  await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).complete&&(element as HTMLImageElement).naturalWidth>0)).toBe(true);
  const imageBox=await image.boundingBox();expect(imageBox!.width/imageBox!.height).toBeCloseTo(1840/800,1);
  const facts=detail.locator('[data-auction-facts]');await expect(facts.locator(':scope>div')).toHaveCount(2);await expect(facts).toContainText('ETB 10.00');await expect(facts).toContainText(code);
  const shares=detail.locator('[data-auction-share-options]');await expect(shares.getByRole('button')).toHaveCount(1);await expect(shares.getByRole('link')).toHaveCount(1);await expect(shares.getByRole('link',{name:'TikTok',exact:true})).toHaveAttribute('href','https://www.tiktok.com/@lowwinet');
  await shares.getByRole('button',{name:'Telegram',exact:true}).click();const urls=await page.evaluate(()=>Reflect.get(window,'detailShares') as string[]);expect(urls).toHaveLength(1);
  const share=new URL(urls[0]);expect(share.origin+share.pathname).toBe('https://t.me/share/url');expect(share.searchParams.get('text')).toBe(f.title+' · LowWin');const launch=new URL(share.searchParams.get('url')!);expect(launch.origin).toBe('https://t.me');expect(launch.searchParams.get('startapp')).toBe('auction_'+code);
  const bid=detail.locator('[data-auction-bid]');await expect(bid).toHaveCount(1);await expect(bid).toBeVisible();await expect(bid.locator('..')).toHaveCSS('position','fixed');
  const navigation=page.getByRole('navigation',{name:'Your navigation',exact:true});await expect(navigation).toBeVisible();
  const frameBox=(await frame.boundingBox())!,bidBox=(await bid.locator('..').boundingBox())!,navBox=(await navigation.boundingBox())!;
  expect(frameBox.width).toBeCloseTo(Math.min(page.viewportSize()!.width,460),0);
  expect(bidBox.x).toBeCloseTo(frameBox.x,0);expect(bidBox.width).toBeCloseTo(frameBox.width,0);
  expect(navBox.x).toBeCloseTo(frameBox.x,0);expect(navBox.width).toBeCloseTo(frameBox.width,0);
  expect(await bid.evaluate(element=>{const rgb=getComputedStyle(element).backgroundColor.match(/\d+/g)!.map(Number);return rgb[2]>rgb[0]&&rgb[2]>rgb[1]})).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`product-top-${am?'am':'en'}.png`),animations:'disabled'});
  await page.screenshot({path:info.outputPath(`product-full-${am?'am':'en'}.png`),fullPage:true,animations:'disabled'});
  await bid.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog).toContainText(f.title);expect(financial).toEqual([]);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
 }finally{await f.db.$disconnect()}
});
