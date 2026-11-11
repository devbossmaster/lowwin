import {expect,test} from '@playwright/test';
import {openBid,v1Fixture} from './fixtures';

for(const am of [false,true]){
 test(`single bid goes directly to secure payment; multi-bid review preserves exact fee totals ${am?'AM':'EN'}`,async({page},info)=>{
  const f=await v1Fixture(page,am);
  try{
   await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),entry=dialog.locator('[data-bid-step="entry"]'),input=entry.locator('input[inputmode="decimal"]'),add=entry.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true});
   await expect(entry).toBeVisible();await expect(add).toBeDisabled();await expect(dialog.locator('[data-bid-continue]')).toBeDisabled();
   await input.fill('1.001');await expect(input).toHaveValue('');await input.fill('324');await expect(add).toBeEnabled();await add.click();await expect(input).toHaveValue('');await expect(entry.getByRole('button',{name:am?'324.00 ያስወግዱ':'Remove 324.00',exact:true})).toBeVisible();
   await input.fill('324.0');await expect(add).toBeDisabled();await expect(entry.getByRole('alert')).toBeVisible();await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');
   await input.fill('');await dialog.locator('[data-bid-continue]').click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect.poll(()=>f.quotes.length).toBe(1);expect(f.quotes[0].lines.map(line=>line.number)).toEqual(['324.00']);expect(f.commands).toHaveLength(0);
   await dialog.getByRole('button',{name:am?'ተመለስ':'Back',exact:true}).click();await expect(entry).toBeVisible();await input.fill('326.25');await expect(dialog.locator('[data-bid-total]')).toContainText('20.00');await dialog.screenshot({path:info.outputPath(`v1-entry-${am?'am':'en'}.png`)});
   await dialog.locator('[data-bid-continue]').click();await expect(dialog.locator('[data-bid-step="review"]')).toBeVisible();await expect(dialog.locator('[data-review-bids]')).toContainText('324.00');await expect(dialog.locator('[data-review-bids]')).toContainText('326.25');expect(f.commands).toHaveLength(0);
   await expect(dialog).toContainText('20.00');await expect(dialog).toContainText('25.00');await expect(dialog.getByRole('button',{name:am?'በደህና ይክፈሉ':'Pay securely',exact:true})).toBeEnabled();await dialog.screenshot({path:info.outputPath(`v1-review-${am?'am':'en'}.png`)});await dialog.getByRole('button',{name:am?'መጠኖችን ያስተካክሉ':'Edit amounts',exact:true}).click();await entry.getByRole('button',{name:am?'326.25 ያስወግዱ':'Remove 326.25',exact:true}).click();await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');await input.fill('326.25');await dialog.locator('[data-bid-continue]').click();await expect(dialog.locator('[data-review-bids]')).toContainText('326.25');await dialog.getByRole('button',{name:am?'በደህና ይክፈሉ':'Pay securely',exact:true}).click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect(dialog.getByRole('radio')).toHaveCount(6);
   await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await dialog.getByRole('radio',{name:/^m-pesa$/i,exact:true}).check();const phone=dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true});await phone.fill('0911652904');await expect(dialog.locator('[data-payment-phone-error]')).toBeVisible();await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
   await phone.fill('+251 713 339 196');await expect(dialog.locator('[data-payment-action]')).toBeEnabled();await expect(phone).not.toHaveValue(/251251/);expect(f.commands).toHaveLength(0);await phone.fill('0211652904');await expect(dialog.locator('[data-payment-phone-error]')).toBeVisible();await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
   await dialog.getByRole('radio',{name:am?'Lowwin ዋሌት':'Lowwin Wallet',exact:true}).check();await expect(phone).toHaveCount(0);await expect(dialog.locator('[data-payment-action]')).toBeEnabled();expect(f.commands).toHaveLength(0);
   expect(await dialog.locator('[data-sheet-body]').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await expect(page.getByRole('dialog')).toHaveCount(1);await dialog.screenshot({path:info.outputPath(`v1-payment-${am?'am':'en'}.png`)});
  }finally{await f.cleanup()}
 });
}

test('CBE Bank guide stays inside the original sheet and starts only one owned hosted attempt',async({page},info)=>{
 test.skip(info.project.name!=='360','One hosted lifecycle check.');const f=await v1Fixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');await dialog.locator('[data-bid-continue]').click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();
  await dialog.getByRole('radio',{name:'CBE Bank',exact:true}).click();await expect(dialog.locator('[data-cbe-bank-guide]')).toBeVisible();await expect(dialog.locator('video')).toHaveAttribute('controls','');expect(f.commands).toHaveLength(0);await expect(page.getByRole('dialog')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Continue to payment',exact:true}).click();await expect.poll(()=>f.commands.length).toBe(1);expect(f.commands[0]).toMatchObject({flow:'HOSTED',purpose:'BID'});await expect(dialog.getByRole('button',{name:'Open payment page',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Open payment page',exact:true}).click();expect(f.commands).toHaveLength(1);await dialog.getByRole('button',{name:'Check payment status',exact:true}).click();expect(f.commands).toHaveLength(1);expect(f.checks.length).toBeGreaterThan(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
