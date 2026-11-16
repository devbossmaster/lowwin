import {expect,test} from '@playwright/test';
import {inlineFixture,selectBids,walletFixture} from './fixtures';

test('switching external providers keeps one outstanding fee quote without charging',async({page})=>{
 const f=await inlineFixture(page);let release!:()=>void,requests=0,aborted=0;
 const response=new Promise<void>(resolve=>{release=resolve});
 page.on('requestfailed',request=>{if(request.url().endsWith('/batches/quote'))aborted++});
 await page.route('**/api/payments/chapa/batches/quote',async route=>{requests++;await response;try{await route.fallback()}catch{/* The sheet may close while the synthetic response is held. */}});
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:/^telebirr$/i}).check();await expect.poll(()=>requests).toBe(1);
  for(const provider of [/^m-pesa$/i,/^cbe birr$/i])await dialog.getByRole('radio',{name:provider}).check();
  await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0911652904');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(requests).toBe(1);expect(aborted).toBe(0);expect(f.commands).toHaveLength(0);
  release();await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  expect(f.quoteRequests).toHaveLength(1);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);
 }finally{release();await f.db.$disconnect()}
});

test('wallet payment does not wait for an outstanding external fee quote',async({page})=>{
 const f=await inlineFixture(page),wallet=await walletFixture(page,f);let release!:()=>void,requests=0;
 const response=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/payments/chapa/batches/quote',async route=>{requests++;await response;try{await route.fallback()}catch{/* Cancelled quote does not own the wallet payment. */}});
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);
  await dialog.getByRole('radio',{name:/^telebirr$/i}).check();await expect.poll(()=>requests).toBe(1);
  await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  await dialog.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();
  await expect(dialog.getByText('Confirming your total…',{exact:true})).toHaveCount(0);
  await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-wallet-bid-progress=success]')).toBeVisible();
  expect(wallet.commands).toHaveLength(1);expect(wallet.debits()).toBe(1);expect(wallet.knownPosts).toHaveLength(0);
  expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);
 }finally{release();await f.db.$disconnect()}
});
