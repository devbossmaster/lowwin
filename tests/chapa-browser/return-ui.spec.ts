import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from './fixtures';

// Historical hosted orders still reopen and verify; new initiation is covered
// by direct-checkout.spec. A return link never creates or proves a payment.
for(const purpose of ['TOP_UP','BID'] as const)test(`existing hosted ${purpose} return restores its owned modal and waits for verified fulfillment`,async({page},info)=>{
 const am=info.project.name==='430',id=randomUUID(),f=await fixture(page,am,'chapa_'+id);
 const order={...pending(purpose==='TOP_UP'?{key:id,purpose,amount:'100.00'}:{purpose,key:id,auctionSlug:f.auction.slug!,amount:'3.60',feeVersion:1},id),auctionTitle:f.title,auctionCode:String(f.auction.publicCode)};
 let complete=false,creates=0,checks=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{const request=route.request(),url=new URL(request.url());if(url.pathname.endsWith('/checkouts')){if(request.method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{items:[order],page:1,nextPage:null}})}if(request.method()==='POST')checks++;return route.fulfill({json:{...order,...(complete?{status:purpose==='TOP_UP'?'CREDITED':'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',...(purpose==='BID'?{receipt:{bid:{id:randomUUID(),amount:'3.60'}}}:{})}:{})}})});
  await page.goto('/telegram');const sheet=page.getByRole('dialog');await expect(sheet.locator('[data-payment-state="confirming"]')).toBeVisible();
  await expect(page).toHaveURL(purpose==='TOP_UP'?new RegExp('/profile\\?(?:topup=1&)?chapa='+id):new RegExp('/auctions/'+f.auction.publicCode+'\\?chapa='+id));
  await expect(sheet.getByRole('button',{name:/Verify status|Check payment/i})).toHaveCount(0);await expect.poll(()=>checks).toBeGreaterThan(0);expect(creates).toBe(0);
  complete=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();
  if(purpose==='BID')await expect(sheet.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toBeVisible();
  await sheet.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true}).click();await expect(sheet).toHaveCount(0);expect(creates).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.$disconnect()}
});

test('an owned historical payment preserves unavailable and review states, then reconciles on foreground',async({page},info)=>{
 const am=info.project.name==='430',id=randomUUID(),f=await fixture(page,am,'chapa_'+id),order=pending({key:id,purpose:'TOP_UP',amount:'100'},id);let phase='unavailable',creates=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{const req=route.request(),collection=new URL(req.url()).pathname.endsWith('/checkouts');if(collection&&req.method()==='POST'){creates++;return route.abort()}return route.fulfill({json:{...order,...(phase==='unavailable'?{verificationState:'UNAVAILABLE',reason:'PROVIDER_CONFIRMATION_REQUIRED'}:phase==='review'?{status:'NEEDS_REVIEW',verificationState:'MISMATCH',reason:'EVIDENCE_MISMATCH'}:{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'})}})});
  await page.goto('/telegram');const sheet=page.getByRole('dialog');await expect(sheet.locator('[data-payment-state="unavailable"]')).toBeVisible();
  phase='review';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(sheet.locator('[data-payment-state="review"]')).toBeVisible();
  phase='credited';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(creates).toBe(0);
 }finally{await f.db.$disconnect()}
});

for(const outcome of ['provider-success','past-validity'] as const)test(`existing hosted checkout does not relaunch for ${outcome}`,async({page},info)=>{
 const id=randomUUID(),f=await fixture(page,info.project.name==='430','chapa_'+id),order={...pending({key:id,purpose:'TOP_UP',amount:'100'},id),providerStatus:outcome==='provider-success'?'SUCCESS':'PENDING',verificationState:'VERIFIED',...(outcome==='past-validity'?{expiresAt:new Date(Date.now()-1000).toISOString()}:{})};let creates=0;
 try{await page.route('**/api/payments/chapa/checkouts**',route=>{if(new URL(route.request().url()).pathname.endsWith('/checkouts')&&route.request().method()==='POST'){creates++;return route.abort()}return route.fulfill({json:order})});await page.goto('/telegram');const sheet=page.getByRole('dialog');await expect(sheet.locator(`[data-payment-state="${outcome==='provider-success'?'applying':'confirming'}"]`)).toBeVisible();expect(creates).toBe(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(0);await expect(sheet.getByRole('link',{name:/Continue checkout|ክፍያውን ይቀጥሉ/})).toHaveCount(0)}finally{await f.db.$disconnect()}
});
