import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from '../chapa-browser/fixtures';
import type {BidBatchReceipt} from '../../src/lib/bid-batch-client';
import {inlineFixture,openBid,selectBids,wakePayment} from './fixtures';

for(const am of [false,true])test(`v2 method selection preserves bid rules and exact fee totals ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await inlineFixture(page,am);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]').first();
  await input.fill('1.001');await expect(input).toHaveValue('');await dialog.getByRole('switch').click();await input.fill('324');await dialog.locator('[data-bid-add]').click();await input.fill('324.0');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await input.fill('326.25');await expect(dialog.locator('[data-bid-total]')).toContainText('20.00');expect(f.commands).toHaveLength(0);
  await expect(dialog.getByRole('radio')).toHaveCount(4);await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  await dialog.getByRole('radio',{name:/^m-pesa$/i}).check();const phone=dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true});await phone.fill('0911652904');await expect(phone).toHaveAttribute('aria-invalid','true');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await phone.fill('+251 713 339 196');await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);await expect.poll(()=>dialog.locator('[data-chapa-methods] img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);expect(await dialog.locator('[data-sheet-body]').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await dialog.screenshot({path:info.outputPath(`v2-inline-payment-${am?'am':'en'}.png`)});
  await dialog.getByRole('radio',{name:'Lowwin Wallet',exact:true}).check();await expect(phone).toHaveCount(0);await expect(dialog.locator('[data-payment-action]')).toBeEnabled();expect(f.commands).toHaveLength(0);await expect(page.getByRole('dialog')).toHaveCount(1);
 }finally{await f.cleanup()}
});

test('v2 USSD uses one server attempt and succeeds only after accepted bids',async({page},info)=>{
 test.skip(info.project.name!=='360','One full same-attempt lifecycle.');const f=await inlineFixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title,['4.25','5.50']);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(dialog.locator('[data-payment-action]')).toBeEnabled();await dialog.locator('[data-payment-action]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>f.commands.length).toBe(1);await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();await expect(dialog).toContainText('Approve the payment request on your phone.');expect(f.commands[0]).toMatchObject({flow:'INLINE',purpose:'BID',phone:'251911652904',paymentMethod:'telebirr'});expect(f.order().amountCents).toBe('2000');
  await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(0);expect(f.sdkLoads).toHaveLength(0);const original=f.order().id;await page.clock.install();await page.clock.runFor(95000);await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();expect(f.commands).toHaveLength(1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});const count=f.checks.length;await page.clock.runFor(60000);expect(f.checks).toHaveLength(count);f.setUnavailable(true);await wakePayment(page);await expect.poll(()=>f.checks.length).toBeGreaterThan(count);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();
  f.setUnavailable(false);f.setOrder({status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(dialog.locator('[data-payment-progress="confirming"]')).toBeVisible();await expect(dialog.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);f.acceptBids();await wakePayment(page);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();await expect(dialog).toContainText('2 bids accepted');expect(new Set(f.checks)).toEqual(new Set([original]));expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('lost v2 initialization reply restores the original key without another initialization',async({page},info)=>{
 test.skip(info.project.name!=='360','One interrupted initialization check.');const f=await inlineFixture(page);f.interruptNextInitialization();
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=await selectBids(page,f.title);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);await dialog.getByRole('button',{name:'Close',exact:true}).first().click();dialog=await openBid(page,f.title);await expect.poll(()=>f.resolutions.length).toBeGreaterThan(0);await expect.poll(()=>f.checks.length).toBeGreaterThan(0);expect(new Set(f.resolutions)).toEqual(new Set([f.commands[0].key]));expect(f.commands).toHaveLength(1);expect(f.sdkLoads).toHaveLength(0);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Try again',exact:true})).toBeVisible();expect(f.commands).toHaveLength(1);
 }finally{await f.cleanup()}
});

test('confirmed cancellation changes payment with the draft preserved before another explicit Pay',async({page},info)=>{
 test.skip(info.project.name!=='360','One terminal correction lifecycle.');const f=await inlineFixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);await dialog.getByRole('radio',{name:/^m-pesa$/i}).check();await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0713339196');await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Change payment',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Change payment',exact:true}).click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect(dialog.getByRole('radio',{name:/^m-pesa$/i})).toBeChecked();await expect(dialog.getByRole('textbox',{name:'Payment phone number',exact:true})).toHaveValue('713339196');await expect(dialog).toContainText('4.25');expect(f.commands).toHaveLength(1);await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(2);expect(f.commands[1].key).not.toBe(f.commands[0].key);expect(f.commands[1]).toMatchObject({phone:'251713339196',paymentMethod:'mpesa'});expect(f.sdkLoads).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('provider-requested OTP stays in the same modal and does not request a wallet PIN',async({page},info)=>{
 test.skip(info.project.name!=='360','One OTP authorization lifecycle.');const f=await inlineFixture(page);f.setAuthType('OTP');
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);await dialog.getByRole('radio',{name:'CBE Birr',exact:true}).check();await dialog.locator('[data-payment-action]').click();const code=dialog.getByLabel('One-time code',{exact:true});await expect(code).toBeVisible();await expect(dialog).toContainText('Never enter your wallet PIN here.');await code.fill('123456');f.rejectNextOtp();await dialog.getByRole('button',{name:'Confirm code',exact:true}).click();await expect(dialog.locator('[data-payment-reason]')).toContainText('That code was not accepted');await expect(code).toBeVisible();expect(f.commands).toHaveLength(1);await code.fill('654321');await dialog.getByRole('button',{name:'Confirm code',exact:true}).click();await expect.poll(()=>f.authorizations.length).toBe(2);f.acceptBids();await wakePayment(page);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(f.commands).toHaveLength(1);expect(f.sdkLoads).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

for(const am of [false,true])test(`top-up uses the same v2 form and waits for committed wallet credit ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await inlineFixture(page,am);
 try{
  await page.goto('/payments');await page.getByRole('button',{name:am?'ገንዘብ ያስገቡ':'Top up',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode="decimal"]').fill('35');await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect(dialog.getByRole('radio',{name:am?'Lowwin ዋሌት':'Lowwin Wallet',exact:true})).toHaveCount(0);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.screenshot({path:info.outputPath(`v2-topup-payment-${am?'am':'en'}.png`)});await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);expect(f.commands[0]).toMatchObject({purpose:'TOP_UP',amount:'35.00',flow:'INLINE'});await expect(dialog.locator('[data-payment-progress="authorization"]')).toBeVisible();f.setOrder({status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true})).toHaveCount(0);await expect(page.locator('[data-transactions-balance]')).toHaveText('25.00 ETB');f.setBalance('60.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true})).toBeVisible();await dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true}).click();await expect(page.locator('[data-transactions-balance]')).toHaveText('60.00 ETB');expect(f.commands).toHaveLength(1);expect(f.sdkLoads).toHaveLength(0);expect(f.unexpected).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.cleanup()}
});

