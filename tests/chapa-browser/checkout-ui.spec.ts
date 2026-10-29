import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from './fixtures';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';

test('top-up opens once, closing detaches UI, and older owned pages remain accessible',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),requests:ChapaIntent[]=[],orders:ChapaCheckoutView[]=[];let verifyPosts=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/checkouts')){
    if(req.method()==='GET'){const page=Number(url.searchParams.get('page')??1);return route.fulfill({json:{items:orders.slice((page-1)*20,page*20),page,nextPage:orders.length>page*20?page+1:null}})}
    const body=req.postDataJSON() as ChapaIntent;requests.push(body);const order=pending(body);orders.unshift(order);return route.fulfill({json:order});
   }
   const order=orders.find(order=>order.id===url.pathname.split('/').at(-1));if(req.method()==='POST')verifyPosts++;return route.fulfill({status:order?200:404,json:order??{error:'Not found'}});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  const open=()=>page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();await open();let sheet=page.getByRole('dialog');await sheet.getByRole('textbox',{name:am?'መጠን':'Amount',exact:true}).fill('250');await sheet.locator('[data-payment-action]').evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(1);expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({purpose:'TOP_UP',amount:'250'});await expect(sheet).toContainText('250.00');await expect(sheet.locator('a[href^="https://checkout.chapa.global"]')).toHaveCount(0);
  await page.keyboard.press('Escape');await open();sheet=page.getByRole('dialog');await expect(sheet.getByRole('textbox',{name:am?'መጠን':'Amount',exact:true})).toBeEnabled();expect(requests).toHaveLength(1);await page.keyboard.press('Escape');
  for(let i=0;i<21;i++)orders.push({...pending({key:randomUUID(),purpose:'TOP_UP',amount:'10.00'}),status:i%2?'INCOMPLETE':'FAILED',providerStatus:i%2?'INCOMPLETE':'FAILED'});
  await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:am?'ግብይቶች':'Transactions',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(20);await page.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(2);expect(verifyPosts).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.$disconnect()}
});
