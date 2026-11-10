import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {BidBatchQuote,BidBatchReceipt,ChapaDirectIntent} from '../../src/lib/bid-batch-client';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import {accepted,add,amount,directOrder,edit,expectInViewport,mockBidCommand,openBid,pay,phone,quoteFor,remove,retryOriginal,setup,supportedMethods,tryAgain} from './fixtures';

test('the blank multi-bid form edits chips and prices submission fees with one coupon',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),couponId=randomUUID();let quotes=0,charges=0;
 try{
  await page.route('**/api/auctions/*/bids',async route=>{const response=await route.fetch();return route.fulfill({json:{...await response.json(),referralDiscountsAvailable:true,couponAvailableCount:1}})});
  await page.route('**/api/auctions/*/discount-quote?**',route=>route.fulfill({json:{serverNow:new Date().toISOString(),auctionSlug:f.auction.slug,feeVersion:1,ruleVersion:'lowest-unique-v4',grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',coupon:{id:couponId,percent:10,expiresAt:new Date(Date.now()+3600000).toISOString()},eligible:true}}));
  await page.route('**/api/payments/chapa/batches/quote',route=>{quotes++;return route.abort()});
  await page.route('**/api/payments/chapa/direct',route=>{charges++;return route.abort()});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=amount(dialog,am),funding=dialog.locator('[data-funding-selector]');
  await expect(dialog.locator('input[type="radio"]:checked')).toHaveCount(0);await expect(phone(dialog,am)).toHaveCount(0);await expect(pay(dialog)).toBeDisabled();
  const product=dialog.locator('[data-sheet-preview] img');await expect(product).toBeVisible();await expect.poll(()=>product.evaluate(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0)).toBe(true);await expect(dialog.locator('[data-bid-description]')).toContainText('DEMO fixture');
  await page.screenshot({path:info.outputPath('initial-no-provider.png'),animations:'disabled'});
  await expect(dialog.getByRole('switch')).toHaveCount(0);await expect(dialog.getByText(/^(Single bid|Multiple bids|Multi-bid)$/i)).toHaveCount(0);
  await input.fill('2.34');await input.pressSequentially('5a');await expect(input).toHaveValue('2.34');await expect(add(dialog,am)).toContainText(am?'ጨምር':'Add');await add(dialog,am).click();
  await input.fill('2.34');await expect(add(dialog,am)).toBeDisabled();await expect(input).toHaveAttribute('aria-invalid','true');await expect(pay(dialog)).toBeDisabled();
  await input.fill('600.25');await add(dialog,am).click();await expect(dialog.locator('[data-bid-total]')).toContainText('20.00');
  await edit(dialog,am,'2.34').click();await input.fill('6.25');await dialog.getByRole('button',{name:am?'የጨረታ መጠን ያስቀምጡ':'Save bid amount',exact:true}).click();await expect(edit(dialog,am,'6.25')).toBeVisible();
  await dialog.locator('[data-bid-coupons]').getByRole('button',{name:am?'ተግብር':'Apply',exact:true}).click();await expect(dialog.locator('[data-bid-total]')).toContainText('19.00');
  await expect(edit(dialog,am,'6.25')).toBeVisible();await expect(edit(dialog,am,'600.25')).toBeVisible();await expect(pay(dialog)).toBeDisabled();
  await funding.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await expect(pay(dialog)).toBeEnabled();await expect(phone(dialog,am)).toHaveCount(0);expect(quotes).toBe(0);expect(charges).toBe(0);
  await remove(dialog,am,'600.25').click();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');await dialog.locator('[data-bid-coupons]').getByRole('button',{name:am?'አስወግድ':'Remove',exact:true}).click();await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');
  await page.screenshot({path:info.outputPath('multi-bid-editor.png'),animations:'disabled'});
 
  expect(f.network).toMatchObject({combined:0,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('accepted duplicates, consecutive cent amounts, and remaining submission limits block Pay',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let charges=0;
 try{
  await page.route('**/api/auctions/*/bids',async route=>{const response=await route.fetch();return route.fulfill({json:{...await response.json(),remainingSubmissions:4,ownBids:[{id:randomUUID(),amount:'7.00',acceptedAt:new Date().toISOString()}]}})});
  await page.route('**/api/payments/chapa/direct',route=>{charges++;return route.abort()});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=amount(dialog,am);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');
  await input.fill('7');await expect(add(dialog,am)).toBeDisabled();await expect(pay(dialog)).toBeDisabled();
  for(const value of ['1.00','1.01','1.02']){await input.fill(value);await add(dialog,am).click()}
  await input.fill('1.03');await expect(input).toHaveAttribute('aria-invalid','true');await expect(add(dialog,am)).toBeDisabled();await expect(pay(dialog)).toBeDisabled();
  await input.fill('2');await add(dialog,am).click();await expect(dialog.locator('[data-bid-remaining]')).toContainText('0');await expect(pay(dialog)).toBeEnabled();
  await input.fill('3');await expect(add(dialog,am)).toBeDisabled();await expect(pay(dialog)).toBeDisabled();await remove(dialog,am,'1.02').click();await input.fill('3');await expect(add(dialog,am)).toBeEnabled();await expect(pay(dialog)).toBeEnabled();expect(charges).toBe(0);
  await page.screenshot({path:info.outputPath('multi-bid-limits.png'),animations:'disabled'});
 
  expect(f.network).toMatchObject({combined:0,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('provider selection is explicit, only supported logos render, and phone validation follows selection',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am,supportedMethods.filter(method=>method.slug!=='mpesa'));let quotes=0,charges=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quotes++;return route.abort()});await page.route('**/api/payments/chapa/direct',route=>{charges++;return route.abort()});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),funding=dialog.locator('[data-funding-selector]');await amount(dialog,am).fill('2');
  await expect(funding.getByRole('radio')).toHaveCount(3);await expect(funding.locator('img')).toHaveCount(2);await expect(funding.getByRole('radio',{name:'M-Pesa',exact:true})).toHaveCount(0);await expect(dialog.locator('input[type="radio"]:checked')).toHaveCount(0);
  await expect.poll(()=>funding.locator('img').evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0))).toBe(true);
  await funding.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(phone(dialog,am)).toHaveValue('');await expect(pay(dialog)).toBeDisabled();await phone(dialog,am).fill('0713339196');await expect(phone(dialog,am)).toHaveAttribute('aria-invalid','true');await expect(dialog.locator('[data-payment-phone-error]')).toContainText('telebirr');await expect(pay(dialog)).toBeDisabled();
  await funding.getByRole('radio',{name:'CBE Birr',exact:true}).check();await expect(dialog.locator('[data-payment-phone-error]')).toHaveCount(0);await expect(pay(dialog)).toBeEnabled();
  await funding.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await expect(phone(dialog,am)).toHaveCount(0);await expect(pay(dialog)).toBeEnabled();await funding.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(phone(dialog,am)).toHaveValue('713339196');await expect(pay(dialog)).toBeDisabled();
  await phone(dialog,am).fill('+251911652904');await expect(phone(dialog,am)).toHaveValue('911652904');await expect(pay(dialog)).toBeEnabled();expect(quotes).toBe(0);expect(charges).toBe(0);
  await page.screenshot({path:info.outputPath('explicit-provider-phone.png'),animations:'disabled'});
 
  expect(f.network).toMatchObject({combined:0,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('switching between M-Pesa and telebirr immediately rechecks the external phone prefix',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let quotes=0,charges=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quotes++;return route.abort()});await page.route('**/api/payments/chapa/direct',route=>{charges++;return route.abort()});await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('2');await dialog.getByRole('radio',{name:'M-Pesa',exact:true}).check();
  for(const value of ['0911652904','+251911652904','251 911 652 904']){await phone(dialog,am).fill(value);await expect(phone(dialog,am)).toHaveAttribute('aria-invalid','true');await expect(dialog.locator('[data-payment-phone-error]')).toContainText('M-Pesa');await expect(pay(dialog)).toBeDisabled()}
  await phone(dialog,am).fill('+251713339196');await expect(pay(dialog)).toBeEnabled();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(dialog.locator('[data-payment-phone-error]')).toContainText('telebirr');await expect(pay(dialog)).toBeDisabled();await phone(dialog,am).fill('0911652904');await expect(pay(dialog)).toBeEnabled();expect(quotes).toBe(0);expect(charges).toBe(0);
 
  expect(f.network).toMatchObject({combined:0,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('one stable sheet moves from connecting through phone authorization and confirming to a verified receipt',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 try{
  await mockBidCommand(page,{quote:route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})},direct:async route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order=directOrder(command,quotes.at(-1)!);await gate;return route.fulfill({status:202,json:order})}});
  
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),marker=randomUUID();await dialog.evaluate((node,value)=>node.setAttribute('data-stable-modal',value),marker);await amount(dialog,am).fill('2');await add(dialog,am).click();await amount(dialog,am).fill('600.25');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');
  const feedbackMs=await pay(dialog).evaluate(node=>new Promise<number>(resolve=>{const started=performance.now(),observer=new MutationObserver(()=>{if(!document.querySelector('[data-bid-payment-progress]'))return;observer.disconnect();requestAnimationFrame(()=>resolve(performance.now()-started))});observer.observe(document.body,{childList:true,subtree:true});(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()}));await info.attach('pay-to-visible-feedback',{body:JSON.stringify({milliseconds:feedbackMs,environment:'isolated browser, provider response held pending'}),contentType:'application/json'});expect(feedbackMs).toBeLessThan(1000);await expect(dialog.locator('[data-direct-approval="connecting"]')).toBeVisible();await expect.poll(()=>commands.length).toBe(1);expect(quotes).toHaveLength(1);await expect(dialog).toHaveAttribute('data-stable-modal',marker);await page.screenshot({path:info.outputPath('connecting.png'),animations:'disabled'});
  release();await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();await expect(dialog.locator('input[type="password"],input[autocomplete="one-time-code"]')).toHaveCount(0);await page.screenshot({path:info.outputPath('phone-authorization.png'),animations:'disabled'});
  order={...order!,status:'PENDING',providerStatus:'SUCCESS'};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.locator('[data-direct-approval="confirming"],[data-payment-state="applying"]')).toBeVisible();await page.screenshot({path:info.outputPath('confirming.png'),animations:'disabled'});
  order=accepted(order!);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();await dialog.locator('[data-bid-payment-progress] details').first().locator('summary').click();await expect(dialog).toContainText('2.00');await expect(dialog).toContainText('600.25');await expect(dialog).toContainText('20.00');await expect(dialog).toHaveAttribute('data-stable-modal',marker);await expect(page.getByRole('dialog')).toHaveCount(1);expect(commands).toHaveLength(1);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
  await page.screenshot({path:info.outputPath('confirmed-receipt.png'),animations:'disabled'});
 
  expect(f.network).toMatchObject({combined:1,quotes:0,direct:0});
 }finally{release();await f.cleanup()}
});

test('provider-requested OTP is explicit and a terminal failure retries only after a fresh Pay',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[],authorizations:unknown[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await mockBidCommand(page,{quote:route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})},direct:route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order=directOrder(command,quotes.at(-1)!,commands.length===1?'OTP':'USSD');return route.fulfill({json:order})}});
  
  await page.route('**/api/payments/chapa/checkouts/**',route=>{if(new URL(route.request().url()).pathname.endsWith('/authorize')){authorizations.push(route.request().postDataJSON());order={...order!,status:'CANCELLED',providerStatus:'CANCELLED',providerReasonCode:'PAYMENT_CANCELLED'}}return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('2');await add(dialog,am).click();await amount(dialog,am).fill('3.25');await dialog.getByRole('radio',{name:'CBE Birr',exact:true}).check();await phone(dialog,am).fill('0911652904');await pay(dialog).click();const otp=dialog.locator('input[autocomplete="one-time-code"]');await expect(otp).toBeVisible();await expect(dialog.locator('[data-direct-approval="otp"]')).toBeVisible();expect(authorizations).toHaveLength(0);
  await otp.fill('123456');await page.screenshot({path:info.outputPath('otp.png'),animations:'disabled'});await dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm code',exact:true}).click();await expect(dialog.locator('[data-payment-state="failed"]')).toBeVisible();await expect(otp).toHaveCount(0);await expect(dialog.locator('.lucide-loader-circle')).toHaveCount(0);expect(authorizations).toEqual([{otp:'123456'}]);expect(commands).toHaveLength(1);await expect(tryAgain(dialog,am)).toBeVisible();await expect(dialog.getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).last()).toBeVisible();await page.screenshot({path:info.outputPath('failed.png'),animations:'disabled'});
  await tryAgain(dialog,am).click();await expect(dialog.locator('[data-bid-entry]')).toBeVisible();await expect(edit(dialog,am,'2.00')).toBeVisible();await expect(edit(dialog,am,'3.25')).toBeVisible();await expect(dialog.getByRole('radio',{name:'CBE Birr',exact:true})).toBeChecked();await expect(phone(dialog,am)).toHaveValue('911652904');await expect(pay(dialog)).toBeEnabled();expect(quotes).toHaveLength(1);expect(commands).toHaveLength(1);
  await pay(dialog).click();await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();expect(quotes).toHaveLength(2);expect(commands).toHaveLength(2);expect(quotes[1].id).not.toBe(quotes[0].id);expect(commands[1].key).not.toBe(commands[0].key);expect(commands[1]).toMatchObject({batchId:quotes[1].id,paymentMethod:'cbebirr',phone:'251911652904'});expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
  order={...order!,status:'FAILED',providerStatus:'FAILED'};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.locator('[data-payment-state="failed"]')).toBeVisible();await dialog.locator('[data-sheet-footer]').getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).click();await expect(dialog).toHaveCount(0);expect(commands).toHaveLength(2);
 
  expect(f.network).toMatchObject({combined:2,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('an uncertain transport retries its original quote and key and permits checking the same payment',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null,checks=0;
 try{
  await mockBidCommand(page,{quote:route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})},direct:route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);if(commands.length===1)return route.abort('failed');order={...directOrder(command,quotes[0]),verificationState:'UNAVAILABLE'};return route.fulfill({json:order})}});
  
  await page.route('**/api/payments/chapa/checkouts/**',route=>{checks++;return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('9.25');await dialog.getByRole('radio',{name:'M-Pesa',exact:true}).check();await phone(dialog,am).fill('0713339196');await pay(dialog).click();await expect(retryOriginal(dialog,am)).toBeVisible();await expect(tryAgain(dialog,am)).toHaveCount(0);expect(commands).toHaveLength(1);expect(quotes).toHaveLength(1);await page.screenshot({path:info.outputPath('uncertain-original-request.png'),animations:'disabled'});
  await retryOriginal(dialog,am).click();await expect(dialog.locator('[data-bid-payment-progress="uncertain"]')).toBeVisible();expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(quotes).toHaveLength(1);await expect(tryAgain(dialog,am)).toHaveCount(0);const before=checks;await dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true}).click();await expect.poll(()=>checks).toBeGreaterThan(before);expect(commands).toHaveLength(2);
 
  expect(f.network).toMatchObject({combined:2,quotes:0,direct:0});expect(f.network.commands[1]).toEqual(f.network.commands[0]);
 }finally{await f.cleanup()}
});

