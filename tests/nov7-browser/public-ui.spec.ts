import {test,expect,type Page,type Locator} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
const stage=process.env.NOV7_STAGE??'after',isAfter=stage!=='before';
const destination=`test-results/nov7-evidence/${stage}`;
const marker='NOV7 · Wireless headphones';
let code:string,slug:string;
const fixtureCard=(page:Page)=>page.locator('#discover-auctions .auction-card').filter({has:page.getByRole('heading',{name:marker,exact:true})});
test.beforeAll(async()=>{
 const db=new PrismaClient();
 try{
  const body={managedExperience:{bannerEn:'',bannerAm:'',learnIntroEn:'Isolated test explanation: choose the lowest unique bid.',learnIntroAm:'ዝቅተኛውን ልዩ ጨረታ ይምረጡ።',video:{youtube:'',local:'/videos/nov7-tutorial.mp4',poster:'/images/lowin-family-hero.webp'},socials:[]}};
  await db.siteContent.upsert({where:{id:'home'},create:{id:'home',body},update:{body}});
  const existing=await db.auction.findFirst({where:{product:{title:marker}},select:{publicCode:true,slug:true}});
  if(existing){code=String(existing.publicCode);slug=existing.slug!;return}
  const auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3*86400000});
  await db.product.update({where:{id:auction.productId!},data:{title:marker,titleAm:'የሙከራ ሽቦ አልባ ማዳመጫ',description:'Isolated browser-test product. No real prize or live payment.',descriptionAm:'የአሳሽ ሙከራ ዕቃ ነው።',images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Isolated test headphones',sourceType:'ORIGINAL',sortOrder:0}}}});
  await db.auction.update({where:{id:auction.id},data:{publicViewCount:123n}});code=String(auction.publicCode);slug=auction.slug!;
 }finally{await db.$disconnect()}
});
async function identity(page:Page,registered=true){
 const db=new PrismaClient(),id=randomInt(7000000000,7900000000);
 try{if(registered)await verifyFixtureContact(db,id)}finally{await db.$disconnect()}
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.addInitScript(({launch})=>{
  localStorage.setItem('lowwin:introduction:v1','dismissed');
  const listeners=new Set<()=>void>();
  window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},BackButton:{isVisible:false,show(){this.isVisible=true},hide(){this.isVisible=false},onClick(fn){listeners.add(fn)},offClick(fn){listeners.delete(fn)}}}};
 },{launch:signedLaunch({user:JSON.stringify({id,first_name:'Browser QA'})},process.env.TELEGRAM_BOT_TOKEN)});
 // Personal reads are isolated deterministic snapshots. No payment write is made.
 await page.route('**/api/wallet',route=>route.fulfill({json:{available:'123.45',held:'0',total:'123.45'}}));
 await page.route('**/api/alerts?summary=1',route=>route.fulfill({json:{unread:3}}));
 await page.route('**/api/payments/chapa',route=>route.fulfill({json:{enabled:false,mode:'test',configured:false}}));
 await page.route(`**/api/catalog/auctions/${code}/view`,route=>route.fulfill({json:{views:'123',counted:false}}));
}
async function tapTime(page:Page,button:Locator,visibleSelector:string){
 await button.evaluate((element,selector)=>element.addEventListener('click',()=>{
  const state=window as unknown as {__nov7Tap?:number;__nov7Elapsed?:number};state.__nov7Tap=performance.now();state.__nov7Elapsed=undefined;
  const sample=()=>{const target=document.querySelector(selector);if(target&&target.getBoundingClientRect().height>0)state.__nov7Elapsed=performance.now()-state.__nov7Tap!;else requestAnimationFrame(sample)};requestAnimationFrame(sample);
 },{once:true}),visibleSelector);
 await button.click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {__nov7Elapsed?:number}).__nov7Elapsed)).toBeGreaterThanOrEqual(0);
 return page.evaluate(()=>Math.round((window as unknown as {__nov7Elapsed:number}).__nov7Elapsed));
}
for(const network of ['normal','throttled'] as const)test(`optimized ${network} launch, cached routes and sheet`,async({page},info)=>{
 await identity(page);const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
 if(network==='throttled'){await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})}
 const requests:{path:string;type:string;bytes:number;timing?:string}[]=[],lookup=new Map<string,typeof requests[number]>(),errors:string[]=[];
 cdp.on('Network.requestWillBeSent',event=>{const record={path:new URL(event.request.url).pathname,type:event.type??'',bytes:0};requests.push(record);lookup.set(event.requestId,record)});
 cdp.on('Network.loadingFinished',event=>{const row=lookup.get(event.requestId);if(row)row.bytes=event.encodedDataLength});
 cdp.on('Network.responseReceived',event=>{const row=lookup.get(event.requestId);if(row){row.timing=String(event.response.headers['server-timing']??event.response.headers['Server-Timing']??'')}});
 page.on('pageerror',error=>errors.push(error.message));
 let financialWrites=0;page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(?:payments\/|auctions\/[^/]+\/bids)/.test(new URL(request.url()).pathname))financialWrites++});
 const started=Date.now();await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));await expect(fixtureCard(page)).toHaveCount(1);const publicHomeMs=Date.now()-started;await expect(page.locator('[data-header-balance]')).toContainText('123.45');
 const coldHomeMs=Date.now()-started;await page.waitForTimeout(300);
 const coldRequestCount=requests.length,coldTransferredBytes=requests.reduce((sum,row)=>sum+row.bytes,0);
 const card=fixtureCard(page),button=card.getByRole('button');
 const firstSheetMs=await tapTime(page,button,'dialog[open]');await expect(page.getByRole('dialog')).toContainText(marker);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 const repeatSheetMs=await tapTime(page,button,'dialog[open]');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 const nav=page.getByRole('navigation',{name:'Your navigation'});await nav.getByRole('link',{name:'Winners',exact:true}).click();await expect(page.locator('[data-customer-page-header] h1')).toHaveText('Winners');
 const repeatHomeMs=await tapTime(page,nav.getByRole('link',{name:'Home',exact:true}),'#discover-auctions .auction-card');await expect(page.locator('[data-header-balance]')).toContainText('123.45');
 if(isAfter){await expect(card.locator('[aria-label="123 recorded views"]')).toBeVisible();await expect(card.locator('[data-countdown-unit]')).toHaveCount(4);const status=await card.locator('.status-tag').boundingBox(),views=await card.locator('[aria-label="123 recorded views"]').boundingBox();expect(status!.x+status!.width).toBeLessThan(views!.x);await expect(page.getByRole('banner').getByRole('button',{name:/Notifications/})).toHaveCount(0);await expect(page.getByRole('banner').getByRole('link',{name:'How Lowwin works'})).toBeVisible()}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(financialWrites).toBe(0);expect(errors).toEqual([]);
 mkdirSync(destination,{recursive:true});await page.screenshot({path:`${destination}/${network}-${info.project.name}.png`,animations:'disabled'});
 const evidence={stage,network,width:info.project.name,build:'optimized production, isolated loopback database, mocked wallet/alerts/provider availability; synthetic signed Telegram account',publicHomeMs,coldHomeMs,repeatHomeMs,firstSheetMs,repeatSheetMs,coldRequestCount,coldTransferredBytes,totalRequestCount:requests.length,totalTransferredBytes:requests.reduce((sum,row)=>sum+row.bytes,0),financialWrites,requests,errors};writeFileSync(`${destination}/performance-${network}-${info.project.name}.json`,JSON.stringify(evidence,null,2));
});
test('guest introduction, explicit Login, public tutorial, lazy video and reduced motion',async({page},info)=>{
 test.skip(!isAfter,'New public browsing and tutorial do not exist in the baseline');
 await identity(page,false);await page.addInitScript(()=>localStorage.removeItem('lowwin:introduction:v1'));
 let videoRequests=0;await page.route('**/videos/nov7-tutorial.mp4',route=>{videoRequests++;return route.fulfill({status:404,body:''})});
 await page.goto('/');await expect(fixtureCard(page)).toHaveCount(1);await expect(page.getByRole('banner').getByRole('button',{name:'Log in',exact:true})).toBeVisible();
 const welcome=page.getByRole('dialog',{name:'Welcome to Lowwin'});await expect(welcome).toBeVisible();await expect.poll(()=>welcome.locator('[data-tutorial-video] img').evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);mkdirSync(destination,{recursive:true});await page.screenshot({path:`${destination}/introduction-${info.project.name}.png`,animations:'disabled'});await expect(page.locator('iframe,video')).toHaveCount(0);expect(videoRequests).toBe(0);await welcome.getByRole('button',{name:'Watch how it works'}).click();await expect.poll(()=>videoRequests).toBe(1);await expect(welcome.getByRole('status')).toContainText('The video is unavailable');await welcome.getByRole('button',{name:'Continue to auctions'}).click();await expect(welcome).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem('lowwin:introduction:v1'))).toBe('dismissed');
 await page.getByRole('banner').getByRole('link',{name:'How Lowwin works'}).click();await expect(page.locator('[data-customer-page-header] h1')).toHaveText('How it works');await expect(page.getByText('Find an auction',{exact:true})).toBeVisible();await expect(page.getByRole('banner',{name:'Mini App header'})).toHaveCount(0);
 await page.goBack();await expect(fixtureCard(page)).toHaveCount(1);await expect(welcome).toHaveCount(0);await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('[data-countdown-unit]').first()).toBeVisible();
 await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click();await expect(page.getByRole('banner').getByRole('button',{name:'ይግቡ',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 mkdirSync(destination,{recursive:true});await page.screenshot({path:`${destination}/public-am-${info.project.name}.png`,animations:'disabled'});
});
test('countdown pauses while hidden and resumes without replaying missed flips',async({page})=>{
 test.skip(!isAfter,'The baseline uses the old timer presentation');
 await page.clock.install();await identity(page,false);await page.goto('/');const card=fixtureCard(page);await card.scrollIntoViewIfNeeded();const timer=card.getByRole('timer');await expect(timer.locator('[data-countdown-unit]')).toHaveCount(4);
 const before=await timer.getAttribute('aria-label');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});await page.clock.fastForward(65000);expect(await timer.getAttribute('aria-label')).toBe(before);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))});await expect.poll(()=>timer.getAttribute('aria-label')).not.toBe(before);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0);
 await page.evaluate(()=>{const spacer=document.createElement('div');spacer.dataset.countdownSpacer='true';spacer.style.height='2000px';document.querySelector('main')!.prepend(spacer);window.scrollTo(0,0)});await expect(timer).not.toBeInViewport();await page.clock.runFor(50);const offscreen=await timer.getAttribute('aria-label');await page.clock.fastForward(5000);expect(await timer.getAttribute('aria-label')).toBe(offscreen);
 await page.locator('[data-countdown-spacer]').evaluate(node=>node.remove());await timer.scrollIntoViewIfNeeded();await expect.poll(()=>timer.getAttribute('aria-label')).not.toBe(offscreen);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'reduce'});const reduced=await timer.getAttribute('aria-label');await page.clock.runFor(1000);await expect.poll(()=>timer.getAttribute('aria-label')).not.toBe(reduced);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0);
});

