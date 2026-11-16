import {expect,test,type Locator,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';
import {verifyFixtureContact} from '../contact-fixtures';

const clients:PrismaClient[]=[];
test.afterEach(async()=>{await Promise.all(clients.splice(0).map(client=>client.$disconnect()))});

const now=()=>new Date().toISOString();
const fixtureTitle='Rugga’s 45W 20,000mAh power bank';
const fixtureTitleAm='የሩጋ 45W 20,000mAh ፓወር ባንክ';
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}
async function setup(page:Page,am:boolean){
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback test database required');
 const db=new PrismaClient({datasourceUrl:database});clients.push(db);const tid=randomInt(8000000000,8900000000);await verifyFixtureContact(db,tid);
 const user=await db.user.findUniqueOrThrow({where:{telegramId:String(tid)}}),token=randomBytes(32).toString('hex');
 await db.session.create({data:{id:randomUUID(),token,userId:user.id,expiresAt:new Date(Date.now()+86400000),telegramLaunchId:String(tid),telegramAuthSource:'TELEGRAM_OIDC'}});
 await page.context().addCookies([{name:'__Secure-better-auth.session_token',value:encodeURIComponent(token+'.'+await makeSignature(token,process.env.BETTER_AUTH_SECRET!)),domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
 const gates=new Map(['/api/my-bids','/api/results/winners','/api/profile'].map(path=>[path,deferred()]));
 const reads:string[]=[],writes:unknown[]=[],financial:string[]=[],errors:string[]=[];let unread=true;
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(language=>{
  localStorage.setItem('lowwin-language',language);localStorage.setItem('lowwin:introduction:v1','dismissed');
  window.Telegram={WebApp:{initData:'',platform:'unknown',ready(){}}};
 },am?'am':'en');
 await page.context().addCookies([{name:'lowwin-language',value:am?'am':'en',domain:'localhost',path:'/'}]);
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('https://api.chapa.global/**',route=>route.abort());
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;reads.push(path+url.search);
  if(request.method()!=='GET'&&request.method()!=='HEAD'){
   if(path==='/api/alerts'){writes.push(request.postDataJSON());unread=false;return route.fulfill({json:{ok:true}})}
   financial.push(path);return route.abort();
  }
  if(gates.has(path))await gates.get(path)!.promise;
  let body:unknown={};
  if(path==='/api/me')body={user:{id:user.id,name:'Layout fixture'},sessionKey:'fixture-only'};
  if(path==='/api/wallet')body={available:'125.50',cashAvailable:'125.50',bonusAvailable:'0.00',held:'0.00',demo:true};
  if(path==='/api/my-bids')body={items:[0,1].map(index=>({auction:{code:String(900+index),slug:'layout-product-'+index,status:'LIVE',ruleVersion:'lowest-unique-v4',title:fixtureTitle,titleAm:fixtureTitleAm,image:{path:'/images/lowwin-demo-headphones.webp',alt:'Fixture product'},startsAt:now(),endsAt:new Date(Date.now()+2*86400000).toISOString(),isDemo:false},outcome:'LIVE',bidCount:2,hasMoreBids:false,nextBidCursor:null,bids:[0,1].map(number=>({id:'layout-bid-'+index+'-'+number,amount:(9+index+number/10).toFixed(2),acceptedAt:now(),outcome:'LIVE'}))})),page:1,pageSize:10,hasNext:false,serverNow:now()};
  if(path==='/api/results/winners'||path==='/api/results/recent-winners')body={items:[],page:1,total:0,totalPages:0,serverNow:now(),allowDemo:false};
  if(path==='/api/profile')body={displayName:'Layout fixture',bio:'',counts:{bids:4,liveBids:4,historyBids:0,wins:0,favorites:0},phoneDisplay:'2519*****123',contactVerified:true,contactEmail:'',city:'',contactDetailsEditable:false,referral:{configured:false,enabled:false,shareUrl:null,discountPercent:null,expiryDays:null,counts:{signedUp:0,qualified:0,earned:0,available:0},coupons:[]}};
  if(path==='/api/alerts')body=url.searchParams.has('summary')?{unread:unread?2:0}:{items:[{id:'fixture-deposit',kind:'DEPOSIT_CREDITED',title:'ገንዘቡ ገብቷል',body:'100.00 ETB ወደ ዋሌትዎ ገብቷል።',href:'/profile',readAt:unread?null:now(),createdAt:now()},{id:'fixture-auction',kind:'AUCTION_ENDING_3_DAYS',title:'3 ቀናት ቀርተዋል',body:'የሩጋ ፓወር ባንክ ጨረታ።',href:'/my-bids',readAt:unread?null:now(),createdAt:now()}],unread:unread?2:0,total:2,page:1,totalPages:1,categories:['all','draws','payments']};
  if(path==='/api/catalog/auctions')body=url.searchParams.get('view')==='summary'?{totalLive:0,totalUpcoming:0,serverNow:now()}:{items:[],page:1,total:0,totalPages:0,pageSize:10,serverNow:now()};
  if(path==='/api/catalog/categories')body=[];
  if(path==='/api/catalog/activity')body={items:[],serverNow:now()};
  return route.fulfill({json:body});
 });
 return {reads,writes,financial,errors,release(path:string){gates.get(path)?.release()}};
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
async function width(node:Locator){return node.evaluate(element=>element.getBoundingClientRect().width)}
async function pageWidth(page:Page,node:Locator,desktop:boolean){
 const header=page.locator('[data-customer-page-header]');await expect(header).toBeVisible();
 if(desktop){expect(await width(header)).toBeCloseTo(860,0);expect(await width(node)).toBeGreaterThan(800);expect(await width(node)).toBeLessThanOrEqual(861)}
 else expect(await width(node)).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width,480)+1);
 await noOverflow(page);
}