test('an uncertain known checkout can retry only its persisted original request and key',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await mockBidCommand(page,{quote:route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})},direct:route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);const ready=directOrder(command,quotes[0]);order=commands.length===1?{...ready,status:'SUBMITTING',providerStatus:null,authType:null,authorizationReference:null,verificationState:'UNAVAILABLE'}:{...ready,id:order!.id};return route.fulfill({status:202,json:order})}});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('2');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');await pay(dialog).click();await expect(dialog.locator('[data-bid-payment-progress="uncertain"]')).toBeVisible();await expect(tryAgain(dialog,am)).toHaveCount(0);await expect(retryOriginal(dialog,am)).toBeVisible();await expect(dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true})).toBeVisible();const checkoutId=order!.id;expect(commands).toHaveLength(1);await page.screenshot({path:info.outputPath('uncertain-known-checkout.png'),animations:'disabled'});
  await retryOriginal(dialog,am).click();await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();expect(quotes).toHaveLength(1);expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(order!.id).toBe(checkoutId);
 
  expect(f.network).toMatchObject({combined:2,quotes:0,direct:0});expect(f.network.commands[1]).toEqual(f.network.commands[0]);
 }finally{await f.cleanup()}
});

test('a definitive initialization rejection safely returns to review and charges again only after a fresh Pay',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await mockBidCommand(page,{quote:route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})},direct:route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);const ready=directOrder(command,quotes.at(-1)!);order=commands.length===1?{...ready,status:'NEEDS_REVIEW',reason:'INITIALIZATION_REJECTED',authType:null,authorizationReference:null,providerStatus:null,verificationState:'UNAVAILABLE',initializationIssue:'request',initializationReasonCode:'PAYMENT_ACCOUNT_NOT_FOUND'}:ready;return route.fulfill({status:202,json:order})}});
  // A provider HTTP 400/422 is recorded by the server and exposed as this
  // owned checkout view; the browser receives no arbitrary provider message.
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('6.25');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');await pay(dialog).click();await expect(dialog.locator('[data-payment-state="failed"]')).toBeVisible();await expect(dialog.locator('[data-payment-reason]')).toContainText('Chapa');await expect(dialog.locator('.lucide-loader-circle')).toHaveCount(0);await expect(retryOriginal(dialog,am)).toHaveCount(0);await expect(tryAgain(dialog,am)).toBeEnabled();expect(commands).toHaveLength(1);await page.screenshot({path:info.outputPath('definitive-initialization-rejection.png'),animations:'disabled'});
  await tryAgain(dialog,am).click();await expect(edit(dialog,am,'6.25')).toBeVisible();await expect(dialog.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();await expect(phone(dialog,am)).toHaveValue('911652904');await expect(pay(dialog)).toBeEnabled();expect(quotes).toHaveLength(1);expect(commands).toHaveLength(1);await pay(dialog).click();await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();expect(quotes).toHaveLength(2);expect(commands).toHaveLength(2);expect(commands[1].key).not.toBe(commands[0].key);expect(commands[1]).toMatchObject({purpose:'BID',batchId:quotes[1].id,paymentMethod:'telebirr',phone:'251911652904'});
 
  expect(f.network).toMatchObject({combined:2,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('a long provider-success wait stays quiet and confirming until the accepted-bid receipt arrives',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null,checks=0;
 try{
  await mockBidCommand(page,{quote:route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})},direct:route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order={...directOrder(command,quotes[0]),status:'PENDING',providerStatus:'SUCCESS',createdAt:new Date(Date.now()-91000).toISOString()};return route.fulfill({json:order})}});await page.route('**/api/payments/chapa/checkouts/**',route=>{checks++;return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('2');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');await pay(dialog).click();const progress=dialog.locator('[data-bid-payment-progress="confirming"]');await expect(progress).toBeVisible();await expect(progress.locator('.lucide-loader-circle')).toHaveCount(0);await expect(dialog.locator('[data-payment-state="confirmed"]')).toHaveCount(0);await expect(tryAgain(dialog,am)).toHaveCount(0);await expect(retryOriginal(dialog,am)).toHaveCount(0);const before=checks;await dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true}).click();await expect.poll(()=>checks).toBeGreaterThan(before);expect(commands).toHaveLength(1);await page.screenshot({path:info.outputPath('provider-success-waiting-for-receipt.png'),animations:'disabled'});
  order=accepted(order!);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(commands).toHaveLength(1);expect(quotes).toHaveLength(1);
 
  expect(f.network).toMatchObject({combined:1,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('wallet Pay submits one immutable quote and displays only its returned receipt',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],debits:unknown[]=[];let external=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/direct',route=>{external++;return route.abort()});
  await page.route('**/api/payments/chapa/batches/*/wallet',async route=>{debits.push(route.request().postDataJSON());await gate;const quote=quotes.at(-1)!,receipt:BidBatchReceipt={batch:{...quote,status:'ACCEPTED'},receipts:quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:f.auction.slug!,amount:line.number,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},charge:{feePoints:'10',newlyUnavailable:'10'}}))};return route.fulfill({json:receipt})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('7.25');await dialog.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await expect(phone(dialog,am)).toHaveCount(0);await pay(dialog).evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>debits.length).toBe(1);await expect(dialog.locator('[data-bid-entry]')).toHaveCount(0);await expect(dialog.locator('[data-bid-payment-progress]')).toBeVisible();await expect(pay(dialog)).toHaveCount(0);expect(quotes).toHaveLength(1);expect(debits[0]).toEqual({quoteHash:quotes[0].quoteHash});expect(external).toBe(0);release();await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();await dialog.locator('[data-bid-payment-progress] details').first().locator('summary').click();await expect(dialog).toContainText('7.25');await expect(dialog).toContainText('10.00');expect(debits).toHaveLength(1);
  await page.screenshot({path:info.outputPath('wallet-receipt.png'),animations:'disabled'});
 
  expect(f.network).toMatchObject({combined:0,quotes:1,direct:0});
 }finally{release();await f.cleanup()}
});

