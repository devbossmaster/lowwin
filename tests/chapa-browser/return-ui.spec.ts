import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {fixture,pending} from './fixtures';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';

test('a Main Mini App payment link restores the original top-up and automatically shows credit',async({page},info)=>{
 const am=info.project.name==='430',id=randomUUID(),f=await fixture(page,am,'chapa_'+id);
 let verifies=0,creates=0,complete=false;
 const order=pending({key:id,purpose:'TOP_UP',amount:'100.00'},id);
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request();
   if(request.method()==='GET'&&new URL(request.url()).pathname.endsWith('/checkouts'))return route.fulfill({json:{items:[order],page:1,nextPage:null}});
   if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/checkouts')){creates++;return route.abort()}
   if(request.method()==='POST')verifies++;
   return route.fulfill({json:{...order,...(complete?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}});
  });
  await page.goto('/telegram');const sheet=page.getByRole('dialog');
  await expect(sheet.locator('[data-payment-state="confirming"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('/profile\\?(?:topup=1&)?chapa='+id));
  await expect(sheet.getByRole('button',{name:/Verify status|Check payment/i})).toHaveCount(0);
  await expect.poll(()=>verifies).toBe(1);expect(creates).toBe(0);
  complete=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();
  await expect(sheet.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  mkdirSync('test-results/chapa-ui/modal',{recursive:true});
  await page.screenshot({path:'test-results/chapa-ui/modal/credited-'+info.project.name+'.png',animations:'disabled'});
  await sheet.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true}).click();await expect(sheet).toHaveCount(0);
 }finally{await f.db.$disconnect()}
});

test('verification problems show a useful state and automatically recover on foreground',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am);let order:ChapaCheckoutView|null=null,phase='unavailable',creates=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/checkouts')&&request.method()==='GET')return route.fulfill({json:{items:order?[order]:[],page:1,nextPage:null}});
   if(url.pathname.endsWith('/checkouts')&&request.method()==='POST'){creates++;order=pending(request.postDataJSON() as ChapaIntent);return route.fulfill({json:order})}
   if(!order)return route.fulfill({status:404,json:{error:'Not found',code:'NOT_FOUND'}});
   return route.fulfill({json:{...order,...(phase==='unavailable'?{verificationState:'UNAVAILABLE',reason:'PROVIDER_CONFIRMATION_REQUIRED'}:phase==='review'?{status:'NEEDS_REVIEW',verificationState:'MISMATCH',reason:'EVIDENCE_MISMATCH'}:{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'})}});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();
  const sheet=page.getByRole('dialog');await sheet.locator('[data-payment-action]').click();
  await expect(sheet.locator('[data-payment-state="unavailable"]')).toBeVisible();
  await expect(sheet.locator('[data-payment-state] svg[class*="paymentSpinner"]')).toHaveCount(0);
  phase='review';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="review"]')).toBeVisible();
  mkdirSync('test-results/chapa-ui/modal',{recursive:true});
  await page.screenshot({path:'test-results/chapa-ui/modal/review-'+info.project.name+'.png',animations:'disabled'});
  phase='credited';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(creates).toBe(1);
 }finally{await f.db.$disconnect()}
});

test('an interrupted initialization retries the original key and opens only one checkout',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),intents:ChapaIntent[]=[];
 try{
  await page.route('**/api/payments/chapa/checkouts**',async route=>{
   const request=route.request();
   if(new URL(request.url()).pathname.endsWith('/checkouts')){
    const intent=request.postDataJSON() as ChapaIntent;intents.push(intent);
    if(intents.length===1)return route.abort('connectionreset');
    return route.fulfill({json:pending(intent,intents[0].key)});
   }
   return route.fulfill({json:pending(intents[0],intents[0].key)});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();const sheet=page.getByRole('dialog');
  await sheet.locator('[data-payment-action]').click();
  await sheet.getByRole('button',{name:am?'የመጀመሪያውን ጥያቄ ይድገሙ':'Retry original request',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(1);
  expect(intents).toHaveLength(2);expect(intents[1]).toEqual(intents[0]);
 }finally{await f.db.$disconnect()}
});

test('a bid return reopens its product modal and accepts only a server-confirmed receipt',async({page},info)=>{
 const am=info.project.name==='430',id=randomUUID(),f=await fixture(page,am,'chapa_'+id);
 const order={...pending({purpose:'BID',key:id,auctionSlug:f.auction.slug!,amount:'3.60',feeVersion:1},id),auctionTitle:f.title};
 let complete=false,creates=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/checkouts')){
    if(request.method()==='POST'){creates++;return route.abort()}
    return route.fulfill({json:{items:[order],page:1,nextPage:null}});
   }
   return route.fulfill({json:{...order,...(complete?{status:'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:{bid:{id:randomUUID(),amount:'3.60'}}}:{})}});
  });
  await page.goto('/telegram');const sheet=page.getByRole('dialog');
  await expect(sheet.locator('[data-payment-state="confirming"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('/auctions/(?:'+f.auction.slug+'|'+f.auction.publicCode+')\\?chapa='+id));
  await expect(sheet).toContainText(f.title);
  complete=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();
  await expect(sheet.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toBeVisible();
  expect(creates).toBe(0);
  mkdirSync('test-results/chapa-ui/modal',{recursive:true});
  await page.screenshot({path:'test-results/chapa-ui/modal/bid-accepted-'+info.project.name+'.png',animations:'disabled'});
 }finally{await f.db.$disconnect()}
});
