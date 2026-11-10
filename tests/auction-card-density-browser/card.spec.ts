import {expect,test,type Locator} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture} from '../chapa-browser/fixtures';
import type {CatalogAuction} from '../../src/modules/auctions/catalog';

const stage=process.env.CARD_DENSITY_STAGE??'after',after=stage==='after';
async function metrics(card:Locator){return card.evaluate(el=>{
 const rect=(node:Element)=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
 const body=el.querySelector('.auction-card-body')!,title=el.querySelector('h3')!,art=el.querySelector('.auction-card-art')!,facts=el.querySelector('.card-facts')!,fee=el.querySelector('.card-fee')!,clock=el.querySelector('.card-clock')!,button=el.querySelector('.card-action')!,disclaimer=el.querySelector('.card-disclosure')!,caption=el.querySelector('.card-caption')!;
 const styles=getComputedStyle(body),titleStyle=getComputedStyle(title),inlineStyle=getComputedStyle(title.querySelector('a')??title);
 return {card:rect(el),image:rect(art),body:rect(body),title:{...rect(title),lineHeight:Math.max(parseFloat(titleStyle.lineHeight),parseFloat(inlineStyle.lineHeight)),fontSize:parseFloat(titleStyle.fontSize),lines:title.querySelector('a')?.getClientRects().length??1,scrollHeight:title.scrollHeight,clientHeight:title.clientHeight,clamp:titleStyle.getPropertyValue('-webkit-line-clamp'),overflow:titleStyle.overflow},facts:rect(facts),fee:rect(fee),timer:rect(clock),button:rect(button),disclaimer:rect(disclaimer),caption:rect(caption),padding:{top:parseFloat(styles.paddingTop),bottom:parseFloat(styles.paddingBottom)},internalOverflow:Array.from(el.querySelectorAll('.auction-card-body,.card-facts,.card-fee,.card-clock,.card-action,.card-disclosure,.card-caption')).filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.className)};
})}