test('split-flap countdown rolls over only changed units and clears both animated halves',async({page},info)=>{
 test.skip(!isAfter,'The baseline uses the old timer presentation');
 const db=new PrismaClient();
 let title:string,auctionSlug:string;
 try{
  const auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:125000});
  title=`NOV7 countdown ${auction.code}`;auctionSlug=auction.slug!;
  await db.product.update({where:{id:auction.productId!},data:{title,images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Isolated countdown test headphones',sourceType:'ORIGINAL'}}}});
 }finally{await db.$disconnect()}
 await page.clock.install();await identity(page,false);
 await page.goto('/?q='+encodeURIComponent(title));const card=page.locator('#discover-auctions .auction-card').filter({has:page.getByRole('heading',{name:title,exact:true})});await card.scrollIntoViewIfNeeded();const timer=card.getByRole('timer');await expect(timer.locator('[data-countdown-unit]')).toHaveCount(4);
 // Isolate the visual clock from background server samples: the browser clock
 // advances minutes while the real test database clock advances milliseconds.
 // Existing cached content must remain usable during a refresh transport error.
 await page.route('**/api/catalog/auctions?view=home**',route=>route.abort('connectionfailed'));
 await page.clock.pauseAt(await page.evaluate(()=>Date.now()+200));
 // pauseAt may stop between one-second paints. Recompute at that exact paused
 // instant before deriving the fast-forward distance from the visible units.
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(100);
 const values=()=>timer.locator('[data-countdown-unit]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.countdownValue!));
 const arm=()=>timer.evaluate(node=>{
  type Frame={values:string[];animated:{unit:number;phase:string;value:string}[]};
  const state=node as HTMLElement&{__countdownObserver?:MutationObserver;__countdownFrames?:Frame[]};state.__countdownObserver?.disconnect();state.__countdownFrames=[];
  state.__countdownObserver=new MutationObserver(()=>{const units=Array.from(node.querySelectorAll<HTMLElement>('[data-countdown-unit]'));state.__countdownFrames!.push({values:units.map(unit=>unit.dataset.countdownValue!),animated:units.flatMap((unit,index)=>Array.from(unit.querySelectorAll<HTMLElement>('[data-countdown-flip]')).map(layer=>({unit:index,phase:layer.dataset.countdownFlip!,value:layer.textContent!.trim()})))});});state.__countdownObserver.observe(node,{subtree:true,childList:true,attributes:true,attributeFilter:['data-countdown-value']});
 });
 const frames=()=>timer.evaluate(node=>(node as HTMLElement&{__countdownFrames:{values:string[];animated:{unit:number;phase:string;value:string}[]}[]}).__countdownFrames);
 const initial=await values(),total=initial.reduce((sum,value,index)=>sum+Number(value)*[86400,3600,60,1][index],0);expect(total).toBeGreaterThan(60);
 await page.clock.fastForward((total-60)*1000);await expect.poll(values).toEqual(['00','00','01','00']);await page.waitForTimeout(350);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0,{timeout:100});
 // Each virtual second is explicit; animation cleanup is checked without
 // advancing the clock into another tick or replaying any skipped values.
 await arm();await page.clock.runFor(1000);mkdirSync(destination,{recursive:true});await timer.screenshot({path:`${destination}/split-flap-mid-${info.project.name}.png`,animations:'allow'});await expect.poll(values).toEqual(['00','00','00','59']);
 const rollover=(await frames()).find(frame=>frame.values.join(':')==='00:00:00:59'&&frame.animated.length===4);expect(rollover?.animated).toEqual(expect.arrayContaining([{unit:2,phase:'outgoing',value:'01'},{unit:2,phase:'incoming',value:'00'},{unit:3,phase:'outgoing',value:'00'},{unit:3,phase:'incoming',value:'59'}]));expect(rollover?.animated.every(layer=>layer.unit>=2)).toBe(true);
 await page.waitForTimeout(350);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0,{timeout:100});
 await arm();await page.clock.runFor(1000);await expect.poll(values).toEqual(['00','00','00','58']);const seconds=(await frames()).find(frame=>frame.animated.length===2);expect(seconds?.animated).toEqual([{unit:3,phase:'outgoing',value:'59'},{unit:3,phase:'incoming',value:'58'}]);
 await page.clock.fastForward(48000);await expect.poll(values).toEqual(['00','00','00','10']);await page.waitForTimeout(350);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0,{timeout:100});
 await arm();await page.clock.runFor(1000);await expect.poll(values).toEqual(['00','00','00','09']);const tenToNine=(await frames()).find(frame=>frame.animated.length===2);expect(tenToNine?.animated).toEqual([{unit:3,phase:'outgoing',value:'10'},{unit:3,phase:'incoming',value:'09'}]);
 await page.waitForTimeout(350);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0,{timeout:100});await arm();await page.clock.runFor(1000);await expect.poll(values).toEqual(['00','00','00','08']);const nineToEight=(await frames()).find(frame=>frame.animated.length===2);expect(nineToEight?.animated).toEqual([{unit:3,phase:'outgoing',value:'09'},{unit:3,phase:'incoming',value:'08'}]);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0);await page.clock.runFor(1000);await expect.poll(values).toEqual(['00','00','00','07']);await expect(timer.locator('[data-countdown-flip]')).toHaveCount(0);
 expect(await timer.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);mkdirSync(destination,{recursive:true});await card.screenshot({path:`${destination}/split-flap-${info.project.name}.png`,animations:'disabled'});
 await timer.evaluate(node=>(node as HTMLElement&{__countdownObserver?:MutationObserver}).__countdownObserver?.disconnect());await page.goto('/auctions/'+auctionSlug);const detailTimer=page.getByRole('region',{name:'Auction activity',exact:true}).getByRole('timer');await expect(detailTimer).toBeVisible();await expect(detailTimer.locator('[data-countdown-tile]')).toHaveCount(4);await detailTimer.screenshot({path:`${destination}/split-flap-large-${info.project.name}.png`,animations:'disabled'});mkdirSync('.local/countdown-reference',{recursive:true});await page.screenshot({path:'.local/countdown-reference/detail-first.png',fullPage:true,animations:'disabled'});
});
test('notifications live in Profile without adding a bottom destination',async({page})=>{
 test.skip(!isAfter,'The baseline still has a header notification bell');
 let alertReads=0;page.on('request',request=>{if(request.url().includes('/api/alerts?summary=1'))alertReads++});await identity(page);await page.goto('/telegram?next=%2F');await expect(page.locator('[data-header-balance]')).toContainText('123.45');expect(alertReads).toBe(0);
 const nav=page.getByRole('navigation',{name:'Your navigation'});await expect(nav.getByRole('link')).toHaveCount(5);await nav.getByRole('link',{name:'Profile',exact:true}).click();const notifications=page.getByRole('link',{name:/Notifications/});await expect(notifications).toBeVisible();await expect(notifications).toHaveAttribute('href','/profile/alerts');await expect(notifications.locator('[data-unread-indicator]')).toHaveText('3');expect(alertReads).toBe(1);await expect(page.getByRole('banner',{name:'Mini App header'})).toHaveCount(0);
});
