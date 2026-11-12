import {expect,test} from '@playwright/test';
import {inlineFixture,selectBids,wakePayment} from '../checkout-v2-inline-browser/fixtures';

for(const am of [false,true])test(`compact authorization updates the same modal with a confirmed provider error ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await inlineFixture(page,am);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();
  await dialog.locator('[data-payment-action]').click();
  const progress=dialog.locator('[data-payment-progress]');
  await expect(progress).toHaveAttribute('data-payment-progress','authorization');
  await progress.evaluate(node=>{(node as HTMLElement).dataset.instanceMarker='same-attempt'});
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(progress.locator('dl>div')).toHaveCount(4);
  expect((await dialog.boundingBox())!.height).toBeLessThan(Math.min(560,(page.viewportSize()?.height??800)-40));
  await dialog.screenshot({path:info.outputPath(`authorization-waiting-${am?'am':'en'}.png`),animations:'disabled'});
  f.setOrder({status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',providerReasonCode:'INVALID_PIN'});
  await wakePayment(page);
  await expect(progress).toHaveAttribute('data-payment-progress','terminal');
  await expect(progress).toHaveAttribute('data-instance-marker','same-attempt');
  await expect(progress.locator('[data-payment-reason]')).toHaveCount(1);
  if(!am)await expect(progress.locator('[data-payment-reason]')).toContainText('incorrect payment PIN');
  await expect(dialog.locator('input')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true})).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect((await dialog.boundingBox())!.height).toBeLessThan(Math.min(560,(page.viewportSize()?.height??800)-40));
  await dialog.screenshot({path:info.outputPath(`authorization-pin-error-${am?'am':'en'}.png`),animations:'disabled'});
  expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
