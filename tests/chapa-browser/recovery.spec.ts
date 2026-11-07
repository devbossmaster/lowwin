import {test,expect} from '@playwright/test';
import {randomInt,randomUUID} from 'node:crypto';
import {fixture,pending} from './fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import type {ChapaDirectIntent} from '../../src/lib/bid-batch-client';

test('one direct top-up survives sheet closure, resumes in Transactions and confirms the same payment automatically',async({page})=>{
 const f=await fixture(page,false),commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null,confirmed=false,checks=0,hostedCreates=0;
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 try{
  await page.route('**/api/payments/chapa/methods?**',route=>route.fulfill({json:{methods:[{name:'Telebirr',slug:'telebirr',minAmountCents:'100',maxAmountCents:'10000000'}],paymentPhone:'251911652904'}}));
  await page.route('**/api/payments/chapa/direct',route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order={...pending({key:command.key,purpose:'TOP_UP',amount:'10.00'},command.key),chargeType:'DIRECT',checkoutUrl:null,amount:'10.00',amountCents:'1000',status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',authType:'USSD',authorizationReference:'CH-original-'+command.key,paymentMethod:command.paymentMethod,payerPhoneMasked:'251*****2904',pollAfterMs:1500};return route.fulfill({status:202,json:order})});
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request(),collection=new URL(request.url()).pathname.endsWith('/checkouts');
   const current=order?{...order,...(confirmed?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}:null;
   if(collection){if(request.method()==='POST'){hostedCreates++;return route.abort()}return route.fulfill({json:{items:current?[current]:[],page:1,nextPage:null}})}
   if(request.method()==='POST')checks++;return route.fulfill({json:current});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.locator('[data-header-balance]')).toContainText('25.00');await page.getByRole('link',{name:'Deposit',exact:true}).click();
  let sheet=page.getByRole('dialog');await sheet.getByRole('textbox',{name:'Amount',exact:true}).fill('10');await sheet.locator('[data-payment-action]').click();await expect(sheet.locator('[data-direct-checkout]')).toBeVisible();
  await sheet.locator('[data-payment-action]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>commands.length).toBe(1);await expect(sheet).toContainText('Approve the payment on your phone');
  expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);
  await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-payment-id]')).toHaveAttribute('data-payment-id',commands[0].key);await page.locator('[data-payment-id]').click();sheet=page.getByRole('dialog');
  await expect(sheet).toContainText('Approve the payment on your phone');await expect(sheet.getByRole('button',{name:/Verify status|Check payment/})).toHaveCount(0);confirmed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(checks).toBeGreaterThan(0);expect(commands).toHaveLength(1);expect(hostedCreates).toBe(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

test('an old payment response cannot populate history after switching signed Telegram accounts',async({page})=>{
 const f=await fixture(page,false),id=randomUUID(),order={...pending({key:id,purpose:'TOP_UP',amount:'100.00'},id),merchantReference:'LW-owned-first-account'};
 const secondId=randomInt(8900000000,8990000000);await verifyFixtureContact(f.db,secondId);const secondUser=await f.db.user.findUniqueOrThrow({where:{telegramId:String(secondId)}});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let second=false,ownedReads=0,creates=0;
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 try{
  await page.route('**/api/payments/chapa/direct',route=>{creates++;return route.abort()});
  await page.route('**/api/payments/chapa/checkouts**',async route=>{
   const request=route.request(),collection=new URL(request.url()).pathname.endsWith('/checkouts');
   if(collection){if(request.method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{items:second?[]:[order],page:1,nextPage:null}})}
   if(request.method()==='POST')return route.fulfill({json:order});
   ownedReads++;await gate;await route.fulfill({json:order}).catch(()=>{});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.locator('[data-header-balance]')).toBeVisible();const nav=page.getByRole('navigation',{name:'Your navigation'});await nav.getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);await page.locator('[data-payment-id]').click();await expect.poll(()=>ownedReads).toBe(1);await page.keyboard.press('Escape');
  second=true;const launch=signedLaunch({user:JSON.stringify({id:secondId,first_name:'Second account fixture'})},process.env.TELEGRAM_BOT_TOKEN);
  await page.evaluate(launch=>{window.Telegram!.WebApp!.initData=launch},launch);const switched=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin'&&response.request().method()==='POST');await nav.getByRole('link',{name:'Home',exact:true}).click();const account=await (await switched).json();expect(account.me.user.id).toBe(secondUser.id);
  release();await expect(page.locator('[data-header-balance]')).toBeVisible();await nav.getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(0);await expect(page.locator('#transactions')).not.toContainText('LW-owned-first-account');expect(creates).toBe(0);expect(await f.db.chapaCheckout.count({where:{userId:{in:[f.user.id,secondUser.id]}}})).toBe(0);
 }finally{release();await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
