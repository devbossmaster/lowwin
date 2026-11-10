import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {mkdirSync} from 'node:fs';
import {fixture} from '../chapa-browser/fixtures';
import {richFinalResult} from '../result-fixtures';

test.describe('Home motion, footer and account prompt',()=>{
 let db:PrismaClient,results:Awaited<ReturnType<typeof richFinalResult>>[]=[];
 test.beforeAll(async()=>{db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL})});
 test.afterAll(async()=>{for(const result of results)await db.product.update({where:{id:result.auction.productId!},data:{visible:false}});await db?.$disconnect()});
 test('recent Winners move slowly, pause, loop, respect reduced motion and open one result',async({page})=>{
  const f=await fixture(page,false);
  try{
   results=await Promise.all([richFinalResult(db),richFinalResult(db)]);
   await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(f.home);
   const carousel=page.locator('[data-winning-carousel]');await carousel.scrollIntoViewIfNeeded();await expect(carousel).toHaveAttribute('data-automatic','true');await page.mouse.move(0,0);
   const start=await carousel.evaluate(el=>el.scrollLeft);await expect.poll(()=>carousel.evaluate(el=>el.scrollLeft),{timeout:5000}).toBeGreaterThan(start+10);
   const originals=carousel.locator('button:not([data-winner-copy])'),copies=carousel.locator('[data-winner-copy]');expect(await originals.count()).toBeGreaterThanOrEqual(2);expect(await copies.count()).toBe(await originals.count());
   for(const copy of await copies.all()){await expect(copy).toHaveAttribute('aria-hidden','true');await expect(copy).toHaveAttribute('tabindex','-1')}
   await page.getByRole('button',{name:'Pause winner scrolling',exact:true}).click();const paused=await carousel.evaluate(el=>el.scrollLeft);await page.waitForTimeout(350);expect(Math.abs(await carousel.evaluate(el=>el.scrollLeft)-paused)).toBeLessThan(1);
   await page.getByRole('button',{name:'Resume winner scrolling',exact:true}).click();await page.mouse.move(0,0);
   const distance=await carousel.evaluate(el=>{const count=el.querySelectorAll('button:not([data-winner-copy])').length;return (el.children[count] as HTMLElement).offsetLeft-(el.children[0] as HTMLElement).offsetLeft});
   await carousel.evaluate((el,d)=>{el.scrollLeft=d-1},distance);await expect.poll(()=>carousel.evaluate(el=>el.scrollLeft)).toBeLessThan(distance/2);
   await page.emulateMedia({reducedMotion:'reduce'});await expect(carousel).not.toHaveAttribute('data-automatic');await expect(copies).toHaveCount(0);await expect(page.getByRole('button',{name:/winner scrolling/})).toHaveCount(0);
   const first=originals.first();await first.scrollIntoViewIfNeeded();await first.click();await expect(page.getByRole('dialog')).toHaveCount(1);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(first).toBeFocused();
  }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
 });
 for(const width of [320,360,430])for(const am of [false,true])test(`compact footer and signed-out Profile ${width}px ${am?'AM':'EN'}`,async({page})=>{
  await page.setViewportSize({width,height:850});const f=await fixture(page,am);const privateReads:string[]=[];
  try{
   await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
   await page.route('**/api/auth/telegram/miniapp/signin',route=>route.fulfill({json:{status:'contact-required',me:null}}));await page.route('**/api/me',route=>route.fulfill({status:401,json:{}}));
   page.on('request',request=>{if(/\/api\/(?:wallet|profile|my-bids)(?:[/?]|$)/.test(new URL(request.url()).pathname))privateReads.push(request.url())});
   await page.goto(f.home);const footer=page.locator('footer[aria-label="'+(am?'የLowwin አገናኞች':'Lowwin footer')+'"]');await footer.scrollIntoViewIfNeeded();await expect(footer).toContainText('Lowwin');await expect(footer.getByRole('link',{name:'Lowwin on Telegram'})).toHaveAttribute('href',/https:\/\/t.me\//);await expect(footer.locator('a[href="/terms"]')).toBeVisible();await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
   await expect(footer.getByRole('link',{name:'Lowwin on Telegram'})).toHaveAttribute('href','https://t.me/lowwin23');await expect(footer.getByRole('link',{name:'Lowwin on TikTok'})).toHaveAttribute('href','https://www.tiktok.com/@lowwinet');await expect(footer.locator('a[target="_blank"]')).toHaveCount(2);await expect(footer).toHaveAttribute('role','contentinfo');
   mkdirSync('test-results/home-polish/screenshots',{recursive:true});await footer.screenshot({path:`test-results/home-polish/screenshots/footer-${width}-${am?'am':'en'}.png`});expect(await footer.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   await page.getByRole('navigation',{name:'Your navigation'}).locator('a[href="/profile"]').click();const prompt=page.getByRole('heading',{name:am?'የLowwin መለያዎ':'Your Lowwin account'}).locator('..');await expect(prompt).toBeVisible();await expect(prompt.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true})).toBeVisible();await expect(prompt.locator('a[href="/"]')).toBeVisible();
   expect(await prompt.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(privateReads).toEqual([]);await prompt.screenshot({path:`test-results/home-polish/screenshots/profile-guest-${width}-${am?'am':'en'}.png`});
   await prompt.getByRole('button',{name:am?'ይግቡ':'Log in',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);
  }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
 });
});
