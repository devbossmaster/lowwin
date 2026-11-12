import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openBid,sdkSignal,v1Fixture,wakePayment} from './fixtures';

test('an interrupted initialization resolves the same owned key without another creation or SDK dispatch',async({page},info)=>{
 test.skip(info.project.name!=='360','One original-intent lookup check.');const f=await v1Fixture(page);f.interruptNextInitialization();
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);await expect(dialog.getByRole('button',{name:'Check payment',exact:true})).toBeVisible();expect(f.sdkCommands).toHaveLength(0);await dialog.getByRole('button',{name:'Close',exact:true}).first().click();dialog=await openBid(page,f.title);await expect.poll(()=>f.resolutions.length).toBeGreaterThan(0);expect(new Set(f.resolutions)).toEqual(new Set([f.commands[0].key]));await expect.poll(()=>f.checks.length).toBeGreaterThan(0);expect(new Set(f.checks)).toEqual(new Set([f.order().id]));expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(0);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('the actual pinned Inline artifact sends the owned tx_ref and iframe disposal stops its internal polling',async({page},info)=>{
 test.skip(info.project.name!=='360','One real SDK artifact contract check.');const f=await v1Fixture(page),charges:string[]=[],validations:string[]=[];
 try{
  await page.route('**/vendor/chapa-inline-v1*.js',route=>route.fulfill({contentType:'application/javascript',body:readFileSync('public/vendor/chapa-inline-v1.c9e7f64f.js','utf8')}));
  await page.route('https://assets.chapa.co/inline-assets/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>'}));
  await page.route('https://inline.chapaservices.net/v1/inline/**',route=>{
   const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   const path=new URL(route.request().url()).pathname,body=route.request().postData()??'';
   if(path.endsWith('/charge')){charges.push(body);return route.fulfill({headers,json:{status:'success',data:{meta:{ref_id:'synthetic-provider-reference'}}}})}
   validations.push(body);return route.fulfill({headers,json:{status:'success',data:{status:'pending'}}});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>charges.length).toBe(1);await expect.poll(()=>validations.length).toBeGreaterThan(0);
  expect(charges[0]).toContain(`name="tx_ref"\r\n\r\n${f.order().merchantReference}`);expect(charges[0]).toContain('name="amount"\r\n\r\n10.00');expect(charges[0]).toContain('name="payment_method"\r\n\r\ntelebirr');expect(charges[0]).toContain('name="mobile"\r\n\r\n911652904');
  await dialog.getByRole('button',{name:'Close',exact:true}).first().click();await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(0);const count=validations.length;await page.clock.install();await page.clock.runFor(10000);expect(validations).toHaveLength(count);expect(charges).toHaveLength(1);expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('Inline SDK keeps its owned reference, one instance and uncertain callbacks cannot settle a bid',async({page},info)=>{
 test.skip(info.project.name!=='360','One isolated SDK lifecycle check.');const f=await v1Fixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();
  await dialog.locator('[data-payment-action]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>f.commands.length).toBe(1);await expect.poll(()=>f.sdkCommands.length).toBe(1);
  expect(f.commands[0]).toMatchObject({purpose:'BID',flow:'INLINE',phone:'251911652904',paymentMethod:'telebirr'});expect(f.sdkCommands[0]).toMatchObject({amount:'10.00',currency:'ETB',mobile:'911652904',availablePaymentMethods:['telebirr']});expect(f.sdkCommands[0].tx_ref).toMatch(/^LWfixture/);
  await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(1);await expect(page.getByRole('dialog')).toHaveCount(1);
  await sdkSignal(page,'success',{status:'success',tx_ref:'forged-browser-reference',amount:0});await expect.poll(()=>f.checks.length).toBeGreaterThan(0);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);expect(f.commands).toHaveLength(1);
  const checks=f.checks.length;await sdkSignal(page,'failure',{message:'Network interrupted'});await expect.poll(()=>f.checks.length).toBeGreaterThan(checks);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);await expect(dialog).not.toContainText('Nothing was charged');expect(f.commands).toHaveLength(1);
  await dialog.getByRole('button',{name:'Close',exact:true}).first().click();await expect(dialog).toHaveCount(0);await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(0);
  // Fail restoration itself, not only a poll after a snapshot has loaded. A
  // foreground/online event must still recover this same owned attempt.
  f.setUnavailable(true);const restored=page.waitForResponse(response=>response.url().includes(`/api/payments/chapa/checkouts/${f.order().id}`)&&response.request().method()==='GET'&&response.status()===503);
  dialog=await openBid(page,f.title);await restored;await expect(dialog.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(1);
  f.setUnavailable(false);f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Change payment',exact:true})).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(1);expect(new Set(f.checks)).toEqual(new Set([f.order().id]));expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('confirmed cancellation retries with preserved payment details only after owned reconciliation',async({page},info)=>{
 test.skip(info.project.name!=='360','One safe terminal retry check.');const f=await v1Fixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await dialog.getByRole('radio',{name:/^m-pesa$/i,exact:true}).check();await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0713339196');await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(1);
  f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();const checks=f.checks.length;await dialog.getByRole('button',{name:'Try again',exact:true}).click();await expect.poll(()=>f.commands.length).toBe(2);await expect.poll(()=>f.sdkCommands.length).toBe(2);expect(f.checks.length).toBeGreaterThan(checks);expect(f.commands[1]).toMatchObject({phone:'251713339196',paymentMethod:'mpesa',flow:'INLINE'});expect(f.commands[1].key).not.toBe(f.commands[0].key);expect(f.sdkCommands[1].tx_ref).not.toBe(f.sdkCommands[0].tx_ref);expect(f.sdkCommands[1].amount).toBe('10.00');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('a changed retry quote returns to review before any fresh payment is initialized',async({page},info)=>{
 test.skip(info.project.name!=='360','One changed-price retry check.');const f=await v1Fixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(1);f.setOrder({status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',providerReasonCode:'INSUFFICIENT_FUNDS'});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();f.setFee(1200);await dialog.getByRole('button',{name:'Try again',exact:true}).click();await expect(dialog.locator('[data-bid-step="review"]')).toBeVisible();await expect(dialog).toContainText('12.00');expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(1);await expect(page.getByRole('dialog')).toHaveCount(1);
 }finally{await f.cleanup()}
});

test('background time and transient verification errors retain the original v1 attempt without a new SDK charge',async({page},info)=>{
 test.skip(info.project.name!=='360','One background and same-attempt recovery check.');const f=await v1Fixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(1);await expect.poll(()=>f.checks.length).toBeGreaterThan(0);const id=f.order().id;
  await page.clock.install();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});const checks=f.checks.length;await page.clock.runFor(360000);expect(f.checks).toHaveLength(checks);f.setUnavailable(true);await wakePayment(page);await expect.poll(()=>f.checks.length).toBeGreaterThan(checks);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(1);expect(new Set(f.checks)).toEqual(new Set([id]));expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('top-up Change payment does not charge and confirmed Try again preserves the edited payer details',async({page},info)=>{
 test.skip(info.project.name!=='360','One shared top-up retry check.');const f=await v1Fixture(page);
 try{
  await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[],page:1,nextPage:null}}));await page.goto('/payments');await page.getByRole('button',{name:'Top up',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode="decimal"]').fill('35');await dialog.locator('[data-top-up-continue]').click();await dialog.getByRole('radio',{name:/^m-pesa$/i,exact:true}).check();await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0713339196');await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(1);
  f.setOrder({status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',providerReasonCode:'INVALID_PIN'});await wakePayment(page);await expect(dialog).toContainText('incorrect payment PIN');await expect(dialog.locator('input[type="password"],input[autocomplete="one-time-code"]')).toHaveCount(0);await dialog.getByRole('button',{name:'Change payment',exact:true}).click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();expect(f.commands).toHaveLength(1);await expect(dialog.getByRole('radio',{name:/^m-pesa$/i,exact:true})).toBeChecked();await expect(dialog.getByRole('textbox',{name:'Payment phone number',exact:true})).toHaveValue('713339196');
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0911652904');expect(f.commands).toHaveLength(1);await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(2);f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Try again',exact:true}).click();await expect.poll(()=>f.commands.length).toBe(3);expect(f.commands[2]).toMatchObject({purpose:'TOP_UP',amount:'35.00',phone:'251911652904',paymentMethod:'telebirr',flow:'INLINE'});expect(f.commands[2].key).not.toBe(f.commands[1].key);await expect(page.getByRole('dialog')).toHaveCount(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('top-up CBE Bank guide returns a blank-phone draft to correction without creating a payment',async({page},info)=>{
 test.skip(info.project.name!=='360','One hosted phone-correction check.');const f=await v1Fixture(page);
 try{
  await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[],page:1,nextPage:null}}));await page.goto('/payments');await page.getByRole('button',{name:'Top up',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode="decimal"]').fill('35');await dialog.locator('[data-top-up-continue]').click();await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('');await dialog.getByRole('radio',{name:'CBE Bank',exact:true}).click();await expect(dialog.locator('[data-cbe-bank-guide]')).toBeVisible();await expect(dialog.getByRole('button',{name:'Continue to payment',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Continue to payment',exact:true}).click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect(dialog.getByRole('alert')).toContainText('Enter a complete');expect(f.commands).toHaveLength(0);await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0911652904');await dialog.locator('[data-payment-action]').click();await expect(dialog.locator('[data-cbe-bank-guide]')).toBeVisible();await dialog.getByRole('button',{name:'Continue to payment',exact:true}).click();await expect.poll(()=>f.commands.length).toBe(1);expect(f.commands[0]).toMatchObject({purpose:'TOP_UP',amount:'35.00',flow:'HOSTED',paymentMethod:'cbe-bank',phone:'251911652904'});expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

for(const am of [false,true])test(`top-up shares secure form without self-funding and waits for committed credit ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await v1Fixture(page,am);let available='25.00';
 try{
  await page.route('**/api/wallet',route=>route.fulfill({json:{available,held:'0.00',revision:'0',bidsEnabled:true,currency:'ETB',topUp:{enabled:true,reason:null}}}));await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[],page:1,nextPage:null}}));
  await page.goto('/payments');await page.getByRole('button',{name:am?'ገንዘብ ያስገቡ':'Top up',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode="decimal"]').fill('35');await dialog.locator('[data-top-up-continue]').click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect(dialog.getByRole('radio',{name:am?'Lowwin ዋሌት':'Lowwin Wallet',exact:true})).toHaveCount(0);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.screenshot({path:info.outputPath('v1-topup-form-'+(am?'am':'en')+'.png')});await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);expect(f.commands[0]).toMatchObject({purpose:'TOP_UP',amount:'35.00',flow:'INLINE'});await expect.poll(()=>f.sdkCommands.length).toBe(1);expect(f.sdkCommands[0].amount).toBe('35.00');
  await dialog.screenshot({path:info.outputPath(`v1-processing-${am?'am':'en'}.png`)});f.setOrder({status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await sdkSignal(page,'success',{status:'success'});await expect(dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true})).toHaveCount(0);await expect(page.locator('[data-transactions-balance]')).toHaveText('25.00 ETB');
  available='60.00';f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true})).toBeVisible();await dialog.screenshot({path:info.outputPath(`v1-topup-success-${am?'am':'en'}.png`)});await dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('[data-transactions-balance]')).toHaveText('60.00 ETB');expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.cleanup()}
});
