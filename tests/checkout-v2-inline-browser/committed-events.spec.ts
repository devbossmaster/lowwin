import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {inlineFixture,selectBids} from './fixtures';

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
  await expect(dialog.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);
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
  await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(posts).toBe(1);
  await expect.poll(()=>page.evaluate(()=>performance.getEntriesByName('fixture:chapa-sse-callback-to-render').length)).toBe(1);
  const callbackToRenderMs=await page.evaluate(()=>performance.getEntriesByName('fixture:chapa-sse-callback-to-render')[0].duration);
  const measurement={sampleCount:1,callbackToRenderMs,width:info.project.name,kind:'SIMULATED_EVENTSOURCE_CALLBACK_TO_DOM',providerPollHeld:true,networkRedisCommitLatencyMeasured:false};
  writeFileSync(info.outputPath('simulated-sse-timing.json'),JSON.stringify(measurement,null,2));await info.attach('simulated-sse-timing',{body:JSON.stringify(measurement),contentType:'application/json'});
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'fixtureChapaSources').every((source:{closed:boolean})=>source.closed))).toBe(true);
  // A queued callback after cleanup cannot regress the displayed receipt.
  await page.evaluate(order=>Reflect.get(window,'fixtureChapaSources').forEach((source:EventTarget)=>source.dispatchEvent(new MessageEvent('checkout',{data:JSON.stringify({checkout:order})}))),{...f.order(),status:'PENDING',providerStatus:null,receipt:null});
  await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.sdkLoads).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{release();await f.cleanup()}
});

test('missing EventSource keeps automatic owned polling recovery without another charge',async({page})=>{
 const f=await inlineFixture(page);await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();await expect.poll(()=>f.checks.length).toBeGreaterThan(0);
  f.acceptBids();await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
