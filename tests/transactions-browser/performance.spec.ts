import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,pending} from '../chapa-browser/fixtures';
const stage=process.env.TRANSACTIONS_STAGE==='before'?'before':'after';
test('production history first load, repeat navigation and spaced resume events',async({page})=>{
 const f=await fixture(page,false),requests:string[]=[],createdAt=new Date().toISOString(),order={...pending({key:'5bbddcc4-5f37-4ae3-88b0-02991f64ba8b',purpose:'TOP_UP',amount:'10.00'}),'createdAt':createdAt};
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route('**/api/payments/chapa/checkouts?*',async route=>{requests.push(route.request().url());await new Promise(r=>setTimeout(r,60));await route.fulfill({json:{items:[order],page:1,nextPage:null}})});
 await page.route('**/api/transactions?*',async route=>{requests.push(route.request().url());await new Promise(r=>setTimeout(r,60));await route.fulfill({json:{items:[{id:order.id,source:'chapa',type:'TOP_UP',title:'Wallet top-up',titleAm:'የዋሌት ገቢ',amount:'10.00',direction:'none',summary:'checking',paymentMethod:'telebirr',createdAt,mode:'test'}],page:1,nextPage:null}})});
 await page.addInitScript(()=>{const states:{time:number;route:boolean;dataLoading:boolean;rows:number}[]=[];Reflect.set(window,'historyRenderStates',states);const record=()=>{const next={time:performance.now(),route:!!document.querySelector('[data-route-skeleton="payments"]'),dataLoading:!!document.querySelector('.customer-loading'),rows:document.querySelectorAll('[data-payment-id]').length};const last=states.at(-1);if(!last||last.route!==next.route||last.dataLoading!==next.dataLoading||last.rows!==next.rows)states.push(next)};new MutationObserver(record).observe(document,{subtree:true,childList:true});});
 try{
  const start=Date.now();await page.goto('/payments');await expect(page.locator('[data-payment-id]')).toHaveCount(1);const firstMs=Date.now()-start,initialRequests=requests.length;
  const render=await page.evaluate(()=>Reflect.get(window,'historyRenderStates'));
  await page.getByRole('link',{name:'Profile',exact:true}).last().click();await expect(page).toHaveURL(/\/profile/);
  const backStart=Date.now();await page.getByRole('link',{name:'Transactions',exact:true}).last().click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);const repeatMs=Date.now()-backStart,repeatRequests=requests.length-initialRequests;
  const beforeResume=requests.length;
  for(const name of ['visibilitychange','focus','online']){await page.evaluate(name=>name==='visibilitychange'?document.dispatchEvent(new Event(name)):window.dispatchEvent(new Event(name)),name);await page.waitForTimeout(180)}
  const resumeRequests=requests.length-beforeResume;
  const refreshBefore=requests.length;await page.getByRole('button',{name:'Refresh transactions',exact:true}).click();await expect.poll(()=>requests.length).toBe(refreshBefore+1);await page.waitForTimeout(120);const refreshRequests=requests.length-refreshBefore;
  let staleResumeRequests:number|null=null;
  if(stage==='after'){
   await page.clock.install();await page.clock.fastForward(31000);const beforeStale=requests.length;
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect.poll(()=>requests.length).toBe(beforeStale+1);
   for(const name of ['focus','online'])await page.evaluate(name=>window.dispatchEvent(new Event(name)),name);
   await page.clock.runFor(300);staleResumeRequests=requests.length-beforeStale;expect(staleResumeRequests).toBe(1);await expect(page.locator('[data-transactions-loading]')).toHaveCount(0);
  }
  mkdirSync(`test-results/transactions-performance/${stage}`,{recursive:true});writeFileSync(`test-results/transactions-performance/${stage}/measurements.json`,JSON.stringify({stage,firstMs,repeatMs,initialRequests,repeatRequests,resumeRequests,refreshRequests,staleResumeRequests,render,requests},null,2));await page.screenshot({path:`test-results/transactions-performance/${stage}/360.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(stage==='after'){expect(resumeRequests).toBe(0);expect(repeatRequests).toBe(0);await expect(page.locator('[data-transactions-balance]')).toHaveText('25.00 ETB');}
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
