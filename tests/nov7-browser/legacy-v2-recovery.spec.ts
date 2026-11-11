import {test,expect,type Locator,type Page} from '@playwright/test';
import {randomInt,randomUUID} from 'node:crypto';
import {fixture,pending,transaction} from '../chapa-browser/fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';

type Fixture=Awaited<ReturnType<typeof fixture>>;
const rawPhone='251911652904',privateCode='PRIVATE_PROVIDER_DIAGNOSTIC';
function legacyOrder(f:Fixture,authType:'OTP'|'USSD',purpose:'TOP_UP'|'BID'='TOP_UP'):ChapaCheckoutView{
 const id=randomUUID(),intent=purpose==='TOP_UP'?{key:id,purpose,amount:'10.00'}:{key:id,purpose,auctionSlug:f.auction.slug!,amount:'7.25',feeVersion:1};
 return Object.assign({...pending(intent,id),apiVersion:2 as const,chargeType:'DIRECT' as const,authType,authorizationReference:'CH-existing-'+id,merchantReference:'LW-existing-'+id,checkoutUrl:null,status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',reason:null,paymentMethod:authType==='OTP'?'mpesa':'telebirr',payerPhoneMasked:rawPhone,auctionTitle:purpose==='BID'?f.title:null,pollAfterMs:2000},{initializationErrorCode:privateCode,initializationHttpStatus:409});
}
function completed(order:ChapaCheckoutView):ChapaCheckoutView{return {...order,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',providerReasonCode:null,updatedAt:new Date().toISOString()}}
function cancelled(order:ChapaCheckoutView):ChapaCheckoutView{return {...order,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED',updatedAt:new Date().toISOString()}}
async function denyNewPayments(page:Page){
 const creations:string[]=[];
 await page.route('**/api/payments/chapa/direct**',route=>{creations.push(route.request().url());return route.fulfill({status:410,json:{error:'Legacy charge creation is retired.'}})});
 await page.route('**/api/payments/chapa/batches/**',route=>{creations.push(route.request().url());return route.fulfill({status:410,json:{error:'Historical recovery cannot create a batch.'}})});
 await page.route('**/api/payments/chapa/checkouts',route=>{if(route.request().method()==='POST')creations.push(route.request().url());return route.fulfill({status:410,json:{error:'Historical recovery must reuse its owned checkout.'}})});
 return creations;
}
async function openHistorical(page:Page,order:ChapaCheckoutView,am:boolean){
 await page.goto('/telegram?next='+encodeURIComponent('/payments'));
 await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');
 await page.locator(`[data-payment-id="${order.id}"]`).click();
 const dialog=page.getByRole('dialog',{name:am?'የግብይት ዝርዝር':'Transaction details',exact:true});
 await expect(dialog).toContainText(order.merchantReference!);await expect(dialog).toContainText('+251 ••• •• 2904');
 await expect(dialog).not.toContainText(rawPhone);await expect(dialog).not.toContainText(privateCode);
 return dialog;
}
async function continueOtp(dialog:Locator,am:boolean){
 await expect(dialog.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
 await dialog.getByRole('button',{name:am?'ፈቃዱን ይቀጥሉ':'Continue authorization',exact:true}).click();
 const otp=dialog.locator('input[autocomplete="one-time-code"]');await expect(otp).toBeVisible();await expect(otp).toHaveAttribute('type','password');
 await expect(dialog).not.toContainText(rawPhone);await expect(dialog).not.toContainText(privateCode);return otp;
}
async function unchangedDatabase(f:Fixture){expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0)}
async function cleanup(f:Fixture){await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}

// These records already existed before V1. Status and authorization stay bound
// to their owned ID; none of these tests initializes a direct or hosted charge.
for(const scenario of [
 {outcome:'confirmed',stale:'authorization'},
 {outcome:'confirmed',stale:'cancelled'},
 {outcome:'cancelled',stale:'authorization'},
] as const)test(`historical V2 OTP ${scenario.outcome} survives a delayed ${scenario.stale} snapshot`,async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),order=legacyOrder(f,'OTP'),creations=await denyNewPayments(page),authorizations:Array<{path:string;body:unknown}>=[];let checks=0,settled=false;
 let releaseRead=()=>{},releaseAuthorization=()=>{};const reading=new Promise<void>(resolve=>releaseRead=resolve),authorizing=new Promise<void>(resolve=>releaseAuthorization=resolve);
 try{
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:[transaction(order,settled?(scenario.outcome==='confirmed'?'done':'failed'):'checking',settled&&scenario.outcome==='confirmed'?'incoming':'none')],page:1,nextPage:null}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:settled&&scenario.outcome==='confirmed'?'35.00':'25.00',held:'0',currency:'ETB'}}));
  await page.route('**/api/payments/chapa/checkouts/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path.endsWith('/authorize')){authorizations.push({path,body:req.postDataJSON()});await authorizing;settled=true;return route.fulfill({json:scenario.outcome==='confirmed'?completed(order):cancelled(order)})}
   expect(path).toBe('/api/payments/chapa/checkouts/'+order.id);
   if(req.method()==='GET')return route.fulfill({json:order});
   checks++;const stale=scenario.stale==='cancelled'?cancelled(order):{...order};await reading;return route.fulfill({json:stale}).catch(()=>{});
  });
  const dialog=await openHistorical(page,order,am);await expect.poll(()=>checks).toBe(1);const otp=await continueOtp(dialog,am),confirm=dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm code',exact:true});
  expect(authorizations).toHaveLength(0);await otp.fill('123');await expect(confirm).toBeDisabled();await otp.fill('123456');await expect(confirm).toBeEnabled();
  await confirm.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});await expect.poll(()=>authorizations.length).toBe(1);await expect(confirm).toBeDisabled();await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');
  expect(authorizations[0]).toEqual({path:`/api/payments/chapa/checkouts/${order.id}/authorize`,body:{otp:'123456'}});releaseAuthorization();
  const state=dialog.locator(`[data-payment-state="${scenario.outcome==='confirmed'?'confirmed':'failed'}"]`);await expect(state).toBeVisible();await expect(otp).toHaveCount(0);releaseRead();await page.waitForTimeout(150);
  await expect(state).toBeVisible();await expect(dialog.locator('[data-direct-approval=otp],input[autocomplete="one-time-code"]')).toHaveCount(0);expect(authorizations).toHaveLength(1);expect(creations).toEqual([]);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
  await expect(page.locator('[data-transactions-balance]')).toContainText(scenario.outcome==='confirmed'?'35.00':'25.00');await unchangedDatabase(f);
 }finally{releaseRead();releaseAuthorization();await cleanup(f)}
});