test('uncertain wallet transport retains the original quote even after the balance and limits change',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],debits:{path:string;body:unknown}[]=[];let debited=false,external=0,ownSnapshot:Promise<Record<string,unknown>>|null=null;
 try{
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:debited?'5.00':'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
  await page.route('**/api/auctions/*/bids',async route=>{const body=await(ownSnapshot??=route.fetch().then(response=>response.json()));return route.fulfill({json:{...body,...(debited?{open:false,remainingSubmissions:0,ownBids:[{id:randomUUID(),amount:'7.25',acceptedAt:new Date().toISOString()}]}:{})}})});
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});await page.route('**/api/payments/chapa/direct',route=>{external++;return route.abort()});
  await page.route('**/api/payments/chapa/batches/*/wallet',route=>{debits.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});if(debits.length===1){debited=true;return route.abort('failed')}const quote=quotes[0];return route.fulfill({json:{batch:{...quote,status:'ACCEPTED'},receipts:quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:f.auction.slug!,amount:line.number,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},charge:{feePoints:'10',newlyUnavailable:'10'}}))}})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('7.25');await dialog.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await pay(dialog).click();await expect(dialog.locator('[data-bid-payment-progress="uncertain"]')).toBeVisible();await expect(dialog.locator('[data-bid-entry]')).toHaveCount(0);await expect(tryAgain(dialog,am)).toHaveCount(0);await expect(page.locator('[data-header-balance]')).toContainText('5.00');const retry=dialog.getByRole('button',{name:am?'የመጀመሪያውን ክፍያ ይድገሙ':'Retry original payment',exact:true});await expect(retry).toBeEnabled();expect(quotes).toHaveLength(1);expect(debits).toHaveLength(1);await page.screenshot({path:info.outputPath('uncertain-wallet-original-payment.png'),animations:'disabled'});
  await retry.click();await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(debits).toHaveLength(2);expect(debits[1]).toEqual(debits[0]);expect(quotes).toHaveLength(1);expect(external).toBe(0);
 
  expect(f.network).toMatchObject({combined:0,quotes:1,direct:0});
 }finally{await f.cleanup()}
});

