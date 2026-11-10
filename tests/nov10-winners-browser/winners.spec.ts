import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import {fixture} from '../chapa-browser/fixtures';
import {richFinalResult} from '../result-fixtures';

test.describe('published Winners experience',()=>{
 let result:Awaited<ReturnType<typeof richFinalResult>>,db:PrismaClient;
 test.beforeAll(async()=>{db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});result=await richFinalResult(db);await db.user.update({where:{id:result.users[0]},data:{name:'Miki winner',telegramUsername:'fixture_winner'}})});
 test.afterAll(async()=>{if(result)await db.product.update({where:{id:result.auction.productId!},data:{visible:false}});await db?.$disconnect()});
 for(const am of [false,true])test(`cached card, exact deep link and private breakdown ${am?'Amharic':'English'}`,async({page},info)=>{
  const f=await fixture(page,am);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  try{
   await page.route('**/api/results/*/breakdown?*',async route=>{if(!new URL(route.request().url()).searchParams.has('amount'))await gate;await route.continue()});
   await page.goto('/telegram?next='+encodeURIComponent('/winners/'+result.code));
   const modal=page.getByRole('dialog').first();await expect(modal).toBeVisible();await expect(modal.getByRole('heading',{name:am?'የሙከራ ዕቃ · የተጠናቀቀ ጨረታ':result.title,exact:true})).toBeVisible();
   await expect(modal.locator('[data-winner-banner]')).toHaveAttribute('data-photo','product');
   await expect(modal.getByRole('region',{name:am?'የተረጋገጠ ውጤት':'Confirmed result'})).toContainText('Miki winner');await expect(modal.getByRole('region',{name:am?'የተረጋገጠ ውጤት':'Confirmed result'})).toContainText(am?'አንድ ጊዜ':'lowest unique');
   await expect(modal).toContainText('@fixture_winner');await expect(modal).not.toContainText('@@fixture_winner');
   await expect.poll(()=>modal.locator('[data-winner-banner] img').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
   await expect(modal.locator('[data-result-breakdown-ready]')).toHaveCount(0);release();
   const breakdown=modal.locator('[data-result-breakdown-ready]');await expect(breakdown).toHaveAttribute('data-result-breakdown-ready','true');
   await expect(breakdown.locator('dl>div').filter({hasText:am?'የተለያዩ ቁጥሮች':'Distinct numbers'}).locator('dd')).toHaveText('23');await expect(breakdown.locator('dl>div').filter({hasText:am?'አንድ ጊዜ የተመረጡ':'Picked once'}).locator('dd')).toHaveText('1');
   const rows=modal.locator('[data-result-amount]');await expect(rows).toHaveCount(20);
   await modal.getByRole('button',{name:am?'በብዛት የተመረጡ':'Most picked',exact:true}).click();await expect(rows.first()).toHaveAttribute('data-result-amount','50');
   await rows.first().click();const participants=page.getByRole('dialog').last();await expect(participants.getByRole('heading',{name:am?'ተሳታፊዎች':'Participants',exact:true})).toBeVisible();
   await expect(participants).toContainText('Miki winner');expect(await participants.innerText()).not.toContain(result.phone);
   for(const phone of result.phones)expect(await participants.innerText()).not.toContain(phone.replace('+',''));
   await expect(participants.getByRole('navigation',{name:am?'የውጤት ገጾች':'Result pages'})).toBeVisible();
   await participants.getByRole('button',{name:am?'ቀጣይ':'Next',exact:true}).click();await expect(participants).toContainText('2 / 2');
   await participants.getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);
   await modal.getByRole('button',{name:am?'አሸናፊውን አሳይ':'Show winner',exact:true}).click();await expect(modal.locator('[data-winning=true]')).toHaveAttribute('data-result-amount','100');
   mkdirSync('test-results/nov10-winners/screenshots',{recursive:true});await page.evaluate(()=>document.fonts.ready);await modal.screenshot({path:`test-results/nov10-winners/screenshots/result-${info.project.name}-${am?'am':'en'}.png`});
   expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await modal.getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).click();await expect(page).toHaveURL(/\/winners$/);await expect(page.getByRole('dialog')).toHaveCount(0);
   const card=page.getByRole('button',{name:(am?'ውጤት: የሙከራ ዕቃ · የተጠናቀቀ ጨረታ':'Result: '+result.title),exact:true}).first();await card.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(card).toBeFocused();
  }finally{release();await f.db.$disconnect()}
 });
 test('admin replaces a full banner and restores the product without touching result or notifications',async({page,browser},info)=>{
  test.skip(info.project.name!=='430');const f=await fixture(page,false),admin=await browser.newContext({baseURL:info.project.use.baseURL,ignoreHTTPSErrors:true,viewport:{width:1280,height:900},extraHTTPHeaders:{'x-forwarded-for':'198.18.245.15'}});
  try{
   const settlement=await db.auctionSettlement.findUniqueOrThrow({where:{auctionId:result.auction.id}}),publication=await db.resultPublication.findUniqueOrThrow({where:{settlementId:settlement.id}}),notifications=await db.outbox.count({where:{settlementId:settlement.id}});
   const actorId=randomUUID(),email='banner-'+actorId+'@lowwin.test',password='Synthetic-banner-credentials-12345';
   await db.user.create({data:{id:actorId,email,name:'Banner QA admin',emailVerified:true,role:'admin'}});await db.account.create({data:{id:randomUUID(),userId:actorId,accountId:actorId,providerId:'credential',password:await hashPassword(password)}});
   const staff=await admin.newPage();await staff.goto('/admin/login');await staff.getByLabel('Email',{exact:true}).fill(email);await staff.getByLabel('Password',{exact:true}).fill(password);await staff.getByRole('button',{name:'Sign in',exact:true}).click();await expect(staff).toHaveURL(/\/admin$/);await staff.goto('/admin/fulfillment');
   await staff.getByRole('row').filter({hasText:result.title}).getByRole('button',{name:'Details',exact:true}).click();const editor=staff.getByRole('region',{name:'Winners banner',exact:true});await expect(editor).toBeVisible();
   expect(await staff.getByRole('button',{name:/Publish result|Announce result|Unpublish|Reroll/}).count()).toBe(0);
   const buffer=await sharp({create:{width:1840,height:800,channels:3,background:'#c9a227'}}).composite([{input:Buffer.from('<svg width="1840" height="800"><rect x="1300" width="540" height="800" fill="#181815"/></svg>')}]).webp().toBuffer();
   await editor.getByLabel('Choose Winners banner').setInputFiles({name:'synthetic-complete-banner.webp',mimeType:'image/webp',buffer});await editor.getByRole('checkbox').check();await editor.getByRole('button',{name:'Save Winners banner',exact:true}).click();await expect(editor).toHaveCount(0);
   const saved=await db.winnerPresentation.findUniqueOrThrow({where:{auctionId:result.auction.id}});expect(saved.presentationMode).toBe('BANNER');
   await page.goto('/telegram?next='+encodeURIComponent('/winners/'+result.code));const modal=page.getByRole('dialog').first();await expect(modal.locator('[data-winner-banner]')).toHaveAttribute('data-photo','banner');
   const image=await page.request.get('/api/media/'+saved.bannerImageId);expect(image.status()).toBe(200);expect(image.headers()['content-type']).toContain('image/webp');expect(await sharp(await image.body()).metadata()).toMatchObject({width:1840,height:800});
   const box=await modal.locator('[data-winner-banner]').boundingBox();expect(box!.width/box!.height).toBeCloseTo(2.3,1);
   await staff.getByRole('row').filter({hasText:result.title}).getByRole('button',{name:'Details',exact:true}).click();await staff.getByRole('button',{name:'Use product image again',exact:true}).click();await expect(editor).toHaveCount(0);
   await expect.poll(()=>db.winnerPresentation.findUnique({where:{auctionId:result.auction.id}}).then(v=>v?.presentationMode)).toBe('PRODUCT');await page.reload();await expect(page.getByRole('dialog').first().locator('[data-winner-banner]')).toHaveAttribute('data-photo','product');
   expect(await db.auctionSettlement.findUnique({where:{auctionId:result.auction.id}})).toEqual(settlement);expect(await db.resultPublication.findUnique({where:{settlementId:settlement.id}})).toEqual(publication);expect(await db.outbox.count({where:{settlementId:settlement.id}})).toBe(notifications);
  }finally{await admin.close();await f.db.$disconnect()}
 });
});
