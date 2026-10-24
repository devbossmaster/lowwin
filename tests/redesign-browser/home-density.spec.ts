import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

test('first auction visibility and edge-to-edge uploaded photo',async({page},info)=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),root=process.env.DENSITY_CAPTURE_DIR??'test-results/home-density',before=process.env.DENSITY_PHASE==='before';mkdirSync(root,{recursive:true});
 try{
  const marker='QA photo '+randomUUID().slice(0,6),a=await bidAuction(db,{fee:15,isDemo:false,ruleVersion:'lowest-unique-v4',endDelayMs:3600000}),id=randomInt(8000000000,8900000000);
  if(!before){const imageResponse=await page.request.get('/images/lowwin-demo-headphones.webp',{maxRedirects:0});expect(imageResponse.status()).toBe(200);expect(imageResponse.headers()['content-type']).toContain('image/webp');expect((await page.request.get('/api/me')).status()).toBe(401)}
  await db.product.update({where:{id:a.productId!},data:{title:marker+' wireless headphones',titleAm:'የሙከራ ገመድ አልባ ማዳመጫ',images:{create:{path:'/catalog/accessory.svg',alt:'Clearly labeled QA image placeholder',sourceType:'ORIGINAL'}}}});
  await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  // Explicit fixture transport: same generated asset as the pinned staging preview.
  await page.route('**/catalog/*.svg',route=>route.fulfill({contentType:'image/webp',body:readFileSync('public/images/lowwin-demo-headphones.webp')}));
  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Density QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));
  const card=page.locator('#discover-auctions .auction-card').first(),nav=page.getByRole('navigation',{name:'Your navigation'});await expect(card).toBeVisible();
  const report:Record<string,unknown>={width:info.project.name,phase:before?'before':'after',mode:'optimized Chromium loopback'};
  for(const language of ['en','am'] as const){
   if(language==='am'){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','am')}
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo({top:0,behavior:'instant'})});await expect(card.locator('img')).toHaveJSProperty('naturalWidth',1840);
   const c=(await card.boundingBox())!,bar=(await nav.boundingBox())!,art=(await card.locator('.auction-card-art').boundingBox())!,img=(await card.locator('img').boundingBox())!;
   const visible=Math.max(0,Math.min(c.y+c.height,bar.y)-Math.max(0,c.y))/c.height;
   const chips=await page.locator('nav[aria-label="Auction categories"] a,nav[aria-label="Auction sorting"] a').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {height:r.height,textOverflow:node.scrollWidth>node.clientWidth+1}}));
   report[language]={cardTop:Math.round(c.y),cardHeight:Math.round(c.height),navTop:Math.round(bar.y),visiblePercent:Math.round(visible*1000)/10,imageInset:Math.round(art.x-c.x),imageWidth:Math.round(art.width)};
   if(!before){expect(visible).toBeGreaterThanOrEqual(.75);expect(Math.abs(art.x-c.x)).toBeLessThanOrEqual(1);expect(Math.abs(art.width-c.width)).toBeLessThanOrEqual(1);expect(Math.abs(img.width-art.width)).toBeLessThan(1);expect(await card.locator('img').evaluate(node=>getComputedStyle(node).objectFit)).toBe('cover');for(const chip of chips){expect(chip.height).toBeGreaterThanOrEqual(44);expect(chip.textOverflow).toBe(false)}}
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${root}/${before?'before':'after'}-${info.project.name}-${language}.png`});
  }
  writeFileSync(`${root}/${before?'before':'after'}-${info.project.name}.json`,JSON.stringify(report,null,2));
 }finally{await db.$disconnect()}
});
