import {test,expect} from '@playwright/test';
import {randomInt,randomUUID} from 'node:crypto';
import {inlineFixture,wakePayment} from '../checkout-v2-inline-browser/fixtures';
import {pending} from './fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import type {TransactionRow} from '../../src/lib/transactions';

function historyRow(order:ChapaCheckoutView):TransactionRow{
 return {id:order.id,source:'chapa',type:order.purpose,title:'Historical payment fixture',titleAm:null,amount:order.amount,direction:order.status==='CREDITED'?'incoming':'none',summary:order.status==='CREDITED'?'done':'checking',paymentMethod:order.paymentMethod??null,createdAt:order.createdAt,mode:'test'};
}

// A recorded Direct attempt remains observable. This test deliberately never
// calls a creation route: current Direct v5 initiation is covered by the shared checkout suite.
for(const historic of [{flowVersion:3,chargeType:'DIRECT' as const},{flowVersion:4,chargeType:'INLINE' as const}])test(`an owned historical ${historic.chargeType} v${historic.flowVersion} top-up survives closing details and confirms the same payment automatically`,async({page})=>{
 const f=await inlineFixture(page),id=randomUUID();let confirmed=false,checks=0,creates=0;
 await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 const original:ChapaCheckoutView={...pending({key:id,purpose:'TOP_UP',amount:'10.00'},id),apiVersion:'v2',flowVersion:historic.flowVersion,chargeType:historic.chargeType,checkoutUrl:null,amountCents:'1000',status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',authType:'USSD',authorizationReference:'CH-original-'+id,paymentMethod:'telebirr',merchantReference:'LW-historical-'+id,payerPhoneMasked:'251*****2904',pollAfterMs:1500};
 const current=():ChapaCheckoutView=>({...original,...(confirmed?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',reason:null}:{})});
 await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[historyRow(current())],page:1,nextPage:null}}));
 await page.route(/\/api\/payments\/chapa\/(?:direct(?:\/current)?|inline|checkouts)$/,route=>{if(route.request().method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{items:[current()],page:1,nextPage:null}})});
 await page.route('**/api/payments/chapa/checkouts/**',route=>{expect(new URL(route.request().url()).pathname).toBe('/api/payments/chapa/checkouts/'+id);if(route.request().method()==='POST')checks++;return route.fulfill({json:current()})});
 try{
  await page.goto('/payments');const row=page.locator('[data-payment-id]');await expect(row).toHaveCount(1);await expect(row).toHaveAttribute('data-payment-id',id);await row.click();let sheet=page.getByRole('dialog');
  await expect(sheet.locator('[data-transaction-detail]')).toBeVisible();await expect(sheet).toContainText(original.merchantReference!);await expect(sheet.locator('[data-summary="checking"]')).toBeVisible();await expect(sheet.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
  await sheet.getByRole('button',{name:'Close',exact:true}).last().click();await expect(page.getByRole('dialog')).toHaveCount(0);await row.click();sheet=page.getByRole('dialog');await expect(sheet).toContainText(original.merchantReference!);
  confirmed=true;await wakePayment(page);await expect(sheet.locator('[data-summary="done"]')).toBeVisible();await expect(sheet.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(checks).toBeGreaterThan(0);expect(creates).toBe(0);expect(f.commands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.cleanup()}
});

test('an old payment response cannot populate history after switching signed Telegram accounts',async({page})=>{
 const f=await inlineFixture(page),id=randomUUID(),order:ChapaCheckoutView={...pending({key:id,purpose:'TOP_UP',amount:'100.00'},id),apiVersion:'v2',flowVersion:3,chargeType:'HOSTED',merchantReference:'LW-owned-first-account'};
 await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 const secondId=randomInt(8900000000,8990000000);await verifyFixtureContact(f.db,secondId);const secondUser=await f.db.user.findUniqueOrThrow({where:{telegramId:String(secondId)}});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let second=false,ownedReads=0,creates=0;
 await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:second?[]:[historyRow(order)],page:1,nextPage:null}}));
 await page.route(/\/api\/payments\/chapa\/(?:direct(?:\/current)?|inline|checkouts)$/,route=>{if(route.request().method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{items:second?[]:[order],page:1,nextPage:null}})});
 await page.route('**/api/payments/chapa/checkouts/**',async route=>{expect(new URL(route.request().url()).pathname).toBe('/api/payments/chapa/checkouts/'+id);if(route.request().method()==='GET'){ownedReads++;await gate}return route.fulfill({json:order}).catch(()=>{})});
 try{
  await page.goto('/payments');await expect(page.locator('[data-payment-id]')).toHaveCount(1);await page.locator('[data-payment-id]').click();await expect.poll(()=>ownedReads).toBe(1);await page.keyboard.press('Escape');
  second=true;const launch=signedLaunch({user:JSON.stringify({id:secondId,first_name:'Second account fixture'})},process.env.TELEGRAM_BOT_TOKEN);
  await page.evaluate(launch=>{window.Telegram!.WebApp!.initData=launch},launch);const switched=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin'&&response.request().method()==='POST');await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'Home',exact:true}).click();const account=await(await switched).json();expect(account.me.user.id).toBe(secondUser.id);
  release();await expect(page.locator('[data-header-balance]')).toBeVisible();expect(new URL(page.url()).pathname).toBe('/');expect(new URL(page.url()).searchParams.has('login')).toBe(false);expect(new URL(page.url()).searchParams.has('next')).toBe(false);await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'Me',exact:true}).click();await page.getByRole('region',{name:'Your wallet',exact:true}).getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-transactions-page]')).toBeVisible();await expect(page.locator('[data-payment-id]')).toHaveCount(0);await expect(page.locator('[data-transactions-page]')).not.toContainText(order.merchantReference!);expect(creates).toBe(0);expect(f.commands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);expect(await f.db.chapaCheckout.count({where:{userId:{in:[f.user.id,secondUser.id]}}})).toBe(0);
 }finally{release();await f.cleanup()}
});

