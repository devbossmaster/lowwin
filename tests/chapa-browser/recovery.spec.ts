import {test,expect} from '@playwright/test';
import {randomInt,randomUUID} from 'node:crypto';
import {fixture,pending,transaction} from './fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import type {ChapaIntent} from '../../src/lib/chapa-client';

test('one hosted top-up survives sheet closure, resumes in Transactions and confirms the same payment',async({page})=>{
 const f=await fixture(page,false),commands:ChapaIntent[]=[];let order:ChapaCheckoutView|null=null,confirmed=false,checks=0,directCreates=0;
 try{
  await page.route('**/api/payments/chapa/direct',route=>{directCreates++;return route.abort()});
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:order?[transaction(order,confirmed?'done':'checking',confirmed?'incoming':'none')]:[],page:1,nextPage:null}}));
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request(),collection=new URL(request.url()).pathname.endsWith('/checkouts');
   if(collection&&request.method()==='POST'){const command=request.postDataJSON() as ChapaIntent;commands.push(command);order=pending(command,command.key);return route.fulfill({json:order})}
   const current=order?{...order,...(confirmed?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}:null;
   if(collection)return route.fulfill({json:{items:current?[current]:[],page:1,nextPage:null}});
   if(request.method()==='POST')checks++;return route.fulfill({json:current});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.locator('[data-header-balance]')).toContainText('25.00');await page.getByRole('link',{name:'Deposit',exact:true}).click();
  let sheet=page.getByRole('dialog');await sheet.getByRole('textbox',{name:'Amount to top up',exact:true}).fill('10');await expect(sheet.locator('[data-top-up-continue]')).toBeEnabled();await sheet.locator('[data-top-up-continue]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});
  await expect.poll(()=>commands.length).toBe(1);await expect(sheet.locator('[data-hosted-checkout-status]')).toContainText('Complete payment on Chapa');
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([order!.checkoutUrl]);await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);
  await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-payment-id]')).toHaveAttribute('data-payment-id',commands[0].key);await page.locator('[data-payment-id]').click();sheet=page.getByRole('dialog');
  await expect(sheet.locator('[data-transaction-detail] [data-summary=checking]')).toBeVisible();await expect(sheet.getByRole('button',{name:'Check payment',exact:true})).toBeVisible();confirmed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-transaction-detail] [data-summary=done]')).toBeVisible();expect(checks).toBeGreaterThan(0);expect(commands).toHaveLength(1);expect(directCreates).toBe(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

test('an old payment response cannot populate history after switching signed Telegram accounts',async({page})=>{
 const f=await fixture(page,false),id=randomUUID(),order={...pending({key:id,purpose:'TOP_UP',amount:'100.00'},id),merchantReference:'LW-owned-first-account'};
 const secondId=randomInt(8900000000,8990000000);await verifyFixtureContact(f.db,secondId);const secondUser=await f.db.user.findUniqueOrThrow({where:{telegramId:String(secondId)}});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let second=false,ownedReads=0,creates=0;
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 try{
  await page.route('**/api/payments/chapa/direct',route=>{creates++;return route.abort()});
  await page.route('**/api/transactions?**',route=>route.fulfill({json:{items:second?[]:[transaction(order,'checking','none')],page:1,nextPage:null}}));
  await page.route('**/api/payments/chapa/checkouts**',async route=>{
   const request=route.request(),collection=new URL(request.url()).pathname.endsWith('/checkouts');
   if(collection){if(request.method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{items:second?[]:[order],page:1,nextPage:null}})}
   if(request.method()==='POST')return route.fulfill({json:order});
   ownedReads++;await gate;await route.fulfill({json:order}).catch(()=>{});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.locator('[data-header-balance]')).toBeVisible();const nav=page.getByRole('navigation',{name:'Your navigation'});await nav.getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);await page.locator('[data-payment-id]').click();await expect.poll(()=>ownedReads).toBe(1);await page.keyboard.press('Escape');
  second=true;const launch=signedLaunch({user:JSON.stringify({id:secondId,first_name:'Second account fixture'})},process.env.TELEGRAM_BOT_TOKEN);
  await page.evaluate(launch=>{window.Telegram!.WebApp!.initData=launch},launch);const switched=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin'&&response.request().method()==='POST');await nav.getByRole('link',{name:'Home',exact:true}).click();const account=await (await switched).json();expect(account.me.user.id).toBe(secondUser.id);
  release();await expect(page.locator('[data-header-balance]')).toBeVisible();await nav.getByRole('link',{name:'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(0);await expect(page.locator('[data-transactions-page]')).not.toContainText('LW-owned-first-account');expect(creates).toBe(0);expect(await f.db.chapaCheckout.count({where:{userId:{in:[f.user.id,secondUser.id]}}})).toBe(0);
 }finally{release();await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