for(const am of [false,true])test(`compact cards retain status, media, countdown and actions ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await fixture(page,am),now=new Date(),past=new Date(now.getTime()-60000).toISOString(),future=new Date(now.getTime()+13*86400000).toISOString(),posts:string[]=[];
 const base:CatalogAuction={slug:f.auction.slug!,code:String(f.auction.publicCode),status:'live',publishedAt:past,featured:false,isDemo:false,bidCount:31,viewCount:'515',startsAt:past,endsAt:f.auction.endsAt!.toISOString(),product:{title:'Power bank',titleAm:'ፓወር ባንክ',description:'Synthetic layout fixture only.',descriptionAm:'የገጽ ንድፍ ሙከራ ብቻ።',condition:'New',conditionAm:'አዲስ',images:[{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic product banner',sourceType:'ORIGINAL',sourceCredit:null}]},category:{slug:'accessories',name:'Accessories',nameAm:'አክሰሰሪዎች'},fulfillment:{summary:'Fixture',summaryAm:null,region:'Fixture',regionAm:null},terms:{version:1,ruleVersion:'lowest-unique-v4',minParticipants:2,minPoints:'1',maxPoints:null,stepPoints:'0.01',entryFeePoints:'10',maxDistinctBids:100,noWinnerTerms:'Fixture only.',cancellationTerms:'Fixture only.',fulfillmentSnapshot:'Fixture only.'},result:null};
 const long={...base,slug:'density-upcoming-fixture',code:'900000001',status:'upcoming' as const,startsAt:future,endsAt:new Date(now.getTime()+20*86400000).toISOString(),terms:{...base.terms,entryFeePoints:'999999.99'},product:{...base.product,title:'Premium 45W 20,000mAh power bank with integrated charging cables and fast USB-C charging',titleAm:'ፕሪሚየም 45W 20,000mAh ፓወር ባንክ ከተገጠሙ የኃይል መሙያ ገመዶች እና ፈጣን የUSB-C መሙያ ጋር ለረጅም ጊዜ የሚቆይ ባትሪ እና በቀላሉ የሚያገናኙ መውጫዎች'}};
 const closed={...base,slug:'density-closed-fixture',code:'900000002',status:'closed' as const,endsAt:past,product:{...base.product,title:"Rugga's 45W 20,000mAh Power Bank with Built-in USB-C Cable",titleAm:'የሩጋስ 45W 20,000mAh ፓወር ባንክ ከUSB-C ገመድ ጋር'}};
 const items=[base,long,closed];
 try{
  await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(?:payments|auctions\/[^/]+\/(?:bids|batches))/.test(new URL(request.url()).pathname))posts.push(request.url())});
  await page.route('**/api/catalog/auctions?*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.get('view')==='summary'?{totalLive:1,totalUpcoming:1,serverNow:now.toISOString()}:{items,total:3,page:1,pageSize:10,totalPages:1,totalLive:1,totalUpcoming:1,serverNow:now.toISOString()}}));
  await page.route('**/api/catalog/activity?*',route=>route.fulfill({json:{items:items.map(item=>({code:item.code,status:item.status,views:'515',bids:31,bidders:2,startsAt:item.startsAt,endsAt:item.endsAt,resultReady:false}))}}));
  await page.route('**/api/catalog/auctions/*',route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/view'))return route.fulfill({json:{views:'515',counted:false}});return route.fulfill({json:items.find(item=>path.endsWith('/'+item.slug)||path.endsWith('/'+item.code))??base})});
  await page.goto(f.home);await expect(page.locator('.auction-card').first()).toBeVisible();
  await page.getByRole('link',{name:am?'አዲስ':'New',exact:true}).click();
  const cards=page.locator('#discover-auctions .auction-card');await expect(cards).toHaveCount(3);await page.evaluate(()=>document.fonts.ready);
  const reports=[];
  for(let index=0;index<3;index++){
   const card=cards.nth(index);await card.scrollIntoViewIfNeeded();
   await expect(card.locator('.status-tag')).toBeVisible();await expect(card.locator('[aria-label*="recorded views"],[aria-label*="የተመዘገቡ እይታዎች"]')).toBeVisible();
   await expect.poll(()=>card.locator('.auction-card-art img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
   await expect(card.locator('.auction-card-art')).toHaveAttribute('href','/auctions/'+items[index].code);await expect(card.locator('h3 a')).toHaveAttribute('href','/auctions/'+items[index].code);
   const data=await metrics(card);reports.push(data);expect(data.image.width/data.image.height).toBeCloseTo(2.3,1);expect(data.internalOverflow).toEqual([]);
   if(after){await card.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));const directory=`test-results/auction-card-density/${stage}`;mkdirSync(directory,{recursive:true});await card.screenshot({path:`${directory}/card-${info.project.name}-${am?'am':'en'}-${index}.png`,animations:'disabled'})}
   if(after){expect(data.button.height).toBeGreaterThanOrEqual(43.5);expect(data.button.height).toBeLessThanOrEqual(46.5);expect(data.title.scrollHeight).toBeLessThanOrEqual(data.title.clientHeight+1);expect(data.title.clamp).not.toBe('2');expect(data.title.overflow).not.toBe('hidden');expect(Math.abs(data.fee.y+data.fee.height/2-data.timer.y-data.timer.height/2)).toBeLessThanOrEqual(2);expect(data.padding.bottom).toBeLessThanOrEqual(10);if(index===0)expect(data.title.lines).toBe(1);if(index===1)expect(data.title.lines).toBeGreaterThan(2);if(index===2){expect(data.title.lines).toBeLessThanOrEqual(2);if(page.viewportSize()!.width===320)expect(data.title.lines).toBe(2)}}
   if(index>0)await expect(card.getByRole('link',{name:index===1?(am?'ጨረታውን ይመልከቱ':'View auction'):(am?'ውጤቱን ይመልከቱ':'View result'),exact:true})).toHaveAttribute('href','/auctions/'+items[index].code);
  }
  const first=cards.first();await first.scrollIntoViewIfNeeded();const timer=first.getByRole('timer'),initial=await timer.getAttribute('aria-label');await expect(timer.locator('[data-countdown-unit]')).toHaveCount(4);await expect.poll(()=>timer.getAttribute('aria-label'),{timeout:5000}).not.toBe(initial);
  await page.emulateMedia({reducedMotion:'reduce'});await expect(timer).toBeVisible();await expect(timer.locator('[data-countdown-unit]')).toHaveCount(4);await page.emulateMedia({reducedMotion:'no-preference'});
  const bounds=await cards.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom}})),gaps=bounds.slice(1).map((row,i)=>row.top-bounds[i].bottom);if(after)for(const gap of gaps)expect(gap).toBeLessThanOrEqual(17);
  const directory=`test-results/auction-card-density/${stage}`;mkdirSync(directory,{recursive:true});writeFileSync(`${directory}/metrics-${info.project.name}-${am?'am':'en'}.json`,JSON.stringify({width:page.viewportSize()!.width,language:am?'am':'en',stage,cards:reports,gaps},null,2));
  await page.screenshot({path:`${directory}/cards-${info.project.name}-${am?'am':'en'}.png`,fullPage:true});
  await first.getByRole('button').click();await expect(page.getByRole('dialog').locator('[data-bid-entry]')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(first.getByRole('button')).toBeFocused();
  expect(posts).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
