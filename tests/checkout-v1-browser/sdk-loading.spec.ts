import {expect,test} from '@playwright/test';
import {openBid,sdkSignal,v1Fixture} from './fixtures';

const scriptPath='/vendor/chapa-inline-v1.c9e7f64f.js';

test('a failed SDK connection retries its original configuration without another payment intent',async({page},info)=>{
 test.skip(info.project.name!=='360','One original SDK connection lifecycle check.');
 const f=await v1Fixture(page);let scriptRequests=0;
 try{
  await page.route('**/vendor/chapa-inline-v1*.js',route=>{scriptRequests++;return scriptRequests===1?route.abort('failed'):route.fallback()});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const dialog=await openBid(page,f.title);
  await dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').fill('4.25');
  await dialog.locator('[data-bid-continue]').click();
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();
  await dialog.locator('[data-payment-action]').click();
  await expect.poll(()=>f.commands.length).toBe(1);
  await expect(dialog.getByRole('button',{name:'Retry connection',exact:true})).toBeVisible();
  expect(scriptRequests).toBe(1);expect(f.sdkCommands).toHaveLength(0);
  expect(f.commands[0].flow).toBe('INLINE');
  const originalKey=f.commands[0].key,originalReference=f.order().merchantReference,originalOrder=f.order().id;
  await dialog.getByRole('button',{name:'Retry connection',exact:true}).click();
  await expect.poll(()=>f.sdkCommands.length).toBe(1);
  expect(scriptRequests).toBe(2);expect(f.commands).toHaveLength(1);
  expect(f.commands[0].key).toBe(originalKey);expect(f.order().id).toBe(originalOrder);
  expect(f.sdkCommands[0]).toMatchObject({tx_ref:originalReference,amount:'10.00',mobile:'911652904',availablePaymentMethods:['telebirr']});
  await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByRole('button',{name:'Retry connection',exact:true})).toHaveCount(0);
  // A later SDK failure can be a transport error after provider acceptance.
  // It must check the owned payment instead of reconnecting or changing flow.
  await sdkSignal(page,'failure',{message:'Network connection interrupted'});
  await expect(dialog.getByRole('button',{name:'Retry connection',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
  expect(scriptRequests).toBe(2);expect(f.sdkCommands).toHaveLength(1);expect(f.commands).toHaveLength(1);
  expect(f.commands.every(command=>command.flow==='INLINE')).toBe(true);
  await dialog.getByRole('button',{name:'Close',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(0);
  expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('the pinned SDK asset is public and immutable without an account session',async({playwright,baseURL},info)=>{
 test.skip(info.project.name!=='360','One actual anonymous static-header check.');
 const anonymous=await playwright.request.newContext({baseURL,ignoreHTTPSErrors:true,storageState:{cookies:[],origins:[]}});
 try{
  const response=await anonymous.head(scriptPath);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(response.headers()['content-type']).toContain('javascript');
  expect(response.headers()['set-cookie']).toBeUndefined();
  expect(response.headers()['vary']??'').not.toMatch(/cookie/i);
 }finally{await anonymous.dispose()}
});