test('new bid checkout limits selection to its four requested methods even when extra methods are configured',async({page},info)=>{
 test.skip(info.project.name!=='360','One method whitelist check.');const f=await inlineFixture(page);
 try{await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);await expect(dialog.getByRole('radio')).toHaveCount(4);await expect(dialog.getByRole('radio',{name:'CBE Bank',exact:true})).toHaveCount(0);await expect(dialog.getByRole('radio',{name:'eBirr',exact:true})).toHaveCount(0);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);expect(f.unexpected).toHaveLength(0)}finally{await f.cleanup()}
});

test('a historical v1 Inline return restores its owned payment without a new v2 charge or SDK replay',async({page},info)=>{
 test.skip(info.project.name!=='360','One protocol-isolated historical return.');const id=randomUUID(),f=await fixture(page,false,'chapa_'+id),original={...pending({key:randomUUID(),purpose:'TOP_UP',amount:'40.00'},id),apiVersion:'v1',flowVersion:3,chargeType:'INLINE',checkoutUrl:null,paymentMethod:'telebirr',payerPhoneMasked:'251*****2904',verificationState:'UNVERIFIED'};let complete=false,checks=0,creates=0,sdkLoads=0;
 try{
  await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
  await page.route('**/vendor/chapa-inline-v1*.js',route=>{sdkLoads++;return route.abort()});
  await page.route('**/api/payments/chapa/inline',route=>{creates++;return route.abort()});
  await page.route('**/api/payments/chapa/v1',route=>{creates++;return route.abort()});
  await page.route('**/api/payments/chapa/checkouts/**',route=>{if(route.request().method()==='POST')checks++;return route.fulfill({json:{...original,...(complete?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}})});
  await page.goto('/telegram');const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-payment-progress="confirming"]')).toBeVisible();await expect.poll(()=>checks).toBeGreaterThan(0);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);expect(creates).toBe(0);expect(sdkLoads).toBe(0);complete=true;await wakePayment(page);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(creates).toBe(0);expect(sdkLoads).toBe(0);
 }finally{await f.db.$disconnect()}
});

test('wallet bidding stays atomic in the UI while v2 external methods are unavailable',async({page},info)=>{
 test.skip(info.project.name!=='360','One internal-wallet independence lifecycle.');const f=await inlineFixture(page),receipts=new Map<string,BidBatchReceipt>();let available='25.00',walletRequests=0,debits=0;
 try{
  await page.route('**/api/payments/chapa/inline/config',route=>route.fulfill({status:503,json:{code:'UNAVAILABLE',error:'Synthetic external outage'}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{available,held:'0.00',revision:String(debits),currency:'ETB',bidsEnabled:true,topUp:{enabled:true,reason:null}}}));
  await page.route(/\/api\/payments\/chapa\/batches\/[^/]+\/wallet$/,route=>{
   walletRequests++;const id=new URL(route.request().url()).pathname.split('/').at(-2)!,quote=f.quotes.find(quote=>quote.id===id)!;let receipt=receipts.get(id);
   if(!receipt){
    debits++;available='5.00';const acceptedAt=new Date().toISOString(),accepted=quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:String(f.auction.publicCode),auctionSlug:quote.auctionSlug,amount:line.number,acceptedAt,termsVersion:quote.feeVersion,feePoints:line.grossFee},charge:{feePoints:line.grossFee,discountPoints:line.discount,netFeePoints:line.netFee,newlyUnavailable:line.netFee}}));
    receipt={batch:{...quote,status:'ACCEPTED'},receipts:accepted,wallet:{available,held:'0.00',revision:String(debits)},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:quote.total,acceptedBidIds:accepted.map(({bid})=>bid.id)}};receipts.set(id,receipt);
   }
   return route.fulfill({json:receipt});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title,['4.25','5.50']);await dialog.getByRole('radio',{name:'Lowwin Wallet',exact:true}).check();await expect(dialog.getByRole('textbox',{name:'Payment phone number',exact:true})).toHaveCount(0);await expect(dialog.locator('[data-payment-action]')).toBeEnabled();await expect(dialog.locator('[data-payment-action]')).toContainText('20.00');await dialog.locator('[data-payment-action]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();await expect(dialog).toContainText('Internal wallet');await expect(page.locator('[data-header-balance]')).toContainText('5.00');expect(walletRequests).toBe(1);expect(debits).toBe(1);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);expect(f.checks).toHaveLength(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