test('historical V2 OTP errors stay private and each explicit code uses the same owned authorization',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),order=legacyOrder(f,'OTP'),creations=await denyNewPayments(page),authorizations:Array<{path:string;body:unknown}>=[];let settled=false;
 try{
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:[transaction(order,settled?'done':'checking',settled?'incoming':'none')],page:1,nextPage:null}}));
  await page.route('**/api/payments/chapa/checkouts/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path.endsWith('/authorize')){authorizations.push({path,body:req.postDataJSON()});if(authorizations.length===1)return route.fulfill({status:422,json:{code:'INVALID_OTP',error:privateCode+' '+rawPhone}});settled=true}
   else expect(path).toBe('/api/payments/chapa/checkouts/'+order.id);
   return route.fulfill({json:settled?completed(order):order});
  });
  const dialog=await openHistorical(page,order,am),otp=await continueOtp(dialog,am),confirm=dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm code',exact:true});await otp.fill('123456');await confirm.click();
  await expect(dialog.locator('[data-payment-reason]')).toContainText(am?'ኮዱ አልተቀበለም':'That code was not accepted');await expect(otp).toHaveValue('');await expect(dialog).not.toContainText(privateCode);await expect(dialog).not.toContainText(rawPhone);await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');expect(authorizations).toHaveLength(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(100);expect(authorizations).toHaveLength(1);await otp.fill('654321');await confirm.click();await expect(dialog.locator('[data-payment-state=confirmed]')).toBeVisible();
  expect(authorizations).toEqual([{path:`/api/payments/chapa/checkouts/${order.id}/authorize`,body:{otp:'123456'}},{path:`/api/payments/chapa/checkouts/${order.id}/authorize`,body:{otp:'654321'}}]);expect(creations).toEqual([]);await unchangedDatabase(f);
 }finally{await cleanup(f)}
});

test('historical V2 USSD PIN feedback is masked and verified cancellation stops automatic checks',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),order={...legacyOrder(f,'USSD'),providerReasonCode:'INVALID_PIN'},creations=await denyNewPayments(page);let checks=0,isCancelled=false,authorizations=0;
 try{
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:[transaction(order,isCancelled?'failed':'checking','none')],page:1,nextPage:null}}));
  await page.route('**/api/payments/chapa/checkouts/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;expect(path).toBe('/api/payments/chapa/checkouts/'+order.id);if(path.endsWith('/authorize'))authorizations++;if(req.method()==='POST')checks++;
   return route.fulfill({json:isCancelled?cancelled(order):order});
  });
  const dialog=await openHistorical(page,order,am);await expect(dialog).toContainText(am?'PIN ትክክል':'incorrect payment PIN');await expect(dialog.locator('input[type=password],input[autocomplete="one-time-code"]')).toHaveCount(0);await expect(dialog.getByRole('button',{name:am?'ፈቃዱን ይቀጥሉ':'Continue authorization',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true})).toBeEnabled();isCancelled=true;await dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true}).click();await expect(dialog.locator('[data-summary=failed]')).toBeVisible();await expect(dialog).toContainText(am?'ተሰርዟል':'cancelled');await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');
  const before=checks;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(2200);expect(checks).toBe(before);expect(authorizations).toBe(0);expect(creations).toEqual([]);await expect(dialog.locator('[data-summary=done],input[autocomplete="one-time-code"]')).toHaveCount(0);await unchangedDatabase(f);
 }finally{await cleanup(f)}
});

