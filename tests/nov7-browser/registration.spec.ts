import {test,expect,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
type ConsentState={callbacks:Array<(shared:boolean)=>void>;closes:number};
type ConsentWindow=Window&{__consentFixture:ConsentState};
async function registrationFixture(page:Page,{supported=true,holdAuthentication=false,registered=false}:{supported?:boolean;holdAuthentication?:boolean;registered?:boolean}={}){
 const calls={contactChecks:0,botPrompts:0,me:0,privateReads:0};
 let verified=false;const account={sessionKey:'fixture-session',user:{id:'registered-fixture',name:'Registered fixture'}};
 let release!:()=>void;const authenticated=new Promise<void>(resolve=>{release=resolve});
 await page.route('https://telegram.org/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await page.route('**/api/auth/telegram/miniapp/signin',async route=>{if(holdAuthentication)await authenticated;await route.fulfill({json:registered?{status:'authenticated',me:{sessionKey:'fixture-session',user:{id:'registered-fixture',name:'Registered fixture'}}}:{status:'contact-required',me:null}})});
 await page.route('**/api/onboarding/contact',route=>{
  if(route.request().method()==='POST'){calls.botPrompts++;return route.fulfill({status:410,json:{code:'NATIVE_CONTACT_REQUIRED'}})}
  calls.contactChecks++;return route.fulfill({json:{verified,masked:verified?'•••• 1234':null}});
 });
 await page.route('**/api/me',route=>{calls.me++;return verified||registered?route.fulfill({json:account}):route.fulfill({status:401,json:{error:'Contact not verified by server'}})});
 for(const path of ['/api/wallet','/api/profile','/api/my-bids','/api/alerts'])await page.route(`**${path}*`,route=>{calls.privateReads++;if(verified||registered){if(path==='/api/wallet')return route.fulfill({json:{available:'25.00',held:'0',total:'25.00'}});if(path==='/api/alerts'&&new URL(route.request().url()).searchParams.get('summary')==='1')return route.fulfill({json:{unread:0}})}return route.fulfill({status:401,json:{error:'Private fixture'}})});
 await page.addInitScript(({supported})=>{
  localStorage.setItem('lowwin:introduction:v1','dismissed');localStorage.setItem('lowwin-language','en');
  const state:ConsentState={callbacks:[],closes:0};(window as unknown as ConsentWindow).__consentFixture=state;
  window.Telegram={WebApp:{initData:'explicit-consent-fixture',ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},isVersionAtLeast(){return supported},requestContact:supported?(callback=>{state.callbacks.push(callback)}):undefined,close(){state.closes++}}};
 },{supported});
 return {calls,release,confirmServerContact:()=>{verified=true}};
}
const callbacks=(page:Page)=>page.evaluate(()=>(window as unknown as ConsentWindow).__consentFixture.callbacks.length);
async function respond(page:Page,index:number,shared:boolean){await page.evaluate(({index,shared})=>(window as unknown as ConsentWindow).__consentFixture.callbacks[index](shared),{index,shared})}

test('public Home renders during private bootstrap; contact consent is explicit and cancellation preserves browsing',async({page})=>{
 const state=await registrationFixture(page,{holdAuthentication:true});
 try{
  await page.goto('/');await expect(page.locator('#discover-auctions')).toBeVisible();
  const header=page.getByRole('banner');await expect(header.getByRole('status',{name:'Restoring account',exact:true})).toBeVisible();
  expect(state.calls.privateReads).toBe(0);expect(await callbacks(page)).toBe(0);
  state.release();const login=header.getByRole('button',{name:'Log in',exact:true});await expect(login).toBeVisible();
  await login.click();const sheet=page.getByRole('dialog',{name:'Log in to Lowwin'});await expect(sheet).toBeVisible();expect(await callbacks(page)).toBe(0);
  const share=sheet.getByRole('button',{name:'Share contact',exact:true});await expect(share).toBeEnabled();expect(state.calls.contactChecks).toBe(0);
  await share.click();expect(await callbacks(page)).toBe(1);await respond(page,0,false);
  await expect(sheet.getByRole('status')).toContainText('cancelled');expect(state.calls.contactChecks).toBe(0);expect(state.calls.botPrompts).toBe(0);
  await sheet.getByRole('button',{name:'Keep browsing',exact:true}).click();await expect(sheet).toHaveCount(0);await expect(page.locator('#discover-auctions')).toBeVisible();
  await respond(page,0,true);expect(state.calls.contactChecks).toBe(0);expect(await page.evaluate(()=>(window as unknown as ConsentWindow).__consentFixture.closes)).toBe(0);
  await login.click();await expect(share).toBeEnabled();expect(await callbacks(page)).toBe(1);await sheet.getByRole('button',{name:'Close',exact:true}).click();
 }finally{state.release()}
});
test('native approval alone cannot register; polling is bounded and dismissed callbacks cannot leak into another session',async({page})=>{
 const state=await registrationFixture(page);await page.goto('/');await page.getByRole('banner').getByRole('button',{name:'Log in',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Log in to Lowwin'});await sheet.getByRole('button',{name:'Share contact',exact:true}).click();await respond(page,0,true);
 await expect.poll(()=>state.calls.contactChecks).toBeGreaterThan(0);await expect(sheet.getByRole('button',{name:'Confirming your contact',exact:true})).toBeDisabled();expect(state.calls.me).toBe(0);
 await expect(sheet.getByRole('alert')).toContainText('Telegram has not confirmed your contact yet',{timeout:35000});expect(state.calls.contactChecks).toBe(15);expect(state.calls.me).toBe(0);
 await sheet.getByRole('button',{name:'Close',exact:true}).click();const count=state.calls.contactChecks;await respond(page,0,true);await page.waitForTimeout(1800);expect(state.calls.contactChecks).toBe(count);expect(state.calls.me).toBe(0);expect(state.calls.privateReads).toBe(0);
});
test('only server-confirmed contact refreshes the bound account in place and retains the public page',async({page})=>{
 const state=await registrationFixture(page);await page.goto('/');await expect(page.locator('#discover-auctions')).toBeVisible();
 await page.getByRole('banner').getByRole('button',{name:'Log in',exact:true}).click();const sheet=page.getByRole('dialog',{name:'Log in to Lowwin'});
 await sheet.getByRole('button',{name:'Share contact',exact:true}).click();await respond(page,0,true);await expect.poll(()=>state.calls.contactChecks).toBeGreaterThan(0);expect(state.calls.me).toBe(0);
 state.confirmServerContact();await expect(sheet).toHaveCount(0);await expect(page.locator('[data-header-balance]')).toContainText('25.00');await expect(page.locator('#discover-auctions')).toBeVisible();expect(state.calls.me).toBe(1);expect(state.calls.botPrompts).toBe(0);
 expect(await page.evaluate(()=>(window as unknown as ConsentWindow).__consentFixture.closes)).toBe(0);
});
test('unsupported Telegram clients have a usable fallback without a forced close or prompt loop',async({page})=>{
 const state=await registrationFixture(page,{supported:false});await page.goto('/');await page.getByRole('banner').getByRole('button',{name:'Log in',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Log in to Lowwin'});await sheet.getByRole('button',{name:'Share contact',exact:true}).click();
 await expect(sheet.getByRole('status')).toContainText('Update Telegram');await expect(sheet.getByRole('link',{name:'Open in Telegram',exact:true})).toHaveAttribute('href',/https:\/\/t\.me\//);
 expect(await callbacks(page)).toBe(0);expect(state.calls.contactChecks).toBe(0);expect(state.calls.botPrompts).toBe(0);await sheet.getByRole('button',{name:'Keep browsing',exact:true}).click();expect(await page.evaluate(()=>(window as unknown as ConsentWindow).__consentFixture.closes)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('registered visitors regain their signed account without another contact request',async({page})=>{
 const state=await registrationFixture(page,{registered:true});await page.goto('/how-it-works');await expect(page.locator('[data-customer-page-header] h1')).toHaveText('How it works');
 await page.waitForTimeout(300);expect(await callbacks(page)).toBe(0);expect(state.calls.contactChecks).toBe(0);expect(state.calls.botPrompts).toBe(0);await expect(page.getByRole('dialog',{name:'Log in to Lowwin'})).toHaveCount(0);
});

test('guest bid selections survive native-contact login without an automatic quote or charge',async({page})=>{
 const db=new PrismaClient(),telegramId=randomInt(6300000000,6390000000),auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),title='Guest draft '+randomUUID().slice(0,8);let financialWrites=0;
 try{
  await db.product.update({where:{id:auction.productId!},data:{title,titleAm:title,images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic guest draft',sourceType:'ORIGINAL'}}}});
  await page.setExtraHTTPHeaders({'x-forwarded-for':`198.19.${Math.floor(telegramId%65536/256)}.${telegramId%256}`});await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({launch})=>{
   localStorage.setItem('lowwin:introduction:v1','dismissed');localStorage.setItem('lowwin-language','en');const state:ConsentState={callbacks:[],closes:0};(window as unknown as ConsentWindow).__consentFixture=state;
   window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},isVersionAtLeast(){return true},requestContact(callback){state.callbacks.push(callback)},close(){state.closes++}}};
  },{launch:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Guest draft fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.route('**/api/payments/chapa/**',route=>{if(route.request().method()==='POST'){financialWrites++;return route.abort()}return route.continue()});
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:'25.00',held:'0',total:'25.00'}}));
  await page.goto('/?q='+encodeURIComponent(title));const card=page.locator('.auction-card').filter({hasText:title});await expect(card).toBeVisible();await card.getByRole('button').click();const bid=page.getByRole('dialog',{name:/Place your bid/}),input=bid.getByRole('textbox',{name:'Your bid amount',exact:true});
  await input.fill('2.00');await bid.getByRole('button',{name:'Add bid amount',exact:true}).click();await input.fill('3.00');const pay=bid.locator('[data-bid-continue]');await expect(pay).toHaveText('Pay with Chapa');await pay.click();const registration=page.getByRole('dialog',{name:'Log in to Lowwin'});await expect(registration).toBeVisible();expect(await callbacks(page)).toBe(0);expect(financialWrites).toBe(0);
  await registration.getByRole('button',{name:'Share contact',exact:true}).click();expect(await callbacks(page)).toBe(1);
  // Simulate the authenticated bot webhook's committed own-contact proof. The
  // browser still completes through the real bound GET/contact + GET/me APIs.
  await verifyFixtureContact(db,telegramId);await respond(page,0,true);await expect(registration).toHaveCount(0);await expect(page.locator('[data-header-balance]')).toContainText('25.00');
  await expect(bid.getByRole('button',{name:'Edit 2.00',exact:true})).toBeVisible();await expect(input).toHaveValue('3.00');await expect(bid.getByRole('button',{name:'Edit 3.00',exact:true})).toHaveCount(0);await expect(bid.locator('[data-bid-total]')).toContainText('20.00');await expect(pay).toHaveText('Pay with Chapa');await expect(bid.locator('[data-hosted-checkout-status]')).toHaveCount(0);expect(financialWrites).toBe(0);
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});expect(await db.bid.count({where:{userId:user.id}})).toBe(0);expect(await db.chapaCheckout.count({where:{userId:user.id}})).toBe(0);expect(await callbacks(page)).toBe(1);
 }finally{await db.product.update({where:{id:auction.productId!},data:{visible:false}});await db.$disconnect()}
});
