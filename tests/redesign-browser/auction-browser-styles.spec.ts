import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

test('auction sheet loads compact scoped styles in English and Amharic',async({page},info)=>{
 const database=process.env.TEST_DATABASE_URL??'',url=new URL(database);
 if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback styles fixture required');
 const db=new PrismaClient({datasourceUrl:database}),id=randomInt(8000000000,8900000000),errors:string[]=[];
 try{
  await verifyFixtureContact(db,id);page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(launch=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}},{user:signedLaunch({user:JSON.stringify({id,first_name:'Styles fixture'})},process.env.TELEGRAM_BOT_TOKEN)}.user);
  await page.route('**/api/catalog/auctions?**',route=>{
   const query=new URL(route.request().url()).searchParams,now=Date.now();
   if(query.get('view')==='summary')return route.fulfill({json:{totalLive:3,totalUpcoming:0,serverNow:new Date(now).toISOString()}});
   if(query.get('view')!=='quick')return route.continue();
   return route.fulfill({json:{items:query.get('status')==='upcoming'?[]:[1,2,3].map(index=>({code:String(990000+index),slug:`style-proof-${index}`,status:'live',startsAt:new Date(now-3600000).toISOString(),endsAt:new Date(now+86400000).toISOString(),isDemo:true,bidCount:17,product:{title:`DEMO · Compact auction ${index}`,titleAm:`ሙከራ · አጭር ጨረታ ${index}`,images:[{path:'/images/lowwin-demo-headphones.webp',alt:''}]},terms:{version:1,ruleVersion:'lowest-unique-v4',entryFeePoints:'10'}})),total:query.get('status')==='upcoming'?0:3,page:1,pageSize:10,totalPages:1,serverNow:new Date(now).toISOString()}});
  });
  await page.goto('/telegram?next=%2F');const header=page.getByRole('banner',{name:'Mini App header',exact:true});await expect(header).toBeVisible({timeout:60000});
  const directory=process.env.STYLES_REPORT_DIR??'test-results/auction-styles';mkdirSync(directory,{recursive:true});
  for(const language of ['en','am']){
   if(language==='am'){await header.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
   await header.getByRole('button',{name:/Browse auctions|ጨረታዎችን/}).click();const sheet=page.getByRole('dialog',{name:/^(Auctions|ጨረታዎች)$/});await expect(sheet).toBeVisible();const row=sheet.locator('[data-auction-code]').first();await expect(row).toBeVisible();
   await expect(row).toHaveCSS('display','block');await expect(row.locator('img')).toHaveCSS('object-fit','contain');
   const image=await row.locator('img').boundingBox(),rowBox=await row.boundingBox();expect(image!.width).toBeCloseTo(rowBox!.width-2,0);expect(image!.width/image!.height).toBeCloseTo(1840/800,1);
   await expect(sheet.getByRole('tablist')).toHaveCSS('display','grid');await expect(sheet.getByRole('tab').first()).toHaveCSS('background-color','rgb(37, 99, 235)');
   await expect(row.locator('strong:not([data-countdown-tile])')).toHaveCSS('font-size',info.project.use.viewport!.width===360?'13px':'14px');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({animations:'disabled',path:`${directory}/compact-auctions-${info.project.name}-${language}.png`});
   await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);
  }
  expect(errors).toEqual([]);
 }finally{await db.$disconnect()}
});
