import {expect,test} from '@playwright/test';
import {inlineFixture,openBid,selectBids,wakePayment,walletFixture} from './fixtures';

for(const am of [false,true])test(`bid readiness starts before method choice and method changes never freeze Pay ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await inlineFixture(page,am);let release!:()=>void,reads=0;
 const gate=new Promise<void>(done=>{release=done});
 await page.route('**/api/payments/chapa/batches/quote',async route=>{reads++;await gate;return route.fallback()});
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);await expect.poll(()=>reads).toBe(1);
  const pay=dialog.locator('[data-payment-action]');
  for(const method of ['telebirr','CBE Birr','M-Pesa','LowWin Wallet','telebirr']){await dialog.getByRole('radio',{name:method,exact:true}).check();await expect(pay).toBeEnabled();await expect(pay).toHaveAttribute('aria-busy','false');expect(reads).toBe(1);expect(f.commands).toHaveLength(0)}
  await pay.click();await expect(dialog.locator('[data-payment-panel=persistent]')).toBeVisible();expect(reads).toBe(1);expect(f.commands).toHaveLength(0);
  const feedback=await page.evaluate(()=>performance.getEntriesByName('lowwin:payment:tap-to-feedback','measure').at(-1)?.duration??null);expect(feedback).not.toBeNull();expect(feedback!).toBeLessThan(1000);
  await info.attach('readiness-timing',{body:JSON.stringify({tapToFeedbackMs:feedback,quoteRequestsBeforeRelease:reads,providerCommandsBeforeRelease:f.commands.length}),contentType:'application/json'});
  release();await expect.poll(()=>f.commands.length).toBe(1);await expect(dialog.locator('[data-payment-progress=authorization]')).toBeVisible();expect(reads).toBe(1);expect(f.quoteRequests).toHaveLength(1);
  f.acceptBids();await wakePayment(page);await expect(dialog.locator('[data-payment-state=confirmed]')).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{release();await f.cleanup()}
});

test('wallet Pay cannot reuse an in-flight background quote key or create an external charge',async({page})=>{
 const f=await inlineFixture(page),wallet=await walletFixture(page,f);let release!:()=>void,quoteKey='';
 const gate=new Promise<void>(done=>{release=done});
 await page.route('**/api/payments/chapa/batches/quote',async route=>{quoteKey=route.request().postDataJSON().key;await gate;return route.fallback()});
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);await expect.poll(()=>quoteKey).not.toBe('');await dialog.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-wallet-bid-progress=success]')).toBeVisible();expect(wallet.commands).toHaveLength(1);expect(wallet.commands[0].key).not.toBe(quoteKey);expect(wallet.debits()).toBe(1);expect(f.commands).toHaveLength(0);
  release();await wakePayment(page);await expect(dialog.locator('[data-wallet-bid-progress=success]')).toBeVisible();expect(wallet.debits()).toBe(1);expect(f.commands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{release();await f.cleanup()}
});

test('Continue prepares the bid quote while settings warm and opens choices ready in one sheet',async({page})=>{
 const f=await inlineFixture(page);let release!:()=>void,configReads=0;
 const gate=new Promise<void>(done=>{release=done});
 await page.route('**/api/payments/chapa/direct/current/config',async route=>{configReads++;await gate;return route.fallback()});
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),entry=dialog.locator('[data-bid-step=entry]');await entry.locator('input[inputmode=decimal]').first().fill('4.25');await expect.poll(()=>configReads).toBe(1);
  await dialog.locator('[data-payment-action]').click();await expect(entry).toBeVisible();await expect(dialog.locator('[data-bid-step=payment]')).toHaveCount(0);await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await expect.poll(()=>f.quoteRequests.length).toBe(1);expect(f.commands).toHaveLength(0);expect(configReads).toBe(1);
  release();await expect(dialog.locator('[data-bid-step=payment]')).toBeVisible();for(const method of ['telebirr','CBE Birr','M-Pesa'])await expect(dialog.getByRole('radio',{name:method,exact:true})).toBeEnabled();await expect(page.getByRole('dialog')).toHaveCount(1);expect(configReads).toBe(1);expect(f.quoteRequests).toHaveLength(1);expect(f.commands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{release();await f.cleanup()}
});
