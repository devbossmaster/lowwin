import {expect,test,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {inlineFixture,selectBids,wakePayment} from './fixtures';

const resultClose=(dialog:Locator)=>dialog.locator('[data-payment-result-actions]').getByRole('button',{name:'Close',exact:true});
async function expectSharedAuthorization(dialog:Locator){
 await expect(dialog.locator('[data-payment-view="authorization"]')).toBeVisible();
 await expect(dialog.getByRole('heading',{name:'Waiting for authorization…',exact:true})).toBeVisible();
 await expect(dialog.locator('[data-payment-result-actions]')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:/^(Check payment|Retry original request|Try again)$/})).toHaveCount(0);
 await expect(dialog.locator('[data-payment-support-reference]')).toHaveCount(0);
}

test('simulated committed SSE renders the owned receipt while provider polling is still pending',async({page},info)=>{
 const f=await inlineFixture(page);let release!:()=>void,posts=0;
 const gate=new Promise<void>(resolve=>{release=resolve});
 await page.addInitScript(()=>{
  const sources:Array<EventTarget&{url:string;closed:boolean}>=[];
  class FixtureEventSource extends EventTarget{
   closed=false;
   constructor(public url:string){super();sources.push(this);queueMicrotask(()=>{if(!this.closed)this.dispatchEvent(new Event('open'))})}
   close(){this.closed=true}
  }
  Reflect.set(window,'fixtureChapaSources',sources);Reflect.set(window,'EventSource',FixtureEventSource);
 });
 await page.route(/\/api\/payments\/chapa\/checkouts\/[^/]+$/,async route=>{
  const original=f.order();if(route.request().method()==='POST'){posts++;await gate}
  await route.fulfill({json:original}).catch(()=>{});
 });
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();await expect.poll(()=>posts).toBe(1);
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'fixtureChapaSources').filter((source:{closed:boolean})=>!source.closed).length)).toBe(1);
  // An unrelated payment cannot populate this receipt, even in a fixture.
  await page.evaluate(order=>{
   const sources=Reflect.get(window,'fixtureChapaSources') as EventTarget[];
   sources.at(-1)!.dispatchEvent(new MessageEvent('checkout',{data:JSON.stringify({checkout:order})}));
  },{...f.order(),id:randomUUID(),status:'BID_ACCEPTED',providerStatus:'SUCCESS'});
  await expect(resultClose(dialog)).toHaveCount(0);
  f.acceptBids();
  await page.evaluate(order=>{
   const sources=Reflect.get(window,'fixtureChapaSources') as Array<EventTarget&{closed:boolean}>;
   const observer=new MutationObserver(()=>{
    if(!document.querySelector('[data-payment-state="confirmed"]'))return;
    performance.measure('fixture:chapa-sse-callback-to-render',{start:'fixture:chapa-sse-callback'});observer.disconnect();
   });
   observer.observe(document.body,{subtree:true,childList:true,attributes:true});
   performance.mark('fixture:chapa-sse-callback');
   sources.filter(source=>!source.closed).forEach(source=>source.dispatchEvent(new MessageEvent('checkout',{data:JSON.stringify({checkout:order})})));
  },f.order());
  await expect(resultClose(dialog)).toBeVisible();expect(posts).toBe(1);
  await expect.poll(()=>page.evaluate(()=>performance.getEntriesByName('fixture:chapa-sse-callback-to-render').length)).toBe(1);
  const callbackToRenderMs=await page.evaluate(()=>performance.getEntriesByName('fixture:chapa-sse-callback-to-render')[0].duration);
  const measurement={sampleCount:1,callbackToRenderMs,width:info.project.name,kind:'SIMULATED_EVENTSOURCE_CALLBACK_TO_DOM',providerPollHeld:true,networkRedisCommitLatencyMeasured:false};
  writeFileSync(info.outputPath('simulated-sse-timing.json'),JSON.stringify(measurement,null,2));await info.attach('simulated-sse-timing',{body:JSON.stringify(measurement),contentType:'application/json'});
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'fixtureChapaSources').every((source:{closed:boolean})=>source.closed))).toBe(true);
  // A queued callback after cleanup cannot regress the displayed receipt.
  await page.evaluate(order=>Reflect.get(window,'fixtureChapaSources').forEach((source:EventTarget)=>source.dispatchEvent(new MessageEvent('checkout',{data:JSON.stringify({checkout:order})}))),{...f.order(),status:'PENDING',providerStatus:null,receipt:null});
  await expect(resultClose(dialog)).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.sdkLoads).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{release();await f.cleanup()}
});

