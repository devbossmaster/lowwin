import {expect,test} from '@playwright/test';
import {inlineFixture,openBid,walletFixture} from '../checkout-v2-inline-browser/fixtures';

for(const am of [false,true])test(`multiple-bid review preserves draft and mobile navigation ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await inlineFixture(page,am),wallet=await walletFixture(page,f);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const nav=page.locator('.mini-bottom-navigation');await expect(nav).toBeVisible();
  expect(await nav.evaluate(node=>[...node.children].map(child=>child.tagName==='A'?new URL((child as HTMLAnchorElement).href).pathname:'bid'))).toEqual(['/','/my-bids','bid','/winners','/profile']);
  const center=nav.locator('[data-bid=true] button');await expect(center).toHaveAttribute('aria-haspopup','dialog');
  const geometry=await nav.evaluate(node=>{const box=node.getBoundingClientRect(),button=node.querySelector('[data-bid=true] button')!.getBoundingClientRect();return {height:box.height,centerError:Math.abs(button.x+button.width/2-innerWidth/2),raised:button.top<box.top,overflow:document.documentElement.scrollWidth>innerWidth+1,targets:[...node.querySelectorAll('a,button')].filter(item=>item.getClientRects().length).map(item=>{const r=item.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right}})}});
  expect(geometry.height).toBeGreaterThanOrEqual(66);expect(geometry.height).toBeLessThanOrEqual(68);expect(geometry.centerError).toBeLessThan(1);expect(geometry.raised).toBe(true);expect(geometry.overflow).toBe(false);expect(geometry.targets.every(item=>item.width>=44&&item.height>=44&&item.left>=0&&item.right<=page.viewportSize()!.width+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`bottom-nav-${am?'am':'en'}.png`),animations:'disabled',clip:{x:0,y:page.viewportSize()!.height-110,width:page.viewportSize()!.width,height:110}});
  await center.click();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.locator('#quick-auction-panel')).toBeVisible();await page.getByRole('dialog').locator('[data-sheet-close]').click();await expect(page.getByRole('dialog')).toHaveCount(0);

  const dialog=await openBid(page,f.title),entry=dialog.locator('[data-bid-step=entry]'),input=entry.locator('input[inputmode=decimal]').first(),primary=dialog.locator('[data-payment-action]');
  await input.fill('4.25');await primary.click();await expect(dialog.locator('[data-bid-step=payment]')).toBeVisible();await expect(dialog.locator('[data-bid-step=review]')).toHaveCount(0);expect(f.quoteRequests).toHaveLength(0);expect(f.commands).toHaveLength(0);expect(wallet.commands).toHaveLength(0);
  await dialog.locator('[data-bid-step=payment]').getByRole('button',{name:am?'ያስተካክሉ':'Edit',exact:true}).click();await expect(entry).toBeVisible();await expect(entry.getByRole('button',{name:am?'4.25 ያስወግዱ':'Remove 4.25',exact:true})).toBeVisible();
  // Continue includes a valid number still in the input, once, without requiring Add.
  await input.fill('5.50');await primary.click();const review=dialog.locator('[data-bid-step=review]');await expect(review).toBeVisible();await expect(review.getByRole('listitem')).toHaveText(['4.25','5.50']);await expect(dialog.locator('[data-bid-total]')).toContainText('20.00');await expect(dialog.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(1);expect(f.quoteRequests).toHaveLength(0);expect(f.commands).toHaveLength(0);expect(wallet.commands).toHaveLength(0);
  await dialog.screenshot({path:info.outputPath(`multiple-review-${am?'am':'en'}.png`),animations:'disabled'});
  await dialog.getByRole('button',{name:am?'ጨረታዎችን ያስተካክሉ':'Edit bids',exact:true}).click();await expect(entry).toBeVisible();await expect(input).toHaveValue('');await expect(entry.getByRole('button',{name:am?'5.50 ያስወግዱ':'Remove 5.50',exact:true})).toBeVisible();await primary.click();await expect(review).toBeVisible();expect(f.quoteRequests).toHaveLength(0);await primary.click();await expect(dialog.locator('[data-bid-step=payment]')).toBeVisible();
  await dialog.getByRole('radio',{name:/^m-pesa$/i}).check();const phone=dialog.locator('input[type=tel]');await phone.fill('0713339196');await expect(primary).toBeEnabled();await expect.poll(()=>f.quoteRequests.length).toBe(1);expect(f.commands).toHaveLength(0);expect(wallet.commands).toHaveLength(0);const quotesBeforeBack=f.quoteRequests.length;
  await page.goBack();await expect(review).toBeVisible();await expect(review.getByRole('listitem')).toHaveText(['4.25','5.50']);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(f.quoteRequests).toHaveLength(quotesBeforeBack);expect(f.commands).toHaveLength(0);expect(wallet.commands).toHaveLength(0);
  await page.goBack();await expect(entry).toBeVisible();await expect(entry.getByRole('button',{name:am?'4.25 ያስወግዱ':'Remove 4.25',exact:true})).toBeVisible();await expect(entry.getByRole('button',{name:am?'5.50 ያስወግዱ':'Remove 5.50',exact:true})).toBeVisible();await primary.click();await expect(review).toBeVisible();await primary.click();await expect(dialog.locator('[data-bid-step=payment]')).toBeVisible();await expect(dialog.getByRole('radio',{name:/^m-pesa$/i})).toBeChecked();await expect(phone).toHaveValue('713339196');expect(f.commands).toHaveLength(0);expect(wallet.commands).toHaveLength(0);
  if(!am&&info.project.name==='360'){
   await dialog.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await expect(phone).toHaveCount(0);await primary.dispatchEvent('click',{detail:2});expect(wallet.commands.length+wallet.knownPosts.length).toBe(0);await primary.click();await expect(dialog.locator('[data-wallet-bid-progress=success]')).toBeVisible();expect(wallet.commands.length+wallet.knownPosts.length).toBe(1);expect(wallet.debits()).toBe(1);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);await dialog.screenshot({path:info.outputPath('multiple-wallet-receipt.png'),animations:'disabled'});
  }
  expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