for(const code of ['COUPON_UNAVAILABLE','TERMS_CHANGED'] as const)test(`a known ${code} rejection preserves the draft and prepares a new quote only on the next Pay`,async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),couponId=randomUUID(),quotes:BidBatchQuote[]=[],quoteKeys:string[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  if(code==='COUPON_UNAVAILABLE'){
   await page.route('**/api/auctions/*/bids',async route=>{const response=await route.fetch();return route.fulfill({json:{...await response.json(),referralDiscountsAvailable:true,couponAvailableCount:1}})});
   await page.route('**/api/auctions/*/discount-quote?**',route=>route.fulfill({json:{serverNow:new Date().toISOString(),auctionSlug:f.auction.slug,feeVersion:1,ruleVersion:'lowest-unique-v4',grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',coupon:{id:couponId,percent:10,expiresAt:new Date(Date.now()+3600000).toISOString()},eligible:true}}));
  }
  await mockBidCommand(page,{quote:route=>{const body=route.request().postDataJSON(),quote=quoteFor(f.auction.slug!,body.numbers);if(code==='COUPON_UNAVAILABLE'){quote.discountTotal='1.00';quote.total='9.00';quote.totalCents='900';quote.lines[0].discount='1.00';quote.lines[0].netFee='9.00'}quotes.push(quote);quoteKeys.push(body.key);return route.fulfill({json:quote})},direct:route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);if(commands.length===1)return route.fulfill({status:409,json:{code,error:`Synthetic ${code} rejection before provider creation`}});order=directOrder(command,quotes.at(-1)!);return route.fulfill({json:order})}});
  
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('6.25');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');if(code==='COUPON_UNAVAILABLE'){await dialog.locator('[data-bid-coupons]').getByRole('button',{name:am?'ተግብር':'Apply',exact:true}).click();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00')}
  await pay(dialog).click();await expect(dialog.locator('[data-bid-entry]')).toBeVisible();await expect(dialog.getByRole('alert')).toContainText(code);await expect(edit(dialog,am,'6.25')).toBeVisible();await expect(dialog.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();await expect(phone(dialog,am)).toHaveValue('911652904');await expect(pay(dialog)).toBeEnabled();expect(quotes).toHaveLength(1);expect(commands).toHaveLength(1);await expect(tryAgain(dialog,am)).toHaveCount(0);await expect(retryOriginal(dialog,am)).toHaveCount(0);
  await pay(dialog).click();await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();expect(quotes).toHaveLength(2);expect(commands).toHaveLength(2);expect(quoteKeys[1]).not.toBe(quoteKeys[0]);expect(commands[1].key).not.toBe(commands[0].key);expect(commands[1]).toMatchObject({purpose:'BID',batchId:quotes[1].id,paymentMethod:'telebirr',phone:'251911652904'});
 
  expect(f.network).toMatchObject({combined:2,quotes:0,direct:0});
 }finally{await f.cleanup()}
});