test('missing EventSource keeps automatic owned polling recovery without another charge',async({page})=>{
 const f=await inlineFixture(page);await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();await expect.poll(()=>f.checks.length).toBeGreaterThan(0);
  f.acceptBids();await expect(resultClose(dialog)).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('wallet return prioritizes one owned verification after the current request',async({page})=>{
 const f=await inlineFixture(page);
 const checks:Array<{id:string;hint:string|null}>=[];
 let releaseOld!:()=>void,releaseReturn!:()=>void;
 const oldReply=new Promise<void>(resolve=>{releaseOld=resolve}),returnReply=new Promise<void>(resolve=>{releaseReturn=resolve});
 await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 await page.route(/\/api\/payments\/chapa\/checkouts\/[^/]+$/,async route=>{
  const request=route.request();
  if(request.method()!=='POST'){await route.fallback();return}
  const id=new URL(request.url()).pathname.split('/').at(-1)!;
  const hint=request.headers()['x-lowwin-wallet-return']??null;
  checks.push({id,hint});
  if(checks.length===1){
   const pending=f.order();
   await oldReply;
   await route.fulfill({json:pending}).catch(()=>{});
   return;
  }
  if(hint==='1')await returnReply;
  await route.fulfill({json:f.order()}).catch(()=>{});
 });
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  await expectSharedAuthorization(dialog);
  const id=f.order().id;
  await expect.poll(()=>checks).toEqual([{id,hint:null}]);
  await page.evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await wakePayment(page);
  expect(checks).toEqual([{id,hint:null}]);
  await expect(resultClose(dialog)).toHaveCount(0);
  releaseOld();
  await expect.poll(()=>checks).toEqual([{id,hint:null},{id,hint:'1'}]);
  await expect(resultClose(dialog)).toHaveCount(0);
  f.acceptBids();releaseReturn();
  await expect(resultClose(dialog)).toBeVisible();
  expect(checks).toEqual([{id,hint:null},{id,hint:'1'}]);
  expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{releaseOld();releaseReturn();await f.cleanup()}
});

test('retained completion hints stay checking until a fresh private terminal result resolves the original attempt',async({page})=>{
 const f=await inlineFixture(page);await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 const resume=async()=>{
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  await wakePayment(page);
 };
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();await expectSharedAuthorization(dialog);const original=f.order().id;
  f.setOrder({status:'NEEDS_REVIEW',providerStatus:'FAILED',verificationState:'VERIFIED',completionSignalPending:true,updatedAt:new Date().toISOString()});await resume();
  await expect(dialog.locator('[data-payment-progress="confirming"]')).toBeVisible();await expectSharedAuthorization(dialog);
  await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
  await expect(resultClose(dialog)).toHaveCount(0);
  f.setOrder({status:'PENDING',providerStatus:'PENDING',completionSignalPending:true,updatedAt:new Date().toISOString()});await resume();
  await expect(dialog.locator('[data-payment-progress="confirming"]')).toBeVisible();await expectSharedAuthorization(dialog);
  f.setOrder({status:'FAILED',providerStatus:'FAILED',completionSignalPending:false,updatedAt:new Date().toISOString()});await resume();
  await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  expect(new Set(f.checks)).toEqual(new Set([original]));expect(f.commands).toHaveLength(1);
  expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
