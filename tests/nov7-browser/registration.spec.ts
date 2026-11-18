import {test,expect,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

type ConsentState={callbacks:Array<(shared:boolean)=>void>;closes:number};
type ConsentWindow=Window&{__consentFixture:ConsentState};
const fixtureLaunch='signed-consent-fixture';

async function installContactSdk(page:Page,launch:string,{supported=true,dismissedIntro=true}={}){
 await page.route('https://telegram.org/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await page.addInitScript(({launch,supported,dismissedIntro})=>{
  if(dismissedIntro)localStorage.setItem('lowwin:mini-introduction:v2','dismissed');
  localStorage.setItem('lowwin-language','en');
  const state:ConsentState={callbacks:[],closes:0};
  (window as unknown as ConsentWindow).__consentFixture=state;
  window.Telegram={WebApp:{
   initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},isVersionAtLeast(){return supported},
   requestContact:supported?(callback=>{state.callbacks.push(callback)}):undefined,close(){state.closes++},
  }};
 },{launch,supported,dismissedIntro});
}

async function registrationFixture(page:Page,{supported=true,holdAuthentication=false,registered=false,dismissedIntro=true}={}){
 const calls={signIns:0,contactChecks:0,me:0,privateReads:0};
 let verified=false;
 const account={sessionKey:'fixture-session',user:{id:'registered-fixture',name:'Registered fixture'}};
 let release!:()=>void;
 const authenticationReady=new Promise<void>(resolve=>{release=resolve});
 await installContactSdk(page,fixtureLaunch,{supported,dismissedIntro});
 await page.route('**/api/auth/telegram/miniapp/signin',async route=>{
  calls.signIns++;
  if(holdAuthentication)await authenticationReady;
  const json=registered||verified?{status:'authenticated',me:account}:{status:'contact-required',me:null};
  await route.fulfill({json});
 });
 await page.route('**/api/onboarding/contact',route=>{
  expect(route.request().method()).toBe('POST');
  expect(route.request().postDataJSON()).toEqual({initData:fixtureLaunch});
  calls.contactChecks++;
  return route.fulfill({json:{verified,masked:null}});
 });
 await page.route('**/api/me',route=>{
  calls.me++;
  return verified||registered?route.fulfill({json:account}):route.fulfill({status:401,json:{error:'Contact not verified by server'}});
 });
 for(const path of ['/api/wallet','/api/profile','/api/my-bids','/api/alerts'])await page.route(`**${path}*`,route=>{
  calls.privateReads++;
  if(verified||registered){
   if(path==='/api/wallet')return route.fulfill({json:{available:'25.00',held:'0',total:'25.00'}});
   if(path==='/api/alerts')return route.fulfill({json:{unread:0,items:[]}});
  }
  return route.fulfill({status:401,json:{error:'Private fixture'}});
 });
 return {calls,release,confirmServerContact:()=>{verified=true}};
}

const contactHeading=(page:Page)=>page.getByRole('heading',{name:'Share your Telegram contact',exact:true});
const shareButton=(page:Page)=>page.getByRole('button',{name:'Share contact',exact:true});
const callbacks=(page:Page)=>page.evaluate(()=>(window as unknown as ConsentWindow).__consentFixture.callbacks.length);
const closes=(page:Page)=>page.evaluate(()=>(window as unknown as ConsentWindow).__consentFixture.closes);
async function respond(page:Page,index:number,shared:boolean){
 await page.evaluate(({index,shared})=>(window as unknown as ConsentWindow).__consentFixture.callbacks[index](shared),{index,shared});
}

test('launch is gated and contact appears once before any walkthrough',async({page})=>{
 const state=await registrationFixture(page,{holdAuthentication:true,dismissedIntro:false});
 try{
  await page.goto('/telegram');
  await expect.poll(()=>state.calls.signIns).toBe(1);
  await expect(page.locator('#discover-auctions')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/log in|continue with telegram/i})).toHaveCount(0);
  expect(state.calls.privateReads).toBe(0);
  expect(await callbacks(page)).toBe(0);

  state.release();
  await expect(contactHeading(page)).toBeVisible();
  await expect.poll(()=>callbacks(page)).toBe(1);
  expect(state.calls.contactChecks).toBe(0);
  await respond(page,0,false);
  await expect(page.getByRole('status')).toContainText('Contact sharing was cancelled');
  await expect(page.locator('#discover-auctions')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Keep browsing',exact:true})).toHaveCount(0);
  await expect(shareButton(page)).toBeEnabled();
  expect(await callbacks(page)).toBe(1);
  expect(await closes(page)).toBe(0);

  await shareButton(page).click();
  await expect.poll(()=>callbacks(page)).toBe(2);
  await respond(page,0,true);
  await respond(page,1,false);
  await expect(shareButton(page)).toBeEnabled();
  expect(state.calls.contactChecks).toBe(0);
  expect(state.calls.signIns).toBe(1);
 }finally{state.release()}
});

