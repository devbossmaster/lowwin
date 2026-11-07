import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from './fixtures';
for(const issue of ['state','temporary'] as const)test(`owned v2 ${issue} initialization remains checkable and hides private errors`,async({page},info)=>{
 const id=randomUUID(),f=await fixture(page,info.project.name==='430','chapa_'+id);let complete=false,creates=0,checks=0;
 const order={...pending({key:id,purpose:'TOP_UP',amount:'100'},id),verificationState:'UNAVAILABLE',checkoutUrl:null,initializationIssue:issue,reason:issue==='state'?'INITIALIZATION_CONFLICT':'INITIALIZATION_PENDING'};
 try{await page.route('**/api/payments/chapa/checkouts**',route=>{const req=route.request(),collection=new URL(req.url()).pathname.endsWith('/checkouts');if(collection&&req.method()==='POST'){creates++;return route.abort()}if(req.method()==='POST')checks++;return route.fulfill({json:{...order,...(complete?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{}),initializationErrorCode:'PRIVATE_PROVIDER_CODE',initializationHttpStatus:409}})});
  await page.goto('/telegram');const sheet=page.getByRole('dialog');await expect(sheet.locator('[data-payment-state]')).toBeVisible();await sheet.locator('details summary').click();await expect(sheet).not.toContainText(/PRIVATE_PROVIDER_CODE|INITIALIZATION_CONFLICT|INITIALIZATION_PENDING|PENDING|UNAVAILABLE/);
  expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(0);expect(creates).toBe(0);complete=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(checks).toBeGreaterThan(0);expect(creates).toBe(0);
 }finally{await f.db.$disconnect()}
});
