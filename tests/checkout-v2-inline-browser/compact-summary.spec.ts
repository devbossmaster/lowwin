import {expect,test} from '@playwright/test';
import {inlineFixture,selectBids,continueToBidPayment} from './fixtures';

for(const am of [false,true])test(`compact payment summary keeps numbers, Edit and total readable ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await inlineFixture(page,am);
 try{
  const title=f.title+' · Rugga’s 45W 20,000mAh Power Bank with fast charging';
  const titleAm=f.title+' · የሩጋ 45W 20,000mAh ፓወር ባንክ ፈጣን ቻርጅ';
  await f.db.product.update({where:{id:f.auction.productId!},data:{title,titleAm}});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const firstQuote=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/payments/chapa/batches/quote');
  const dialog=await selectBids(page,f.title,['66.00']),summary=dialog.locator('[data-bid-payment-summary]');await(await firstQuote).finished();await expect.poll(()=>f.quoteRequests.length).toBe(1);
  await expect(summary.getByRole('heading')).toHaveText(am?titleAm:title);
  await expect(summary).toContainText('66.00');
  await expect(summary).not.toContainText('ETB');
  await expect(summary).not.toContainText('Your bids are ready');
  await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');
  const inspect=()=>summary.evaluate(node=>{
   const box=node.getBoundingClientRect(),edit=node.querySelector('button')!.getBoundingClientRect();
   return {height:box.height,left:box.left,right:box.right,overflow:node.scrollWidth>node.clientWidth,editHeight:edit.height};
  });
  let box=await inspect();expect(box.height).toBeLessThanOrEqual(144);expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(page.viewportSize()!.width);expect(box.overflow).toBe(false);expect(box.editHeight).toBeGreaterThanOrEqual(44);
  await dialog.screenshot({path:info.outputPath(`compact-payment-${am?'am':'en'}.png`),animations:'disabled'});
  await summary.getByRole('button',{name:am?'ያስተካክሉ':'Edit',exact:true}).click();
  const input=dialog.locator('[data-bid-step=entry] input[inputmode=decimal]').first();
  for(const number of ['68.25','70.50']){await input.fill(number);await dialog.locator('[data-bid-add]').click()}
  await continueToBidPayment(dialog);
  await expect(summary).toContainText(am?'3 ጨረታዎች':'3 bids');await expect(summary).toContainText('66.00, 68.25, 70.50');
  await expect(dialog.locator('[data-bid-total]')).toContainText('30.00');
  box=await inspect();expect(box.height).toBeLessThanOrEqual(144);expect(box.overflow).toBe(false);
  await dialog.screenshot({path:info.outputPath(`compact-payment-multiple-${am?'am':'en'}.png`),animations:'disabled'});
  await expect.poll(()=>f.quoteRequests.length).toBe(2);expect(f.commands).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.db.$disconnect()}
});
