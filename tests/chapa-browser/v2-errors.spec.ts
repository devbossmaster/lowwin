import {test,expect} from '@playwright/test';
import {fixture,pending} from './fixtures';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';

for(const issue of ['state','temporary'] as const)test(`v2 ${issue} initialization preserves the original payment and hides technical errors`,async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),intents:ChapaIntent[]=[];
 let order:ChapaCheckoutView|null=null,complete=false;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request(),collection=new URL(request.url()).pathname.endsWith('/checkouts');
   if(collection&&request.method()==='GET')return route.fulfill({json:{items:order?[order]:[],page:1,nextPage:null}});
   if(collection){
    const intent=request.postDataJSON() as ChapaIntent;intents.push(intent);
    order={...pending(intent,intents[0].key),verificationState:'UNAVAILABLE',checkoutUrl:null,initializationIssue:issue,reason:issue==='state'?'INITIALIZATION_CONFLICT':'INITIALIZATION_PENDING'};
    if(intents.length>1)order={...pending(intent,intents[0].key),initializationIssue:null};
   }
   return route.fulfill({json:{...order,...(complete?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{}),initializationErrorCode:'PRIVATE_PROVIDER_CODE',initializationHttpStatus:409}});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();
  const sheet=page.getByRole('dialog');await sheet.locator('[data-payment-action]').click();
  await expect(sheet.locator('[data-payment-state]')).toBeVisible();
  await sheet.locator('details summary').click();
  await expect(sheet).not.toContainText(/PRIVATE_PROVIDER_CODE|INITIALIZATION_CONFLICT|INITIALIZATION_PENDING|PENDING|UNAVAILABLE/);
  const retry=sheet.getByRole('button',{name:am?'የመጀመሪያውን ጥያቄ ይድገሙ':'Retry original request',exact:true});
  if(issue==='state'){
   await expect(retry).toHaveCount(0);expect(intents).toHaveLength(1);
   expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(0);
  }else{
   await expect(retry).toBeVisible();await retry.click();
   await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(1);
   expect(intents).toHaveLength(2);expect(intents[1]).toEqual(intents[0]);
  }
  complete=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();
  expect(intents).toHaveLength(issue==='state'?1:2);
 }finally{await f.db.$disconnect()}
});