test('native approval alone cannot unlock the app and a timed-out check can be retried',async({page})=>{
 const state=await registrationFixture(page);
 await page.goto('/telegram');
 await expect.poll(()=>callbacks(page)).toBe(1);
 await respond(page,0,true);
 await expect.poll(()=>state.calls.contactChecks).toBeGreaterThan(0);
 await expect(page.getByRole('button',{name:'Confirming your contact',exact:true})).toBeDisabled();
 await expect(page.getByRole('main').getByRole('alert')).toContainText('Telegram has not confirmed your contact yet',{timeout:35000});
 expect(state.calls.contactChecks).toBe(15);
 expect(state.calls.signIns).toBe(1);
 expect(state.calls.me).toBe(0);
 expect(state.calls.privateReads).toBe(0);
 await expect(page.locator('#discover-auctions')).toHaveCount(0);

 await shareButton(page).click();
 await expect.poll(()=>callbacks(page)).toBe(2);
 state.confirmServerContact();
 await respond(page,1,true);
 await expect(page.locator('#discover-auctions')).toBeVisible();
 expect(state.calls.signIns).toBe(2);
 expect(state.calls.me).toBe(0);
});

test('server-approved contact opens Lowwin automatically with a fresh signed session',async({page})=>{
 const state=await registrationFixture(page);
 await page.goto('/telegram');
 await expect(contactHeading(page)).toBeVisible();
 await expect.poll(()=>callbacks(page)).toBe(1);
 await respond(page,0,true);
 await expect.poll(()=>state.calls.contactChecks).toBeGreaterThan(0);
 expect(state.calls.signIns).toBe(1);
 expect(state.calls.me).toBe(0);
 expect(state.calls.privateReads).toBe(0);

 state.confirmServerContact();
 await expect(contactHeading(page)).toHaveCount(0);
 await expect(page.locator('[data-header-balance]')).toContainText('25.00');
 await expect(page.locator('#discover-auctions')).toBeVisible();
 expect(state.calls.signIns).toBe(2);
 expect(state.calls.me).toBe(0);
 expect(await closes(page)).toBe(0);
});

test('unsupported clients can return to Telegram while Lowwin stays gated',async({page})=>{
 const state=await registrationFixture(page,{supported:false});
 await page.goto('/telegram');
 await expect(contactHeading(page)).toBeVisible();
 await expect(page.getByRole('status')).toContainText('Update Telegram');
 await expect(page.getByRole('link',{name:'Open in Telegram',exact:true})).toHaveAttribute('href',/https:\/\/t\.me\//);
 await expect(page.locator('#discover-auctions')).toHaveCount(0);
 expect(await callbacks(page)).toBe(0);
 expect(state.calls.contactChecks).toBe(0);
 expect(await closes(page)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('registered visitors open Lowwin without another contact request',async({page})=>{
 const state=await registrationFixture(page,{registered:true});
 await page.goto('/telegram');
 await expect(page.locator('#discover-auctions')).toBeVisible();
 await expect(page.locator('[data-header-balance]')).toContainText('25.00');
 expect(state.calls.signIns).toBe(1);
 expect(await callbacks(page)).toBe(0);
 expect(state.calls.contactChecks).toBe(0);
 await expect(contactHeading(page)).toHaveCount(0);
});

test('a signed auction launch waits for real contact registration without starting a bid or charge',async({page})=>{
 const db=new PrismaClient();
 const telegramId=randomInt(6300000000,6390000000);
 const auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000});
 let financialWrites=0;
 try{
  const destination=`/auctions/${auction.publicCode}`;
  await page.setExtraHTTPHeaders({'x-forwarded-for':`198.19.${Math.floor(telegramId%65536/256)}.${telegramId%256}`});
  await installContactSdk(page,signedLaunch({
   user:JSON.stringify({id:telegramId,first_name:'Contact-first auction fixture'}),
   start_param:`auction_${auction.publicCode}`,
  },process.env.TELEGRAM_BOT_TOKEN));
  await page.route('**/api/payments/chapa/**',route=>{
   if(route.request().method()==='POST'){financialWrites++;return route.abort()}
   return route.fallback();
  });

  await page.goto('/telegram');
  await expect(contactHeading(page)).toBeVisible();
  await expect.poll(()=>callbacks(page)).toBe(1);
  await expect(page).toHaveURL(/\/telegram$/);
  await expect(page.locator('[data-auction-detail]')).toHaveCount(0);
  expect(await db.user.findUnique({where:{telegramId:String(telegramId)}})).toBeNull();
  expect(await db.account.findUnique({where:{providerId_accountId:{providerId:'telegram',accountId:String(telegramId)}}})).toBeNull();

  const checking=page.waitForResponse(response=>response.url().endsWith('/api/onboarding/contact')&&response.request().method()==='POST');
  await respond(page,0,true);
  const checkResponse=await checking;
  expect(await checkResponse.json()).toMatchObject({verified:false});
  expect(await db.user.findUnique({where:{telegramId:String(telegramId)}})).toBeNull();
  await expect(contactHeading(page)).toBeVisible();

  await verifyFixtureContact(db,telegramId);
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect(page.locator('[data-auction-detail]')).toBeVisible();
  await expect(contactHeading(page)).toHaveCount(0);
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
  expect(await db.bid.count({where:{userId:user.id}})).toBe(0);
  expect(await db.chapaCheckout.count({where:{userId:user.id}})).toBe(0);
  expect(financialWrites).toBe(0);
  expect(await callbacks(page)).toBe(1);
 }finally{
  await db.product.update({where:{id:auction.productId!},data:{visible:false}});
  await db.$disconnect();
 }
});