test('an original-request retry reviews a changed quote without dispatching until another explicit Pay',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:unknown[]=[];let quote:BidBatchQuote|null=null,order:ChapaCheckoutView|null=null,charges=0;
 try{
  await page.route('**/api/payments/chapa/direct/bid',route=>{
   const body=route.request().postDataJSON();commands.push(body);
   if(commands.length===1)return route.abort('failed');
   quote=quoteFor(f.auction.slug!,body.numbers,900);return route.fulfill({json:{kind:'quote',quote}});
  });
  await page.route('**/api/payments/chapa/direct',route=>{charges++;order=directOrder(route.request().postDataJSON() as ChapaDirectIntent,quote!);return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('6.25');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');await pay(dialog).click();await expect(retryOriginal(dialog,am)).toBeVisible();expect(charges).toBe(0);
  await retryOriginal(dialog,am).click();await expect(dialog.locator('[data-bid-entry]')).toBeVisible();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');await expect(dialog.getByRole('alert')).toBeVisible();await expect(edit(dialog,am,'6.25')).toBeVisible();await expect(dialog.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();await expect(phone(dialog,am)).toHaveValue('911652904');await expect(pay(dialog)).toBeEnabled();expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(charges).toBe(0);await expect(retryOriginal(dialog,am)).toHaveCount(0);
  await pay(dialog).click();await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();expect(charges).toBe(1);expect(f.network).toMatchObject({combined:2,quotes:0,direct:1});
 }finally{await f.cleanup()}
});

test('a changed server total waits for a second explicit Pay',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let quote:BidBatchQuote|null=null,order:ChapaCheckoutView|null=null,quotes=0,charges=0;
 try{
  await mockBidCommand(page,{quote:route=>{quotes++;quote=quoteFor(f.auction.slug!,route.request().postDataJSON().numbers,900);return route.fulfill({json:quote})},direct:route=>{charges++;order=directOrder(route.request().postDataJSON() as ChapaDirectIntent,quote!);return route.fulfill({json:order})}});await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await amount(dialog,am).fill('6.25');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await phone(dialog,am).fill('0911652904');await pay(dialog).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');expect(charges).toBe(0);expect(quotes).toBe(1);await pay(dialog).click();await expect.poll(()=>charges).toBe(1);expect(quotes).toBe(1);await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();
 
  expect(f.network).toMatchObject({combined:1,quotes:0,direct:1});
 }finally{await f.cleanup()}
});

