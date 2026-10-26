import {test,expect,type Page,type Locator,type Request} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

type Summary={totalLive:number;totalUpcoming:number;serverNow:string};
type QuickItem={slug:string;code:string;status:string;startsAt:string;endsAt:string;isDemo:boolean;bidCount:number;product:{title:string;titleAm:string;images:{path:string}[]};terms:{version:number;ruleVersion:string;entryFeePoints:string}};
type Quick={items:QuickItem[];total:number;page:number;pageSize:number;totalPages:number;serverNow:string};
const quick=(url:string)=>{const parsed=new URL(url);return parsed.pathname==='/api/catalog/auctions'&&parsed.searchParams.get('view')==='quick'};
const summary=(url:string)=>{const parsed=new URL(url);return parsed.pathname==='/api/catalog/auctions'&&parsed.searchParams.get('view')==='summary'};
const hammer=(page:Page)=>page.getByRole('banner',{name:'Mini App header',exact:true}).getByRole('button',{name:/Browse auctions|ጨረታዎች/});
const sheet=(page:Page)=>page.getByRole('dialog',{name:/^(Auctions|ጨረታዎች)$/});
const rows=(dialog:Locator)=>dialog.locator('[data-auction-code]');
const root=()=>process.env.AUCTION_BROWSER_REPORT_DIR??'test-results/auction-browser-sheet';
const report=(name:string,value:unknown)=>{mkdirSync(root(),{recursive:true});writeFileSync(`${root()}/${name}.json`,JSON.stringify(value,null,2)+'\n')};
function sensitiveKeys(value:unknown,path=''):string[]{
 if(!value||typeof value!=='object')return [];
 return Object.entries(value).flatMap(([key,item])=>/^(?:phone|phoneNumber|phoneDisplay|telegramId|userId|participants|bidAmounts|amounts|uniqueness|uniqueBidder)$/i.test(key)?[`${path}.${key}`]:sensitiveKeys(item,`${path}.${key}`));
}
function observe(page:Page){
 const errors:string[]=[],financialPosts:string[]=[],privateBreakdowns:string[]=[],requests:string[]=[],detailRequests:string[]=[],ownBidRequests:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',(request:Request)=>{const url=new URL(request.url()),path=url.pathname;if(quick(url.href))requests.push(`${url.searchParams.get('status')}:${url.searchParams.get('page')??'1'}`);if(request.method()==='GET'&&/^\/api\/catalog\/auctions\/[^/]+$/.test(path))detailRequests.push(path);if(request.method()==='GET'&&/^\/api\/auctions\/[^/]+\/bids$/.test(path))ownBidRequests.push(path);if(request.method()==='POST'&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/(?:top-ups|deposit))/.test(path))financialPosts.push(path);if(/\/api\/.*(?:participants|bid-breakdown|amount-breakdown)/.test(path))privateBreakdowns.push(path)});
 return {errors,financialPosts,privateBreakdowns,requests,detailRequests,ownBidRequests};
}
async function authenticate(page:Page){
 const database=process.env.TEST_DATABASE_URL??'',target=new URL(database);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Pinned loopback _test database required');
 const db=new PrismaClient({datasourceUrl:database});
 try{
  // CI can run this file first. Provision only its own local synthetic contact;
  // no wallet credit, bid, auction, reward or provider fixture is created here.
  const telegramId=randomInt(8000000000,8900000000);await verifyFixtureContact(db,telegramId);
  const launch=signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Auction browser QA'})},process.env.TELEGRAM_BOT_TOKEN);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});
  await page.addInitScript(({launch})=>{
   const callbacks=new Set<()=>void>(),state=window as unknown as {__auctionTelegramBack:()=>void};
   state.__auctionTelegramBack=()=>callbacks.forEach(callback=>callback());
   window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},BackButton:{isVisible:false,show(){this.isVisible=true},hide(){this.isVisible=false},onClick(callback:()=>void){callbacks.add(callback)},offClick(callback:()=>void){callbacks.delete(callback)}}}};
  },{launch});
 }finally{await db.$disconnect()}
}
async function launchHome(page:Page){await page.goto('/telegram?next=%2F');await expect(page.locator('#home-headline')).toBeAttached({timeout:60000});await expect(hammer(page)).toBeVisible();await expect(page.locator('.customer-loading')).toHaveCount(0)}
async function open(page:Page){
 await hammer(page).evaluate(button=>button.addEventListener('click',()=>{(window as unknown as {__auctionOpenAt:number}).__auctionOpenAt=performance.now()},{once:true}));await hammer(page).click();await expect(sheet(page)).toBeVisible();
 await page.evaluate(()=>{const state=window as unknown as {__auctionOpenAt:number;__auctionOpenTimes?:number[]};(state.__auctionOpenTimes??=[]).push(Math.round(performance.now()-state.__auctionOpenAt))});return sheet(page);
}
async function setAmharic(page:Page){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
async function close(page:Page,dialog:Locator,mode:'escape'|'telegram'|'button'){
 const current=page.url();
 if(mode==='escape')await page.keyboard.press('Escape');else if(mode==='telegram')await page.evaluate(()=>(window as unknown as {__auctionTelegramBack:()=>void}).__auctionTelegramBack());else await dialog.getByRole('button',{name:/^(Close|ዝጋ)$/}).click();
 await expect(dialog).toHaveCount(0);await expect(hammer(page)).toBeFocused();expect(page.url()).toBe(current);
}

test('actual auction summaries stay public and cached across compact-sheet navigation',async({page},info)=>{
 const state=observe(page),seen:Record<string,Quick>={},summaries:Summary[]=[];mkdirSync(root(),{recursive:true});
 page.on('response',async response=>{try{if(!response.ok())return;if(summary(response.url()))summaries.push(await response.json());else if(quick(response.url())){const url=new URL(response.url());seen[`${url.searchParams.get('status')}:${url.searchParams.get('page')??'1'}`]=await response.json()}}catch{/* A canceled navigation is covered by visible-state assertions. */}});
 await authenticate(page);await launchHome(page);await expect.poll(()=>summaries.length).toBeGreaterThan(0);
 const initial=summaries.at(-1)!;expect(sensitiveKeys(initial)).toEqual([]);const badge=page.locator('[data-live-auction-indicator]');await expect(badge).toHaveText(initial.totalLive>99?'99+':String(initial.totalLive));await expect(hammer(page)).toHaveAttribute('aria-label',`Browse auctions, ${initial.totalLive} live`);
 const languages:unknown[]=[];
 for(const language of ['en','am'] as const){
  if(language==='am')await setAmharic(page);
  let dialog=await open(page);await expect(dialog.getByRole('tab')).toHaveCount(2);await dialog.getByRole('tab').nth(0).click();await expect(dialog.getByRole('link',{name:/Browse all auctions|ሁሉንም ጨረታዎች ይመልከቱ/})).toHaveAttribute('href','/auctions/all?status=live');await expect.poll(()=>seen['live:1']?.page).toBe(1);
  const live=seen['live:1'];expect(live.total).toBe(initial.totalLive);expect(live.pageSize).toBe(10);expect(sensitiveKeys(live)).toEqual([]);await expect(rows(dialog)).toHaveCount(Math.min(10,live.total));expect(await rows(dialog).evaluateAll(elements=>elements.every(element=>element.tagName==='BUTTON'))).toBe(true);
  for(const item of live.items){const row=dialog.locator(`[data-auction-code="${item.code}"]`);await expect(row).toHaveAttribute('data-auction-status',item.status);await expect(row).toContainText(language==='am'?(item.product.titleAm||item.product.title):item.product.title)}
  await page.evaluate(async()=>{await document.fonts.ready});await page.screenshot({animations:'disabled',path:`${root()}/auction-browser-actual-live-${info.project.name}-${language}.png`});
  await dialog.getByRole('tab').nth(1).click();await expect(dialog.getByRole('link',{name:/Browse all auctions|ሁሉንም ጨረታዎች ይመልከቱ/})).toHaveAttribute('href','/auctions/all?status=upcoming');await expect.poll(()=>seen['upcoming:1']?.page).toBe(1);const upcoming=seen['upcoming:1'];expect(upcoming.total).toBe(initial.totalUpcoming);expect(sensitiveKeys(upcoming)).toEqual([]);await expect(rows(dialog)).toHaveCount(Math.min(10,upcoming.total));await page.screenshot({animations:'disabled',path:`${root()}/auction-browser-actual-upcoming-${info.project.name}-${language}.png`});
  const before=state.requests.length;await close(page,dialog,'escape');dialog=await open(page);await expect(dialog.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');await expect(rows(dialog)).toHaveCount(Math.min(10,upcoming.total));expect(state.requests.length).toBe(before);await close(page,dialog,'telegram');dialog=await open(page);await close(page,dialog,'button');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);languages.push({language,liveTotal:live.total,upcomingTotal:upcoming.total,cachedReopen:true,focusAndBack:true,noHorizontalOverflow:true});
 }
 const browseAll=(dialog:Locator)=>dialog.getByRole('link',{name:'ሁሉንም ጨረታዎች ይመልከቱ',exact:true});let finalDialog=await open(page);await browseAll(finalDialog).click();await expect(page).toHaveURL(/\/auctions\/all\?status=upcoming$/);await expect(finalDialog).toHaveCount(0);
 await expect(page.getByRole('banner',{name:'Mini App header',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'ተመለስ',exact:true}).click();await expect(hammer(page)).toBeVisible();
 finalDialog=await open(page);await finalDialog.getByRole('tab').nth(0).click();await browseAll(finalDialog).click();await expect(page).toHaveURL(/\/auctions\/all\?status=live$/);await expect(finalDialog).toHaveCount(0);
 await expect(page.getByRole('banner',{name:'Mini App header',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'ተመለስ',exact:true}).click();await expect(hammer(page)).toBeVisible();
 let liveNestedBid=false;if(initial.totalLive>0){finalDialog=await open(page);const row=rows(finalDialog).first(),title=await row.locator('strong').innerText(),beforeUrl=page.url(),panel=finalDialog.getByRole('tabpanel');await row.click();const child=page.getByRole('dialog',{name:'ጨረታዎን ያቅርቡ',exact:true});await expect(child).toBeVisible();await expect(child).toContainText(title);expect(page.url()).toBe(beforeUrl);await expect(page.locator('dialog[open]')).toHaveCount(2);await expect(child.locator('[data-sheet-details-ready=true]')).toBeVisible();const position=await panel.evaluate(element=>element.scrollTop),detailReads=state.detailRequests.length,ownReads=state.ownBidRequests.length;await page.keyboard.press('Escape');await expect(child).toHaveCount(0);await expect(finalDialog).toBeVisible();await expect(row).toBeFocused();await expect(finalDialog.getByRole('tab').nth(0)).toHaveAttribute('aria-selected','true');expect(await panel.evaluate(element=>element.scrollTop)).toBe(position);await row.click();await expect(child.locator('[data-sheet-details-ready=true]')).toBeVisible();expect(state.detailRequests.length).toBe(detailReads);expect(state.ownBidRequests.length).toBe(ownReads);await page.keyboard.press('Escape');await expect(child).toHaveCount(0);expect(page.url()).toBe(beforeUrl);await close(page,finalDialog,'button');liveNestedBid=true}
 for(const key of new Set(state.requests))expect(state.requests.filter(item=>item===key).length).toBe(1);
 expect(state.financialPosts).toEqual([]);expect(state.privateBreakdowns).toEqual([]);expect(state.errors).toEqual([]);
 report(`auction-browser-nested-actual-${info.project.name}`,{fixture:'fresh guarded synthetic verified contact/account; actual local catalog API; no financial fixture writes',timingClaims:false,reason:'Parallel local QA; prior isolated observations remain separate',width:info.project.use.viewport!.width,languages,quickRequests:state.requests,summaryRequests:summaries.length,footerUpcomingNavigation:true,footerLiveNavigation:true,homeOnlyHeader:true,compactBackNavigation:true,liveNestedBid,childReopenExtraDetailReads:0,childReopenExtraOwnBidReads:0,financialPosts:0,privateBreakdownRequests:0,errors:state.errors});
});

test('delayed quick GETs keep sheets instant, selected-tab data safe and refresh content visible',async({page},info)=>{
 const state=observe(page);mkdirSync(root(),{recursive:true});await authenticate(page);
 let releaseLive!:()=>void,releaseRefresh!:()=>void,releaseHydration!:()=>void,liveReleased=false,upcomingReads=0,refreshFailure=false,detailReads=0,ownReads=0,previewDeadline:string|null=null;
 const pendingLive=new Promise<void>(resolve=>{releaseLive=()=>{liveReleased=true;resolve()}}),pendingRefresh=new Promise<void>(resolve=>{releaseRefresh=()=>{refreshFailure=true;resolve()}}),pendingHydration=new Promise<void>(resolve=>{releaseHydration=resolve});
 const now=Date.now(),at=new Date(now).toISOString(),item=(status:'live'|'upcoming',number:number):QuickItem=>({slug:`qa-${status}-${number}`,code:String((status==='live'?900000:910000)+number),status,startsAt:new Date(now+(status==='live'?-3600000:3600000)).toISOString(),endsAt:status==='live'&&number===1&&previewDeadline?previewDeadline:new Date(now+86400000).toISOString(),isDemo:false,bidCount:status==='live'?17:0,product:{title:`QA ${status} fixture ${number}`,titleAm:`የሙከራ ${status==='live'?'ክፍት':'መጪ'} ጨረታ ${number}`,images:[]},terms:{version:1,ruleVersion:'lowest-unique-v4',entryFeePoints:'10'}});
 const data=(status:'live'|'upcoming',page=1):Quick=>({items:status==='live'?Array.from({length:page===1?10:2},(_,index)=>item(status,index+(page-1)*10+1)):Array.from({length:2},(_,index)=>item(status,index+1)),total:status==='live'?12:2,page,pageSize:10,totalPages:status==='live'?2:1,serverNow:new Date().toISOString()});
 await page.route('**/api/catalog/auctions?**',async route=>{
  const url=new URL(route.request().url());if(summary(url.href)){await route.fulfill({json:{totalLive:12,totalUpcoming:2,serverNow:at}});return}if(!quick(url.href)){await route.continue();return}
  const status=url.searchParams.get('status')==='upcoming'?'upcoming':'live',pageNumber=Number(url.searchParams.get('page')??1);
  if(status==='live'&&pageNumber===1&&!liveReleased)await pendingLive;if(status==='live'&&pageNumber===1)previewDeadline??=new Date(Date.now()+6000).toISOString();
  if(status==='upcoming'&&++upcomingReads===2){await pendingRefresh;await route.fulfill({status:503,json:{error:'Synthetic refresh interruption'}});return}
  await route.fulfill({json:data(status,pageNumber)});
 });
 await page.route('**/api/catalog/auctions/qa-live-1',async route=>{detailReads++;await pendingHydration;await route.fulfill({status:503,json:{error:'Synthetic gated details'}})});await page.route('**/api/auctions/qa-live-1/bids',async route=>{ownReads++;await pendingHydration;await route.fulfill({status:503,json:{error:'Synthetic gated own state'}})});
 try{
  await launchHome(page);await expect(page.locator('[data-live-auction-indicator]')).toHaveText('12');
  const dialog=await open(page);await expect(page.locator('.customer-loading,.loading-spinner')).toHaveCount(0);await expect(dialog.getByRole('tab')).toHaveCount(2);await expect(rows(dialog)).toHaveCount(0);
  await dialog.getByRole('tab').nth(1).click();await expect(rows(dialog)).toHaveCount(2);await expect(rows(dialog).first()).toHaveAttribute('data-auction-status','upcoming');expect(await rows(dialog).evaluateAll(elements=>elements.every(element=>element.tagName==='ARTICLE'))).toBe(true);await expect(rows(dialog).locator('a,button')).toHaveCount(0);const initialUrl=page.url();await rows(dialog).first().click();await expect(page.getByRole('dialog',{name:'Place your bid',exact:true})).toHaveCount(0);expect(page.url()).toBe(initialUrl);const lateLive=page.waitForResponse(response=>quick(response.url())&&new URL(response.url()).searchParams.get('status')==='live');releaseLive();await (await lateLive).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await expect(dialog.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');await expect(rows(dialog).first()).toHaveAttribute('data-auction-status','upcoming');
  const refresh=dialog.getByRole('button',{name:/Refresh auctions|ጨረታዎችን አድስ/});await refresh.click();await expect.poll(()=>upcomingReads).toBe(2);await expect(rows(dialog)).toHaveCount(2);await expect(page.locator('.customer-loading,.loading-spinner')).toHaveCount(0);releaseRefresh();await expect(dialog.getByRole('status').filter({hasText:'Showing saved auctions. Refresh failed.'})).toBeVisible();await expect(rows(dialog)).toHaveCount(2);await dialog.getByRole('button',{name:/^(Retry|እንደገና ይሞክሩ)$/}).click();await expect.poll(()=>upcomingReads).toBe(3);await expect(dialog.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
  await dialog.getByRole('tab').nth(0).click();await expect(rows(dialog)).toHaveCount(10);const selected=rows(dialog).first(),urlBeforeBid=page.url();await selected.click();const child=page.getByRole('dialog',{name:'Place your bid',exact:true});await expect(child).toBeVisible();await expect(child.locator('[data-sheet-preview=quick]')).toBeVisible();await expect(child.locator('[data-sheet-public-details-ready=false]')).toBeVisible();await expect(child).toContainText('QA live fixture 1');await expect(child).toContainText('10.00');await expect(child.locator('[data-payment-action]')).toBeDisabled();await expect(page.locator('.customer-loading,.loading-spinner')).toHaveCount(0);await expect.poll(()=>detailReads).toBe(1);await expect.poll(()=>ownReads).toBe(1);await expect(child.getByRole('timer').filter({hasText:'Auction ended'})).toBeVisible({timeout:12000});await expect(child.locator('[data-payment-action]')).toBeDisabled();expect(page.url()).toBe(urlBeforeBid);await page.keyboard.press('Escape');await expect(child).toHaveCount(0);await expect(selected).toBeFocused();releaseHydration();const more=dialog.getByRole('button',{name:/Show more auctions|Load more|ተጨማሪ/});await more.click();await expect(rows(dialog)).toHaveCount(12);const codes=await rows(dialog).evaluateAll(elements=>elements.map(element=>element.getAttribute('data-auction-code')));expect(new Set(codes).size).toBe(12);
  await rows(dialog).last().scrollIntoViewIfNeeded();const viewport=dialog.getByRole('tabpanel'),savedScrollTop=await viewport.evaluate(element=>element.scrollTop);expect(savedScrollTop).toBeGreaterThan(0);const before=state.requests.length;await close(page,dialog,'escape');await open(page);await expect(rows(dialog)).toHaveCount(12);await expect.poll(async()=>Math.abs((await viewport.evaluate(element=>element.scrollTop))-savedScrollTop)).toBeLessThanOrEqual(1);expect(state.requests.length).toBe(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await viewport.evaluate(element=>{element.scrollTop=0});await page.evaluate(async()=>{await document.fonts.ready});await page.screenshot({animations:'disabled',path:`${root()}/auction-browser-live-${info.project.name}-en.png`});await close(page,dialog,'button');await setAmharic(page);await open(page);await expect(rows(dialog).first()).toContainText('የሙከራ');await page.screenshot({animations:'disabled',path:`${root()}/auction-browser-live-${info.project.name}-am.png`});await dialog.getByRole('tab').nth(1).click();await expect(rows(dialog)).toHaveCount(2);await page.screenshot({animations:'disabled',path:`${root()}/auction-browser-upcoming-${info.project.name}-am.png`});await close(page,dialog,'telegram');
  expect(refreshFailure).toBe(true);expect(state.financialPosts).toEqual([]);expect(state.privateBreakdowns).toEqual([]);expect(state.errors).toEqual([]);
  report(`auction-browser-nested-controlled-${info.project.name}`,{fixture:'synthetic GET-only delayed catalog responses; fresh guarded verified local contact/account; no financial fixture writes',timingClaims:false,reason:'Parallel local QA; prior isolated observations remain separate',width:info.project.use.viewport!.width,structureBeforeData:true,upcomingReadOnly:true,knownBidPreviewBeforeDetails:true,detailReads,ownReads,deadlineWhileGatedDisabled:true,lateLiveDidNotReplaceUpcoming:true,refreshRetainedRows:true,refreshFailureRetry:true,uniqueLoadedRows:codes.length,paginationRestored:true,savedAndRestoredScrollTop:savedScrollTop,reopenExtraRequests:state.requests.length-before,financialPosts:0,privateBreakdownRequests:0,errors:state.errors});
 }finally{releaseLive();releaseRefresh();releaseHydration()}
});
