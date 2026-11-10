import {test,expect} from '@playwright/test';
import {fixture,pending} from '../chapa-browser/fixtures';
import {randomUUID} from 'node:crypto';
for(const width of [320,360,430])for(const am of [false,true])test(`activity, filters, details and focus ${width} ${am?'AM':'EN'}`,async({page})=>{
 await page.setViewportSize({width,height:800});const f=await fixture(page,am),id=randomUUID(),now=new Date().toISOString(),row={id,source:'chapa',type:'TOP_UP',title:'Wallet top-up',titleAm:null,amount:'100',direction:'none',summary:'failed',paymentMethod:'telebirr',createdAt:now,mode:'test'},requests:string[]=[];
 const order={...pending({key:randomUUID(),purpose:'TOP_UP',amount:'100'},id),chargeType:'DIRECT',paymentMethod:'telebirr',payerPhoneMasked:'251*****0000',providerStatus:'FAILED',verificationState:'VERIFIED',status:'FAILED',providerReasonCode:'INSUFFICIENT_FUNDS',merchantReference:'LW-local-fixture'};
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route('**/api/transactions?*',async route=>{requests.push(route.request().url());const url=new URL(route.request().url());await route.fulfill({json:{items:url.searchParams.get('q')==='missing'?[]:[row],page:1,nextPage:null}})});
 await page.route(`**/api/payments/chapa/checkouts/${id}`,route=>route.fulfill({json:order}));
 try{
  await page.goto('/payments');await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-customer-page-header]')).toContainText(am?'ግብይቶች':'Transactions');await expect(page.locator('[data-transactions-header-action] button')).toHaveCount(1);
  await page.screenshot({path:`test-results/transactions-performance/after/${width}-${am?'am':'en'}-list.png`});
  const activity=page.locator('[data-payment-id]').first();await expect(activity).not.toContainText('LW-local-fixture');await activity.click();await expect(page.locator('[data-transaction-detail]')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.locator('[data-transaction-detail]')).toContainText(am?'ገንዘብ':'insufficient');
  await page.screenshot({path:`test-results/transactions-performance/after/${width}-${am?'am':'en'}-details.png`});
  await expect(page.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).last().click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(activity).toBeFocused();
  await page.getByRole('button',{name:am?'የጨረታ ክፍያ':'Bid fees',exact:true}).click();await expect.poll(()=>requests.at(-1)).toContain('type=BID');await page.getByRole('searchbox').fill('missing');await page.getByRole('button',{name:am?'ፈልግ':'Search',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(0);await expect(page.locator('[data-transactions-page]')).toContainText(am?'የተዛመደ':'No matching activity');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/transactions-performance/after/${width}-${am?'am':'en'}.png`});
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
test('a failed top-up retries as an editable preserved draft only after original reconciliation',async({page})=>{
 const f=await fixture(page,false),id=randomUUID(),now=new Date().toISOString();let creates=0,checks=0;
 const failed={...pending({key:randomUUID(),purpose:'TOP_UP',amount:'100'},id),chargeType:'DIRECT',paymentMethod:'telebirr',payerPhoneMasked:'251*****0000',providerStatus:'FAILED',verificationState:'VERIFIED',status:'FAILED',providerReasonCode:'INSUFFICIENT_FUNDS',merchantReference:'LW-local-retry'};
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[{id,source:'chapa',type:'TOP_UP',title:'Wallet top-up',titleAm:null,amount:'100',direction:'none',summary:'failed',paymentMethod:'telebirr',createdAt:now,mode:'test'}],page:1,nextPage:null}}));
 await page.route('**/api/payments/chapa/methods',route=>route.fulfill({json:{methods:[{slug:'telebirr',name:'telebirr',minAmountCents:'100',maxAmountCents:'100000'}]}}));
 await page.route('**/api/payments/chapa/direct',route=>{creates++;return route.fulfill({json:failed})});
 await page.route(`**/api/payments/chapa/checkouts/${id}`,route=>{if(route.request().method()==='POST')checks++;return route.fulfill({json:failed})});
 try{
  await page.goto('/payments');await expect(page.locator('[data-payment-id]')).toHaveCount(1);await page.getByRole('button',{name:'Top up',exact:true}).click();const form=page.locator('[data-wallet-top-up]');await expect(form).toBeVisible();await form.locator('input[inputmode=decimal]').fill('100');await form.getByRole('radio',{name:'telebirr',exact:true}).check();await form.locator('input[type=tel]').fill('911000000');await page.getByRole('button',{name:'Top up ETB 100.00',exact:true}).click();await expect.poll(()=>creates).toBe(1);await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).first().click();
  await page.locator('[data-payment-id]').first().click();await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.locator('[data-wallet-top-up]')).toBeVisible();expect(checks).toBe(1);expect(creates).toBe(1);await expect(page.locator('[data-wallet-top-up] input[type=tel]')).toHaveValue('911000000');await expect(page.locator('[data-wallet-top-up] input[inputmode=decimal]')).toHaveValue('100');await expect(page.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