test('historical unavailable expired V2 bid keeps its reference and preserves late verified funds without accepted bids',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),order={...legacyOrder(f,'USSD','BID'),createdAt:new Date(Date.now()-301000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString(),verificationState:'UNAVAILABLE',reason:'PROVIDER_CONFIRMATION_REQUIRED'},creations=await denyNewPayments(page);let checks=0,phase:'unavailable'|'provider-success'|'preserved'='unavailable';
 try{
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:[transaction(order,phase==='preserved'?'done':'checking',phase==='preserved'?'incoming':'none')],page:1,nextPage:null}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:phase==='preserved'?'35.00':'25.00',held:'0',currency:'ETB'}}));
  await page.route('**/api/payments/chapa/checkouts/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;expect(path).toBe('/api/payments/chapa/checkouts/'+order.id);if(req.method()==='POST')checks++;
   return route.fulfill({json:phase==='preserved'?{...order,status:'NEEDS_REVIEW',providerStatus:'SUCCESS',verificationState:'VERIFIED',fundsPreserved:true,reason:'AUCTION_CLOSED',receipt:null}:phase==='provider-success'?{...order,status:'VERIFYING',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:order});
  });
  const dialog=await openHistorical(page,order,am);await expect(dialog.locator('[data-summary=checking]')).toBeVisible();await expect(dialog.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true})).toHaveCount(0);await expect(dialog.locator('input[type=password],input[autocomplete="one-time-code"]')).toHaveCount(0);await expect.poll(()=>checks).toBeGreaterThan(0);await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');
  phase='provider-success';await dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true}).click();await expect(dialog).toContainText(am?'ክፍያው ተረጋግጧል።':'Payment is verified.');await expect(dialog.locator('[data-summary=checking]')).toBeVisible();await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');
  phase='preserved';const before=checks;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.locator('[data-summary=done]')).toBeVisible();expect(checks).toBeGreaterThan(before);await expect(dialog).toContainText(am?'በዋሌት የተቀመጠ':'Saved to wallet');await expect(dialog).toContainText(am?'ጨረታው አልተቀበለም':'The bid was not accepted');await expect(dialog).toContainText(order.merchantReference!);await expect(page.locator('[data-transactions-balance]')).toContainText('35.00');
  await expect(dialog).not.toContainText(privateCode);await expect(dialog).not.toContainText(rawPhone);expect(creations).toEqual([]);await unchangedDatabase(f);
 }finally{await cleanup(f)}
});

test('a delayed historical V2 response cannot cross signed Telegram accounts or authorize a new payment',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),order=legacyOrder(f,'USSD'),secondId=randomInt(8900000000,8990000000),creations=await denyNewPayments(page);let second=false,reads=0,authorizations=0,release=()=>{};
 const reading=new Promise<void>(resolve=>release=resolve);await verifyFixtureContact(f.db,secondId);const secondUser=await f.db.user.findUniqueOrThrow({where:{telegramId:String(secondId)}});
 try{
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:second?[]:[transaction(order,'checking','none')],page:1,nextPage:null}}));
  await page.route('**/api/payments/chapa/checkouts/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;expect(path).toBe('/api/payments/chapa/checkouts/'+order.id);if(path.endsWith('/authorize'))authorizations++;if(req.method()==='POST')return route.fulfill({json:order});
   reads++;await reading;return route.fulfill({json:completed(order)}).catch(()=>{});
  });
  await page.goto('/telegram?next='+encodeURIComponent('/payments'));const nav=page.getByRole('navigation',{name:'Your navigation'});await page.locator(`[data-payment-id="${order.id}"]`).click();await expect.poll(()=>reads).toBe(1);await page.keyboard.press('Escape');second=true;
  const launch=signedLaunch({user:JSON.stringify({id:secondId,first_name:'Second legacy recovery account'})},process.env.TELEGRAM_BOT_TOKEN);await page.evaluate(launch=>{window.Telegram!.WebApp!.initData=launch},launch);
  const switched=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin'&&response.request().method()==='POST');await nav.getByRole('link',{name:am?'መነሻ':'Home',exact:true}).click();const account=await(await switched).json();expect(account.me.user.id).toBe(secondUser.id);release();
  await expect(page.locator('[data-header-balance]')).toContainText('25.00');await nav.getByRole('link',{name:am?'ግብይቶች':'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(0);await expect(page.locator('[data-transactions-page]')).not.toContainText(order.merchantReference!);await expect(page.locator('input[autocomplete="one-time-code"],[data-payment-progress]')).toHaveCount(0);await expect(page.locator('[data-transactions-balance]')).toContainText('25.00');expect(authorizations).toBe(0);expect(creations).toEqual([]);
 }finally{release();await cleanup(f)}
});