for(const am of [false,true])test(`responsive account pages and loading placeholders ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await setup(page,am),desktop=page.viewportSize()!.width>=1024;
 for(const [path,api,variant] of [['/my-bids','/api/my-bids','bids'],['/winners','/api/results/winners','winners'],['/profile','/api/profile','profile']] as const){
  await page.goto(path);await expect(page.locator('.app-frame')).toHaveAttribute('data-app-layout','browser');
  await expect.poll(()=>f.reads.some(read=>read.startsWith(api))).toBe(true);
  const skeleton=variant==='bids'?page.locator('section:has([data-my-bids-tabs])'):page.locator(`[data-route-skeleton=${variant}]`).last();
  await expect(skeleton).toBeVisible();await pageWidth(page,skeleton,desktop);
  if(variant==='winners')expect(await skeleton.locator('[data-skeleton-part=winner-grid]').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(desktop?2:1);
  await page.screenshot({path:info.outputPath(`${variant}-loading-${am?'am':'en'}.png`),fullPage:true,animations:'disabled'});
  f.release(api);
  if(variant==='bids'){
   const list=page.locator('[data-my-bids-list]');await expect(list).toBeVisible();expect(await list.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(desktop?2:1);
   await expect(list.locator('[data-bid-auction]')).toHaveCount(2);await expect(list.locator('[data-bid-id]')).toHaveCount(4);await expect(list.locator('[data-bid-thumbnail]')).toHaveCount(2);
   if(desktop){await expect(list.locator('[data-outcome]').first()).toHaveCSS('font-size','13px');await expect(list.locator('[data-bid-auction]').first().getByRole('button').getByText(am?fixtureTitleAm:fixtureTitle,{exact:true})).toHaveCSS('font-size','15px')}
  }else if(variant==='profile'){const profile=page.locator('[data-profile-ready=true]');await expect(profile).toBeVisible();await pageWidth(page,profile,desktop)}
  else await expect(page.locator('[data-winners-ready=true]')).toBeVisible();
  await noOverflow(page);await page.screenshot({path:info.outputPath(`${variant}-ready-${am?'am':'en'}.png`),fullPage:true,animations:'disabled'});
 }
 // Notifications retain the current authenticated Home sheet route and actions.
 await page.goto('/profile/alerts');const dialog=page.getByRole('dialog').filter({has:page.locator('[data-notifications-inbox]')});await expect(dialog).toBeVisible();
 const inbox=dialog.locator('[data-notifications-inbox]');await expect(inbox.locator('[data-notification-row]')).toHaveCount(2);
 await inbox.locator('[data-notification-filter=payments]').click();await expect.poll(()=>f.reads.some(read=>read.includes('/api/alerts?category=payments'))).toBe(true);
 const mark=inbox.locator('[data-notifications-mark-all]');await mark.focus();await expect(mark).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(mark).toBeFocused();
 expect(await mark.evaluate(element=>{const token=document.createElement('span');token.style.color='var(--action-primary)';element.append(token);const matches=getComputedStyle(element).outlineColor===getComputedStyle(token).color;token.remove();return matches})).toBe(true);await mark.click();await expect.poll(()=>f.writes.length).toBe(1);expect(f.writes[0]).toEqual({action:'read'});await expect(mark).toBeDisabled();
 await noOverflow(page);await dialog.screenshot({path:info.outputPath(`notifications-${am?'am':'en'}.png`),animations:'disabled'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 const retired=await page.goto('/auctions/all');expect(retired?.status()).toBe(404);expect(new URL(page.url()).pathname).toBe('/auctions/all');
 expect(f.financial).toEqual([]);expect(f.errors).toEqual([]);
});