test('safe-area header and sticky Pay remain usable with keyboard height, focus, and reduced motion',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),viewport=page.viewportSize()!;
 try{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/telegram?next='+encodeURIComponent(f.home));await page.evaluate(()=>{document.documentElement.style.setProperty('--tg-safe-area-inset-top','28px');document.documentElement.style.setProperty('--tg-safe-area-inset-bottom','20px')});const dialog=await openBid(page,f.title),header=dialog.locator('header'),close=header.getByRole('button',{name:am?'ዝጋ':'Close',exact:true});
  await expectInViewport(header,page);await expectInViewport(close,page);await expectInViewport(pay(dialog),page);await expect(dialog).toHaveCSS('animation-name','none');await expect(close).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(close).toBeFocused();expect(await close.evaluate(node=>getComputedStyle(node).outlineStyle)).not.toBe('none');
  await expect(dialog.getByRole('heading',{name:am?'ጨረታዎን ያቅርቡ':'Place your bid',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('safe-area-focus.png'),animations:'disabled'});
  await amount(dialog,am).focus();await page.setViewportSize({width:viewport.width,height:450});await expect(dialog).toHaveAttribute('data-keyboard-open','true');await expectInViewport(header,page);await expectInViewport(amount(dialog,am),page);await expectInViewport(pay(dialog),page);await amount(dialog,am).fill('2');await add(dialog,am).click();await dialog.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await expect(pay(dialog)).toBeEnabled();await expectInViewport(pay(dialog),page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('keyboard-sticky-pay.png'),animations:'disabled'});
 
  expect(f.network).toMatchObject({combined:0,quotes:0,direct:0});
 }finally{await page.setViewportSize(viewport);await f.cleanup()}
});
