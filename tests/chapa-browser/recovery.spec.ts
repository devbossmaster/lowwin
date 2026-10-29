import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {fixture,pending} from './fixtures';
import type {ChapaIntent,ChapaCheckoutView} from '../../src/lib/chapa-client';

test('fresh bid checkout, automatic status, late old result and transactions',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),requests:ChapaIntent[]=[],orders:ChapaCheckoutView[]=[];let verifies=0,reads=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/checkouts')){
    if(req.method()==='GET'){const page=Number(url.searchParams.get('page')??1);return route.fulfill({json:{items:orders.slice((page-1)*20,page*20),page,nextPage:orders.length>page*20?page+1:null}})}
    const body=req.postDataJSON() as ChapaIntent;requests.push(body);let order=orders.find(order=>order.id===body.key);if(!order){order={...pending(body,body.key),merchantReference:'LW'+body.key.replaceAll('-','').slice(0,18),providerStatus:'PENDING',verificationState:'UNVERIFIED',auctionTitle:f.title,auctionCode:String(f.auction.publicCode)};orders.unshift(order)}return route.fulfill({json:order});
   }
   const order=orders.find(order=>order.id===url.pathname.split('/').at(-1));if(!order)return route.fulfill({status:404,json:{error:'Not found'}});
   if(req.method()==='POST')verifies++;else reads++;
   return route.fulfill({json:order});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  const open=()=>page.locator('#discover-auctions .auction-card').first().getByRole('button').click();
  await open();let sheet=page.getByRole('dialog');await sheet.getByRole('textbox',{name:am?'የጨረታ ቁጥርዎ':'Your bid number',exact:true}).fill('3.60');await sheet.getByRole('radio',{name:'Chapa',exact:true}).check();
  await expect(sheet.locator('[data-payment-action]')).toBeEnabled();await sheet.locator('[data-payment-action]').evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(1);expect(requests).toHaveLength(1);await expect(sheet).toContainText(am?'የክፍያ ማረጋገጫ':'Waiting for payment confirmation');
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))});await expect.poll(()=>verifies).toBeGreaterThan(0);
  mkdirSync('test-results/chapa-ui/transactions',{recursive:true});await page.screenshot({path:'test-results/chapa-ui/transactions/waiting-'+info.project.name+'.png',animations:'disabled'});
  await page.keyboard.press('Escape');await open();sheet=page.getByRole('dialog');await expect(sheet.getByRole('textbox',{name:am?'የጨረታ ቁጥርዎ':'Your bid number',exact:true})).toBeEnabled();await expect(sheet).not.toContainText('Resume checkout');
  await sheet.getByRole('textbox',{name:am?'የጨረታ ቁጥርዎ':'Your bid number',exact:true}).fill('3.60');await sheet.getByRole('radio',{name:'Chapa',exact:true}).check();await sheet.locator('[data-payment-action]').click();await expect.poll(()=>requests.length).toBe(2);expect(requests[0].key).not.toBe(requests[1].key);
  const old=orders[1];Object.assign(old,{status:'BID_ACCEPTED',providerStatus:'SUCCESS',receipt:{bid:{id:randomUUID(),amount:'3.60'}}});
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(2);await expect(sheet).not.toContainText(am?'ጨረታው ተቀብሏል':'Bid accepted');await page.keyboard.press('Escape');
  const nav=page.getByRole('navigation',{name:'Your navigation'}),transactions=nav.getByRole('link',{name:am?'ግብይቶች':'Transactions',exact:true});await transactions.click();await expect(transactions).toHaveAttribute('aria-current','page');
  await expect(page.locator('[data-payment-id]')).toHaveCount(2);await page.locator('[data-payment-id]').first().click();sheet=page.getByRole('dialog');await expect(sheet.getByRole('button',{name:'Verify status',exact:true})).toHaveCount(0);
  Object.assign(orders[0],{status:'INCOMPLETE',providerStatus:'INCOMPLETE',verificationState:'VERIFIED'});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(sheet.getByRole('heading',{name:am?'አልተጠናቀቀም':'Incomplete',exact:true})).toBeVisible();expect(verifies).toBeGreaterThan(0);expect(reads).toBeGreaterThan(0);await page.keyboard.press('Escape');
  expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/chapa-ui/transactions/history-'+info.project.name+'.png',animations:'disabled'});
 }finally{await f.db.$disconnect()}
});
