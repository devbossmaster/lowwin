import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {defaultHomeCopy} from '../../src/components/home-copy';
import {LOWWIN_HOME_BANNER_SRC} from '../../src/lib/brand';

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
  await page.addInitScript(()=>localStorage.setItem('lowwin:mini-introduction:v2','dismissed'));
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
   await expect(hero.locator('p')).toHaveCount(1);await expect(hero.locator('p')).toHaveText(lead);await expect(hero.locator('small')).toHaveCount(0);
   await expect(page.locator('#home-headline')).toHaveCount(1);
   const image=hero.locator('img');await expect(image).toHaveAttribute('width','1840');await expect(image).toHaveAttribute('height','800');
   await expect.poll(()=>image.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0)).toBe(true);
   const sourceRatio=await image.evaluate((node:HTMLImageElement)=>node.naturalWidth/node.naturalHeight);
   await expect(image).toHaveCSS('object-fit','cover');await expect(image).toHaveCSS('mask-image','none');
   await expect(hero.locator('picture,source')).toHaveCount(0);expect(await image.evaluate((node:HTMLImageElement)=>decodeURIComponent(node.currentSrc))).toContain(LOWWIN_HOME_BANNER_SRC[language]);
   await page.evaluate(()=>document.fonts.ready);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   // The approved headline and supporting line remain visible over the artwork
   // in both languages, including compact Mini App layouts.
   await expect(hero.locator('h1')).toBeVisible();await expect(hero.locator('p')).toBeVisible();await expect(hero.locator('p')).toHaveCSS('position','static');await expect(hero.locator('p')).toHaveCSS('clip-path','none');await expect(hero.locator('p')).not.toHaveAttribute('aria-hidden','true');
   const bannerBox=(await hero.boundingBox())!,copyBox=(await hero.locator('h1').boundingBox())!;
   const copyFrame=(await hero.locator('[data-hero-copy]').boundingBox())!,artFrame=(await hero.locator('[data-hero-artwork]').boundingBox())!,imageFrame=(await image.boundingBox())!;
   expect(artFrame.x).toBeCloseTo(bannerBox.x,1);expect(artFrame.y).toBeCloseTo(bannerBox.y,1);expect(artFrame.width).toBeCloseTo(bannerBox.width,1);expect(artFrame.height).toBeCloseTo(bannerBox.height,1);
   expect(copyFrame.x+copyFrame.width).toBeLessThanOrEqual(bannerBox.x+bannerBox.width*.63);
   expect(imageFrame.x).toBeCloseTo(artFrame.x,1);expect(imageFrame.y).toBeCloseTo(artFrame.y,1);expect(imageFrame.width).toBeCloseTo(artFrame.width,1);expect(imageFrame.height).toBeCloseTo(artFrame.height,1);
   await expect(image).toHaveAttribute('alt',language==='en'?/PS5, iPhone, Samsung Galaxy/:/PS5፣ iPhone፣ Samsung Galaxy/);
   expect(copyBox.width).toBeGreaterThan(100);expect(copyBox.height).toBeGreaterThan(28);
   expect(bannerBox.width).toBe(Math.min(page.viewportSize()!.width,460));
   expect(bannerBox.width).toBeGreaterThan(bannerBox.height);expect(bannerBox.width/bannerBox.height).toBeLessThanOrEqual(1840/800+.01);expect(sourceRatio).toBeCloseTo(1840/800,2);
   for(const element of await hero.locator('p,button,a,small').all()){
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
   const learn=hero.getByRole('button',{name:language==='en'?'How it works?':'እንዴት ይሠራል?',exact:true});await learn.click();await expect(page.getByRole('dialog')).toBeVisible();
   await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(learn).toBeFocused();
   const winners=hero.getByRole('link',{name:language==='en'?'Winners':'አሸናፊዎች',exact:true});await expect(winners).toBeVisible();await expect(winners).toHaveAttribute('href','/winners');
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  }
  expect(errors).toEqual([]);
 }finally{await db.$disconnect()}
});
