import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import {fixture} from './fixtures';
import {richFinalResult} from '../result-fixtures';
import {WINNER_IMAGE_HEIGHT,WINNER_IMAGE_WIDTH} from '../../src/lib/winner-image';

test('settled winner uses product, publishes a consented complete banner, and resets without changing the result',async({page,browser,baseURL})=>{
 const f=await fixture(page,false),admin=await browser.newContext({baseURL,ignoreHTTPSErrors:true,viewport:{width:1280,height:900},extraHTTPHeaders:{'x-forwarded-for':'198.18.245.10'}});
 try{
  const result=await richFinalResult(f.db),before=await f.db.auctionSettlement.findUniqueOrThrow({where:{auctionId:result.auction.id}});
  mkdirSync('test-results/chapa-ui/winner-banner',{recursive:true});
  await page.goto('/telegram?next=%2Fwinners');
  const banner=page.locator('[data-winner-banner]').first();
  await expect(banner).toBeVisible();await expect(banner).toHaveAttribute('data-photo','product');await expect(banner).toContainText('100');
  for(const width of [360,430,1280]){
   await page.setViewportSize({width,height:width===1280?900:900});await page.evaluate(()=>document.fonts.ready);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await banner.screenshot({path:`test-results/chapa-ui/winner-banner/product-${width}.png`,animations:'disabled'});
  }
  const actorId=randomUUID(),email=`winner-photo-${actorId}@lowwin.test`,password='Winner-photo-fixture-password-12345';
  await f.db.user.create({data:{id:actorId,email,name:'Winner photo fixture admin',emailVerified:true,role:'admin'}});
  await f.db.account.create({data:{id:randomUUID(),userId:actorId,accountId:actorId,providerId:'credential',password:await hashPassword(password)}});
  const staff=await admin.newPage();await staff.goto('/admin/login');await staff.getByLabel('Email',{exact:true}).fill(email);await staff.getByLabel('Password',{exact:true}).fill(password);await staff.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(staff).toHaveURL(/\/admin$/);await staff.goto('/admin/fulfillment');
  await staff.getByRole('row').filter({hasText:result.title}).getByRole('button',{name:'Details',exact:true}).click();
  const editor=staff.getByRole('region',{name:'Winners banner',exact:true});await expect(editor).toBeVisible();
  // An abstract synthetic PNG proves the upload/crop path without inventing a person.
  const png=await sharp({create:{width:400,height:600,channels:3,background:'#c9a227'}}).png().toBuffer();
  await editor.getByLabel('Choose Winners banner').setInputFiles({name:'synthetic-banner-fixture.png',mimeType:'image/png',buffer:png});
  const save=editor.getByRole('button',{name:'Save Winners banner',exact:true});await expect(save).toBeDisabled();
  await editor.getByRole('checkbox').check();await expect(save).toBeEnabled();await save.click();
  await expect(editor).toHaveCount(0);
  const saved=await f.db.winnerPresentation.findUniqueOrThrow({where:{auctionId:result.auction.id}});expect(saved.version).toBe(1);expect(saved.presentationMode).toBe('BANNER');expect(saved.bannerConsentActorId).toBe(actorId);expect(saved.bannerConsentConfirmedAt).not.toBeNull();expect(saved.bannerImageId).not.toBeNull();
  await page.reload();await expect(banner).toHaveAttribute('data-photo','banner');
  const media=await page.request.get(`/api/media/${saved.bannerImageId}`);expect(media.status()).toBe(200);expect(media.headers()['cache-control']).toContain('no-store');expect(media.headers()['content-type']).toContain('image/webp');expect(await sharp(await media.body()).metadata()).toMatchObject({width:WINNER_IMAGE_WIDTH,height:WINNER_IMAGE_HEIGHT});
  await page.context().addCookies([{name:'lowwin-language',value:'am',domain:'localhost',path:'/'}]);await page.setViewportSize({width:430,height:932});await page.reload();await expect(banner.locator('img')).toHaveAttribute('alt',/የአሸናፊ ባነር/);await page.evaluate(()=>document.fonts.ready);
  await banner.screenshot({path:'test-results/chapa-ui/winner-banner/approved-photo-am-430.png',animations:'disabled'});
  await staff.getByRole('row').filter({hasText:result.title}).getByRole('button',{name:'Details',exact:true}).click();await staff.getByRole('button',{name:'Use product image again',exact:true}).click();await expect(editor).toHaveCount(0);
  await page.reload();await expect(banner).toHaveAttribute('data-photo','product');
  expect((await page.request.get(`/api/media/${saved.bannerImageId}`)).status()).toBe(404);
  const reset=await f.db.winnerPresentation.findUniqueOrThrow({where:{auctionId:result.auction.id}});expect(reset.version).toBe(2);expect(reset.presentationMode).toBe('PRODUCT');expect(reset.bannerImageId).toBeNull();
  expect(await f.db.auctionSettlement.findUniqueOrThrow({where:{auctionId:result.auction.id}})).toEqual(before);
 }finally{await admin.close();await f.db.$disconnect()}
});
