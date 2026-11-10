import {test,expect} from '../isolated-browser';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {fixture,pending} from '../chapa-browser/fixtures';

for(const am of [false,true])test(`customer payment summaries stay truthful and contained in ${am?'Amharic':'English'}`,async({page})=>{
 const f=await fixture(page,am),base=pending({key:randomUUID(),purpose:'TOP_UP',amount:'50.00'});
 const items=[{...base,id:randomUUID(),status:'CREDITED'},
  {...base,id:randomUUID(),status:'EXPIRED',providerStatus:'PENDING'},
  {...base,id:randomUUID(),status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED'},
  {...base,id:randomUUID(),purpose:'BID',status:'NEEDS_REVIEW',fundsPreserved:true}];
 const writes:string[]=[];
 await page.route('**/api/payments/chapa/checkouts?**',route=>route.fulfill({json:{items,page:1,nextPage:null}}));
 page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/payments/'))writes.push(r.url())});
 try{
  await page.goto('/payments');const history=page.locator('[data-payment-history]');
  await expect(history.locator('[data-payment-summary="done"]')).toHaveCount(2);
  await expect(history.locator('[data-payment-summary="failed"]')).toHaveText(am?'አልተሳካም':'Failed');
  await expect(history.locator('[data-payment-summary="checking"]')).toHaveText(am?'ክፍያው በማረጋገጥ ላይ…':'Checking payment…');
  for(const width of [320,430]){
   await page.setViewportSize({width,height:900});await expect(history.locator('[data-payment-summary="checking"]')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   expect(await history.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
   mkdirSync('test-results/admin-speed/screenshots',{recursive:true});await page.screenshot({path:`test-results/admin-speed/screenshots/customer-payments-${width}-${am?'am':'en'}.png`,fullPage:true});
  }
  expect(writes).toEqual([]);
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
