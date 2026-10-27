import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {defaultHomeCopy} from '../../src/components/home-copy';

test('home banner: both languages, image, mobile geometry and existing actions',async({page},info)=>{
 page.setDefaultTimeout(30000);
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);
 if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database});
 const root=process.env.BANNER_CAPTURE_DIR??'test-results/banner-captures';mkdirSync(root,{recursive:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const id=randomInt(9800000000,9900000000);await verifyFixtureContact(db,id);
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{data:signedLaunch({user:JSON.stringify({id,first_name:'Banner fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/');
  const hero=page.locator('section[aria-labelledby="home-headline"]');
  for(const language of ['en','am'] as const){
   if(language==='am'){
    await page.getByRole('banner',{name:'Mini App header'}).getByRole('button',{name:'Language: English',exact:true}).click();
    await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click();
   }
   await expect(hero).toHaveAttribute('lang',language);
   const headline=language==='en'?defaultHomeCopy.headline:defaultHomeCopy.headlineAm;
   const lead=language==='en'?defaultHomeCopy.lead:defaultHomeCopy.leadAm;
   await expect(hero.locator('h1')).toHaveText(headline);
   expect(await hero.locator('p').textContent()).toBe(lead);
   await expect(page.locator('#home-headline')).toHaveCount(1);
   await expect(hero.getByText(lead,{exact:true})).toHaveCount(1);
   const image=hero.locator('img');await expect(image).toHaveAttribute('src',new RegExp(`lowwin-home-banner-${language}\\.webp`));
   await expect.poll(()=>image.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0)).toBe(true);
   await page.evaluate(()=>document.fonts.ready);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   // The approved headline and logo are in the image. Accessible copy stays
   // available to assistive technology without duplicating the visible text.
   const bannerBox=(await hero.boundingBox())!,copyBox=(await hero.locator('.sr-only').boundingBox())!;
   expect(copyBox.width).toBeLessThanOrEqual(1);expect(copyBox.height).toBeLessThanOrEqual(1);
   expect(bannerBox.width).toBe(page.viewportSize()!.width);
   expect(bannerBox.height).toBeLessThanOrEqual(235);
   for(const element of await hero.locator('button,a,small').all()){
    const box=(await element.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bannerBox.x);
    expect(box.x+box.width).toBeLessThanOrEqual(bannerBox.x+bannerBox.width+1);
    expect(box.y+box.height).toBeLessThanOrEqual(bannerBox.y+bannerBox.height+1);
   }
   for(const action of await hero.locator('button,a').all()){
    const box=(await action.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(bannerBox.y);
   }
   await hero.screenshot({path:`${root}/banner-${info.project.name}-${language}.png`});
   const learn=hero.getByRole('button');await learn.click();await expect(page.getByRole('dialog')).toBeVisible();
   await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(learn).toBeFocused();
   await hero.getByRole('link').click();await expect(page.locator('#recent-winners')).toBeFocused();
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  }
  expect(errors).toEqual([]);
 }finally{await db.$disconnect()}
});