for(const historic of [{flowVersion:3,chargeType:'DIRECT' as const},{flowVersion:4,chargeType:'INLINE' as const}])test(`a recorded ${historic.chargeType} v${historic.flowVersion} OTP authorizes only its original checkout without starting a new payment`,async({page})=>{
 const f=await inlineFixture(page),id=randomUUID();let complete=false,creates=0;const authorizations:Array<{otp:string}>=[];
 await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 const original:ChapaCheckoutView={...pending({key:id,purpose:'TOP_UP',amount:'10.00'},id),apiVersion:'v2',flowVersion:historic.flowVersion,chargeType:historic.chargeType,checkoutUrl:null,amountCents:'1000',status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',authType:'OTP',authorizationReference:'CH-original-otp-'+id,paymentMethod:'cbebirr',merchantReference:'LW-historical-otp-'+id,pollAfterMs:2000};
 const current=():ChapaCheckoutView=>({...original,...(complete?{status:'CREDITED',providerStatus:'SUCCESS',reason:null}:{})});
 await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[historyRow(current())],page:1,nextPage:null}}));
 await page.route(/\/api\/payments\/chapa\/(?:direct(?:\/current)?|inline|checkouts)$/,route=>{if(route.request().method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{items:[current()],page:1,nextPage:null}})});
 await page.route('**/api/payments/chapa/checkouts/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/authorize')){expect(path).toBe('/api/payments/chapa/checkouts/'+id+'/authorize');authorizations.push(route.request().postDataJSON() as {otp:string})}
  else expect(path).toBe('/api/payments/chapa/checkouts/'+id);
  return route.fulfill({json:current()});
 });
 try{
  await page.goto('/payments');await page.locator('[data-payment-id]').click();const sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'Continue authorization',exact:true}).click();
  const code=sheet.getByLabel('One-time code',{exact:true});await expect(code).toBeVisible();await expect(sheet).toContainText('Never enter your wallet PIN here.');await code.fill('123456');await sheet.getByRole('button',{name:'Confirm code',exact:true}).click();await expect.poll(()=>authorizations.length).toBe(1);expect(authorizations[0]).toEqual({otp:'123456'});await expect(sheet.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);
  complete=true;await wakePayment(page);await expect(sheet.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(creates).toBe(0);expect(f.commands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.cleanup()}
});
