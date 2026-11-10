import {expect,test,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture} from '../chapa-browser/fixtures';
import type {CatalogAuction} from '../../src/modules/auctions/catalog';

const after=process.env.MY_BIDS_STAGE!=='before';
async function setup(page:Page,am=false){
 const f=await fixture(page,am),now=new Date(),past=new Date(now.getTime()-60000).toISOString(),future=new Date(now.getTime()+3600000).toISOString(),requests:string[]=[];
 const product={title:'Power bank with integrated charging cables',titleAm:'ፓወር ባንክ ከተገጠሙ የኃይል መሙያ ገመዶች ጋር',description:'Synthetic layout fixture.',descriptionAm:'የገጽ ንድፍ ሙከራ ብቻ።',condition:'New',conditionAm:'አዲስ',images:[{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic power bank banner',sourceType:'ORIGINAL',sourceCredit:null}]};
 const auction:CatalogAuction={slug:f.auction.slug!,code:String(f.auction.publicCode),status:'live',publishedAt:past,featured:false,isDemo:false,bidCount:5,viewCount:'10',startsAt:past,endsAt:future,product,category:{slug:'accessories',name:'Accessories',nameAm:'አክሰሰሪዎች'},fulfillment:{summary:'Fixture',summaryAm:null,region:'Fixture',regionAm:null},terms:{version:1,ruleVersion:'lowest-unique-v4',minParticipants:2,minPoints:'1',maxPoints:null,stepPoints:'0.01',entryFeePoints:'10',maxDistinctBids:100,noWinnerTerms:'Fixture.',cancellationTerms:'Fixture.',fulfillmentSnapshot:'Fixture.'},result:null};
 const row=(id:string,amount:string,outcome:string,rawStatus='LIVE')=>({id,amount,acceptedAt:past,outcome,feePoints:'10',feeRefunded:'0',payment:{status:'PAID',method:'WALLET',transactionRef:'private-reference-never-shown',checkoutId:null},discount:null,auction:{ruleVersion:'lowest-unique-v4',code:rawStatus==='LIVE'?auction.code:rawStatus==='CLOSED'?'900003101':'900003102',slug:rawStatus==='LIVE'?auction.slug:auction.slug+'-'+rawStatus.toLowerCase(),title:product.title,titleAm:product.titleAm,image:{path:product.images[0].path,alt:product.images[0].alt},status:rawStatus,startsAt:past,endsAt:rawStatus==='LIVE'?future:past,isDemo:false}});
 const live=[row('stable-live-one','4.25','LIVE'),row('stable-live-two','4.26','LIVE')],finished=[row('stable-finalizing','2.30','PENDING','CLOSED'),row('stable-cancelled','3.10','CANCELLED','CANCELLED')];
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/my-bids'||url.pathname==='/api/profile')requests.push(url.pathname+url.search)});
 let failList=0;
 await page.route('**/api/my-bids?*',async route=>{if(failList){const status=failList;failList=0;return route.fulfill({status,json:{error:status===401?'Unauthorized':'Synthetic interrupted list'}})}const params=new URL(route.request().url()).searchParams,view=params.get('view'),items=view==='finished'||view==='history'?finished:view==='live'?live:[...live,...finished];await new Promise(resolve=>setTimeout(resolve,120));return route.fulfill({json:{items,page:1,pageSize:20,hasNext:false,serverNow:now.toISOString(),total:items.length,totalPages:1,counts:{total:4,live:2,history:2,active:2,won:0}}})});
 await page.route('**/api/catalog/activity?*',route=>route.fulfill({json:{items:[{code:auction.code,status:'live',views:'10',bids:5,bidders:2,startsAt:past,endsAt:future,resultReady:false},{code:'900003101',status:'closed',views:'10',bids:5,bidders:2,startsAt:past,endsAt:past,resultReady:false}]}}));
 await page.route('**/api/catalog/auctions/*',route=>{const path=new URL(route.request().url()).pathname,closed=path.endsWith('-closed'),cancelled=path.endsWith('-cancelled');return route.fulfill({json:{...auction,slug:closed?finished[0].auction.slug:cancelled?finished[1].auction.slug:auction.slug,code:closed?'900003101':cancelled?'900003102':auction.code,status:cancelled?'cancelled':closed?'closed':'live'}})});
 return {...f,dbAuction:f.auction,requests,auction,live,finished,failNextList:(status:number)=>{failList=status}};
}

test('measure first load, cached tabs and repeated navigation',async({page},info)=>{
 const f=await setup(page),stage=after?'after':'before';
 try{
  const started=performance.now();await page.goto('/my-bids');await expect(page.locator('[data-my-bids-list]')).toBeVisible();const firstLoadMs=performance.now()-started;
  const firstRequests=[...f.requests];
  const finished=page.getByRole(after?'tab':'button',{name:after?'Finished':'Completed',exact:true}),live=page.getByRole(after?'tab':'button',{name:after?'Live':'Active',exact:true});
  await finished.click();await expect(page.locator('[data-bid-id="stable-finalizing"]')).toBeVisible();await live.click();await expect(page.locator('[data-bid-id="stable-live-one"]')).toBeVisible();
  const callsBefore=f.requests.length,tabStart=performance.now();await finished.click();await expect(page.locator('[data-bid-id="stable-finalizing"]')).toBeVisible();const cachedTabMs=performance.now()-tabStart,cachedTabRequests=f.requests.length-callsBefore;
  const beforeNavigation=f.requests.length,navigationStart=performance.now();await page.getByRole('link',{name:'Home',exact:true}).first().click();await page.getByRole('link',{name:'My Bids',exact:true}).first().click();await expect(page.locator('[data-my-bids-list]')).toBeVisible();const repeatedNavigationMs=performance.now()-navigationStart;
  const metrics={stage,width:page.viewportSize()!.width,firstLoadMs,cachedTabMs,repeatedNavigationMs,firstRequests,cachedTabRequests,repeatedNavigationRequests:f.requests.length-beforeNavigation,requests:f.requests};
  mkdirSync('test-results/my-bids-evidence',{recursive:true});writeFileSync(`test-results/my-bids-evidence/${stage}-${info.project.name}.json`,JSON.stringify(metrics,null,2));
  if(after){expect(firstRequests.filter(url=>url.startsWith('/api/my-bids'))).toHaveLength(1);expect(firstRequests.filter(url=>url.startsWith('/api/profile'))).toHaveLength(0);expect(cachedTabRequests).toBe(0);expect(metrics.repeatedNavigationRequests).toBe(0)}
 }finally{await f.db.product.update({where:{id:f.dbAuction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

if(after)for(const am of [false,true])test(`two compact accepted-bid tabs and direct sheets ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await setup(page,am);
 try{
  await page.goto('/my-bids');const list=page.locator('[data-my-bids-list]');await expect(list.locator('[data-bid-id]')).toHaveCount(2);
  await expect(page.locator('[data-my-bids-tabs] button')).toHaveCount(2);await expect(page.locator('[data-my-bids-summary]')).toHaveCount(0);await expect(page.getByText('Payment attempts',{exact:true})).toHaveCount(0);await expect(page.getByText('private-reference-never-shown')).toHaveCount(0);
  const first=list.locator('[data-bid-id]').first();await expect(first).toContainText('4.25');await expect(first).not.toContainText('ETB');await expect(first.locator('img')).toBeVisible();await expect.poll(()=>first.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  const image=await first.locator('[data-bid-thumbnail]').boundingBox();expect(image!.width).toBeGreaterThanOrEqual(64);expect(image!.width).toBeLessThanOrEqual(72);expect(image!.height).toBe(image!.width);
  await first.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByRole('dialog')).toContainText(am?'ጨረታዎን ያቅርቡ':'Place your bid');await expect(page.locator('[data-bid-entry]')).toBeVisible();await expect(page.getByText('Bid details',{exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(first).toBeFocused();
  await page.getByRole('tab',{name:am?'ያለቁ':'Finished',exact:true}).click();await expect(list.locator('[data-bid-id]')).toHaveCount(2);await expect(list.locator('[data-bid-id="stable-finalizing"]')).toContainText(am?'ውጤቱ እየተጠናቀቀ ነው':'Finalizing result');await expect(list.locator('[data-bid-id="stable-finalizing"]')).not.toContainText('Not winning');
  await list.locator('[data-bid-id="stable-finalizing"]').click();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByRole('dialog')).toContainText(am?'ውጤቱ እየተጠናቀቀ ነው':'Finalizing result');await expect(page.locator('[data-result-breakdown]')).toHaveCount(0);await page.keyboard.press('Escape');
  await expect(list.locator('[data-bid-id="stable-cancelled"]')).toContainText(am?'ተሰርዟል':'Cancelled');await list.locator('[data-bid-id="stable-cancelled"]').click();await expect(page.getByRole('dialog')).toContainText(am?'ይህ ጨረታ ተሰርዟል።':'This auction was cancelled.');await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`test-results/my-bids-evidence/compact-${info.project.name}-${am?'am':'en'}.png`,fullPage:true});
 }finally{await f.db.product.update({where:{id:f.dbAuction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

if(after)test('retryable list errors preserve cached rows and authorization loss clears them',async({page})=>{
 const f=await setup(page);
 try{
  f.failNextList(503);await page.goto('/my-bids');await expect(page.getByRole('alert').filter({hasText:'Could not load this page'})).toBeVisible();await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('[data-bid-id]')).toHaveCount(2);
  f.failNextList(503);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('status').filter({hasText:'Showing saved details'})).toBeVisible();await expect(page.locator('[data-bid-id]')).toHaveCount(2);await expect(page.locator('[data-route-skeleton="bids"]')).toHaveCount(0);
  f.failNextList(401);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('[data-bid-id]')).toHaveCount(0);await expect(page.locator('[data-my-bids-list]')).toHaveCount(0);
 }finally{await f.db.product.update({where:{id:f.dbAuction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

if(after)test('a cold detail keeps one sheet frame and browser Back closes it',async({page},info)=>{
 test.skip(info.project.name!=='360','One navigation lifecycle regression is sufficient for the shared sheet.');
 const f=await setup(page);
 try{
  await page.route('**/api/catalog/auctions/'+f.auction.slug,async route=>{await new Promise(resolve=>setTimeout(resolve,800));return route.fulfill({json:f.auction})});
  await page.goto('/my-bids');await expect(page.locator('[data-bid-id]')).toHaveCount(2);
  await page.locator('[data-bid-id="stable-live-one"]').evaluate((node:HTMLButtonElement)=>node.click());
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await dialog.evaluate(node=>Reflect.set(window,'myBidsDialog',node));await expect(page.locator('[data-bid-entry]')).toBeVisible();expect(await dialog.evaluate(node=>Reflect.get(window,'myBidsDialog')===node)).toBe(true);
  await page.goBack();await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(/\/my-bids$/);await expect(page.locator('[data-bid-id="stable-live-one"]')).toBeFocused();
 }finally{await f.db.product.update({where:{id:f.dbAuction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

if(after)test('a published result updates an already-open finalizing sheet',async({page},info)=>{
 test.skip(info.project.name!=='360','The shared batched-publication lifecycle is covered once.');
 const f=await setup(page),row=f.finished[0];let published=false,detailReads=0;
 const result:NonNullable<CatalogAuction['result']>={outcome:'WINNER',winningPoints:'2.30',decision:'LOWEST_UNIQUE',explanation:'The lowest number selected once won.',isDemo:false,closedAt:new Date().toISOString(),source:'SETTLED',demoLabel:null,publishedAt:new Date().toISOString(),winnerDisplay:'Synthetic winner',winnerUsername:null,winnerPhoneMasked:null,acceptedBidCount:2,winnerPhotoPath:null,winnerBannerPath:null,winnerBannerVersion:0};
 const closed:CatalogAuction={...f.auction,slug:row.auction.slug,code:row.auction.code,status:'closed',endsAt:row.auction.endsAt};
 try{
  await page.route('**/api/my-bids?*',route=>route.fulfill({json:{items:[{...row,outcome:published?'WON':'PENDING'}],page:1,pageSize:20,hasNext:false,serverNow:new Date().toISOString()}}));
  await page.route('**/api/catalog/auctions/'+closed.slug,route=>{detailReads++;return route.fulfill({json:{...closed,result:published?result:null}})});
  await page.route('**/api/catalog/activity?*',route=>route.fulfill({json:{items:[{code:closed.code,status:'closed',views:'10',bids:2,bidders:2,startsAt:closed.startsAt,endsAt:closed.endsAt,resultReady:published}]}}));
  await page.route('**/api/results/'+closed.code+'/breakdown?*',route=>route.fulfill({json:{kind:'amounts',auction:{...closed,result},entryFee:'10',variableFees:false,totalBids:2,totalPlayers:2,totalAmounts:2,totalUniqueAmounts:2,pageSize:20,sort:'amount',page:1,totalPages:1,amounts:[]}}));
  await page.goto('/my-bids?view=finished');await page.locator('[data-bid-id="stable-finalizing"]').click();await expect(page.getByRole('dialog')).toContainText('Finalizing result');
  published=true;await expect(page.getByRole('dialog')).toContainText('Synthetic winner',{timeout:25000});expect(detailReads).toBeGreaterThanOrEqual(2);await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(page.locator('[data-bid-id="stable-finalizing"]')).toContainText('Winning bid');
 }finally{await f.db.product.update({where:{id:f.dbAuction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
