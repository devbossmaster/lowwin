import {expect,test,type Page} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';
import {fixture} from '../chapa-browser/fixtures';
import {defaultHomeCopy} from '../../src/components/home-copy';
import {LOWWIN_HOME_BANNER_SRC} from '../../src/lib/brand';

async function prepare(page:Page,am:boolean,durationMs:number){
 const f=await fixture(page,am,undefined,'lowest-unique-v5'),end=new Date(Date.now()+durationMs).toISOString();
 if(!f.auction.startsAt)throw Error('The isolated countdown fixture requires a start time.');
 const token=randomBytes(32).toString('hex');
 await f.db.session.create({data:{id:randomUUID(),token,userId:f.user.id,expiresAt:new Date(Date.now()+86400000),telegramLaunchId:f.user.telegramId,telegramAuthSource:'TELEGRAM_OIDC'}});
 await page.context().addCookies([{name:'__Secure-better-auth.session_token',value:encodeURIComponent(token+'.'+await makeSignature(token,process.env.BETTER_AUTH_SECRET!)),domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
 const startsAt=f.auction.startsAt.toISOString();
 await page.addInitScript(()=>localStorage.setItem('lowwin:mini-introduction:v2','dismissed'));
 // This suite inspects layout and clocks. Its Home visit must not increment
 // another suite's exact view-count fixture in a shared synthetic catalog.
 await page.route(/\/api\/catalog\/auctions\/[^/]+\/view$/,route=>route.fulfill({json:{views:'12',counted:false}}));
 await page.route('**/api/catalog/activity?*',route=>route.fulfill({json:{items:[{code:String(f.auction.publicCode),status:'live',views:'12',bids:0,bidders:0,startsAt,endsAt:end,resultReady:false}]}}));
 return {...f,end,cleanup:async()=>{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}};
}

for(const am of [false,true])test(`hero and detail timer stay readable ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await prepare(page,am,12*86400000+3*3600000+12*60000+9000),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 if(info.project.name==='1280')await page.addInitScript(()=>{delete window.Telegram});
 try{
  await page.goto('/');const hero=page.locator('[data-home-hero]');await expect(hero.locator('h1')).toHaveText(am?defaultHomeCopy.headlineAm:defaultHomeCopy.headline);await expect(hero.locator('h1')).toBeVisible();
  const art=hero.locator('img');await expect(art).toHaveAttribute('width','1840');await expect(art).toHaveAttribute('height','800');await expect.poll(()=>art.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0)).toBe(true);
  const sourceRatio=await art.evaluate((node:HTMLImageElement)=>node.naturalWidth/node.naturalHeight);
  await expect(art).toHaveCSS('object-fit','cover');await expect(art).toHaveCSS('mask-image','none');
  expect(await art.evaluate((node:HTMLImageElement)=>decodeURIComponent(node.currentSrc))).toContain(LOWWIN_HOME_BANNER_SRC[am?'am':'en']);
  await expect(hero.locator('p')).toHaveCount(1);await expect(hero.locator('p')).toHaveText(am?defaultHomeCopy.leadAm:defaultHomeCopy.lead);
  await expect(hero.locator('p')).toBeVisible();await expect(hero.locator('p')).toHaveCSS('position','static');await expect(hero.locator('p')).toHaveCSS('clip-path','none');
  const layout=await hero.evaluate(node=>{const bounds=node.getBoundingClientRect(),copy=node.querySelector('[data-hero-copy]')!.getBoundingClientRect(),frame=node.querySelector('[data-hero-artwork]')!.getBoundingClientRect(),image=node.querySelector('img')!.getBoundingClientRect();return {heroLeft:bounds.left,heroTop:bounds.top,heroWidth:bounds.width,heroHeight:bounds.height,copyRight:copy.right,copyBottom:copy.bottom,artLeft:frame.left,artTop:frame.top,artWidth:frame.width,artHeight:frame.height,imageTop:image.top,imageHeight:image.height,leftCrop:(frame.left-image.left)/image.width,rightCrop:(image.right-frame.right)/image.width}});
  // The product artwork fills the hero behind the localized HTML copy.
  expect(layout.artLeft).toBeCloseTo(layout.heroLeft,1);expect(layout.artTop).toBeCloseTo(layout.heroTop,1);expect(layout.artWidth).toBeCloseTo(layout.heroWidth,1);expect(layout.artHeight).toBeCloseTo(layout.heroHeight,1);
  expect(layout.heroWidth).toBeGreaterThan(layout.heroHeight);
  expect(layout.heroWidth).toBeCloseTo(Math.min(page.viewportSize()!.width,460),0);
  expect(layout.heroWidth/layout.heroHeight).toBeLessThanOrEqual(1840/800+.01);
  expect(sourceRatio).toBeCloseTo(1840/800,2);
  expect(layout.copyRight).toBeLessThanOrEqual(layout.heroLeft+layout.heroWidth*.63);
  expect(Math.abs(layout.leftCrop)).toBeLessThan(.01);
  expect(Math.abs(layout.rightCrop)).toBeLessThan(.01);
  const learn=hero.getByRole('button',{name:am?'እንዴት ይሠራል?':'How it works?',exact:true});await learn.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(learn).toBeFocused();
  const winners=hero.getByRole('link',{name:am?'አሸናፊዎች':'Winners',exact:true});await expect(winners).toBeVisible();await expect(winners).toHaveAttribute('href','/winners');await hero.scrollIntoViewIfNeeded();await page.evaluate(()=>document.fonts.ready);await hero.screenshot({path:info.outputPath(`hero-${am?'am':'en'}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto('/auctions/'+f.auction.publicCode);const timer=page.locator('[data-auction-detail] [data-countdown-group]').first();await expect(timer.locator('[data-countdown-unit]').first()).toHaveAttribute('data-countdown-value','12');await timer.evaluate(node=>node.scrollIntoView({block:'center'}));await expect(timer.locator('[data-countdown-unit]')).toHaveCount(4);await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(1400);await expect.poll(()=>timer.evaluate(node=>node.getAnimations({subtree:true}).every(animation=>animation.playState!=='paused'))).toBe(true);
  for(const tile of await timer.locator('[data-countdown-tile]').all()){
   const box=(await tile.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(32);expect(box.height).toBeGreaterThanOrEqual(34);
   // The animated 3D leaves can project past the tile during a flip.
   expect(await tile.evaluate(node=>!!node.firstElementChild&&node.firstElementChild.scrollWidth<=node.clientWidth+1)).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('[data-auction-detail]').screenshot({path:info.outputPath(`detail-${am?'am':'en'}.png`)});expect(errors).toEqual([]);
 }finally{await f.cleanup()}
});

test('large day values and reduced motion retain all digits',async({page},info)=>{
 const f=await prepare(page,true,12345*86400000+12000);
 try{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/auctions/'+f.auction.publicCode);const timer=page.locator('[data-auction-detail] [data-countdown-group]').first();await expect(timer).toHaveAttribute('data-countdown-large-values','true');await timer.evaluate(node=>node.scrollIntoView({block:'center'}));await expect(timer.locator('[data-countdown-unit]').first()).toHaveAttribute('data-countdown-value',/^1234[45]$/);
  await page.waitForTimeout(1400);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0);for(const tile of await timer.locator('[data-countdown-tile]').all())expect(await tile.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await timer.screenshot({path:info.outputPath('countdown-large-reduced-am.png')});
 }finally{await f.cleanup()}
});

test('server clock resumes from hidden time and expiry stays nonnegative',async({page},info)=>{
 test.skip(info.project.name!=='320','One isolated timing lifecycle.');await page.clock.install();const f=await prepare(page,false,15000);
 try{
  await page.goto('/auctions/'+f.auction.publicCode);const timer=page.locator('[data-auction-detail] [data-countdown-group]').first();await expect(timer).toHaveAttribute('aria-label',/^Ends in 00 days 00 hours 00 minutes \d\d seconds$/);await timer.evaluate(node=>node.scrollIntoView({block:'center'}));await expect(timer.locator('[data-countdown-unit]')).toHaveCount(4);
  const label=await timer.getAttribute('aria-label');await page.clock.setSystemTime(new Date(Date.now()+30*86400000));await page.clock.fastForward(1000);expect(await timer.getAttribute('aria-label')).not.toEqual(label);await expect(timer.locator('[data-countdown-unit]').first()).toHaveAttribute('data-countdown-value','00');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});const hidden=await timer.getAttribute('aria-label');await page.clock.fastForward(5000);await expect(timer).toHaveAttribute('aria-label',hidden!);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});expect(await timer.getAttribute('aria-label')).not.toEqual(hidden);await page.clock.fastForward(20000);await expect(page.locator('[data-auction-detail] [data-countdown-ended]')).toHaveText('Auction ended');await page.clock.fastForward(3000);await expect(page.locator('[data-auction-detail] [data-countdown-ended]')).toHaveText('Auction ended');
 }finally{await f.cleanup()}
});
