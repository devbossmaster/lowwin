import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {setup,openBid,amount,phone,pay,quoteFor,directOrder} from '../nov10-browser/fixtures';
import type {BidBatchQuote,ChapaDirectIntent} from '../../src/lib/bid-batch-client';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';

test('measures immediate feedback and authorization presentation without real provider requests',async({page})=>{
 test.setTimeout(180000);
 const samples=[];
 for(let sample=0;sample<21;sample++){
  const f=await setup(page,false);let quote:BidBatchQuote|null=null,order:ChapaCheckoutView|null=null,quotes=0,charges=0;
  try{
   await page.route('**/api/payments/chapa/batches/quote',async route=>{quotes++;quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);await new Promise(resolve=>setTimeout(resolve,80));await route.fulfill({json:quote})});
   await page.route('**/api/payments/chapa/direct',async route=>{charges++;const command=route.request().postDataJSON() as ChapaDirectIntent;order=directOrder(command,quote!);await new Promise(resolve=>setTimeout(resolve,120));await route.fulfill({status:202,json:order})});
   await page.route('**/api/payments/chapa/direct/bid',async route=>{charges++;const command=route.request().postDataJSON();quote=quoteFor(f.auction.slug!,command.numbers);order=directOrder({...command,batchId:quote.id,quoteHash:quote.quoteHash} as ChapaDirectIntent,quote);await new Promise(resolve=>setTimeout(resolve,120));await route.fulfill({status:202,json:{kind:'payment',order}})});
   await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
   await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,false).fill('2');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,false).fill('0911652904');await expect(pay(dialog)).toBeEnabled();
   await pay(dialog).evaluate(button=>{
    type Sample={tap:number;feedback:number|null;authorization:number|null};
    const target=window as unknown as {chapaSpeedSample:Sample};target.chapaSpeedSample={tap:performance.now(),feedback:null,authorization:null};
    const observer=new MutationObserver(()=>{const sample=target.chapaSpeedSample;if(sample.feedback===null&&document.querySelector('[data-bid-payment-progress]'))sample.feedback=performance.now()-sample.tap;if(sample.authorization===null&&document.querySelector('[data-direct-approval="phone"]')){sample.authorization=performance.now()-sample.tap;observer.disconnect()}});
    observer.observe(document.body,{subtree:true,childList:true,attributes:true});(button as HTMLButtonElement).click();
   });
   await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();
   const observed=await page.evaluate(()=>(window as unknown as {chapaSpeedSample:{feedback:number;authorization:number}}).chapaSpeedSample);
   expect(observed.feedback).toBeGreaterThanOrEqual(0);expect(observed.authorization).toBeGreaterThan(observed.feedback);expect(charges).toBe(1);expect(quotes).toBe(process.env.CHAPA_SPEED_PHASE==='after'?0:1);
   samples.push({cache:sample?'warm':'first',feedbackMs:observed.feedback,authorizationMs:observed.authorization,quoteHttp:quotes,directHttp:charges});
   await page.unroute('**/api/payments/chapa/batches/quote');await page.unroute('**/api/payments/chapa/direct');await page.unroute('**/api/payments/chapa/direct/bid');await page.unroute('**/api/payments/chapa/checkouts/**');
  }finally{await f.cleanup()}
 }
 const warm=samples.slice(1),percentile=(key:'feedbackMs'|'authorizationMs',p:number)=>{const sorted=warm.map(row=>row[key]).sort((a,b)=>a-b);return Math.round(sorted[Math.ceil(sorted.length*p)-1]*100)/100};
 const report={phase:process.env.CHAPA_SPEED_PHASE??'before',scope:'360px installed Chrome, isolated loopback database, mocked application responses (baseline80ms quote +120ms direct; optimized120ms combined direct). Tap-to-progress and authorization DOM commit; not paint/device USSD delivery.',first:samples[0],warm:{samples:warm.length,feedbackMs:{p50:percentile('feedbackMs',.5),p95:percentile('feedbackMs',.95)},authorizationMs:{p50:percentile('authorizationMs',.5),p95:percentile('authorizationMs',.95)},quoteHttp:warm[0].quoteHttp,directHttp:warm[0].directHttp},samples};
 writeFileSync(`.local/chapa-speed-ui-${report.phase}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,samples:undefined}));
});
