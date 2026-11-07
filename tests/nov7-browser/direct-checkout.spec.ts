import {test,expect,type Locator,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from '../chapa-browser/fixtures';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';
import type {BidBatchQuote,BidBatchReceipt,ChapaDirectIntent} from '../../src/lib/bid-batch-client';

async function setup(page:Page,am:boolean){const f=await fixture(page,am);await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));await page.route('**/api/payments/chapa/methods*',route=>route.fulfill({json:{methods:[{name:'Telebirr',slug:'telebirr',minAmountCents:'100',maxAmountCents:'10000000'},{name:'M-Pesa',slug:'mpesa',minAmountCents:'500',maxAmountCents:'10000000'},{name:'CBE Birr',slug:'cbebirr',minAmountCents:'100',maxAmountCents:'10000000'}],paymentPhone:'251911652904'}}));return {...f,async cleanup(){await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}}}
function directOrder(command:ChapaDirectIntent,authType:'USSD'|'OTP',batch?:BidBatchQuote):ChapaCheckoutView{
 const intent:ChapaIntent=command.purpose==='TOP_UP'?{key:command.key,purpose:'TOP_UP',amount:command.amount}:{key:command.key,purpose:'BID',amount:batch!.lines[0].number,auctionSlug:batch!.auctionSlug,feeVersion:batch!.feeVersion};
 const amount=command.purpose==='TOP_UP'?Number(command.amount).toFixed(2):batch!.total;
 return {...pending(intent),chargeType:'DIRECT',authType,authorizationReference:'CH-'+randomUUID(),checkoutUrl:null,status:'AUTH_NEEDED',reason:null,amount,amountCents:String(Math.round(Number(amount)*100)),payerPhoneMasked:'251*****2904',paymentMethod:command.paymentMethod,providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',batch:batch??null,batchNumbers:batch?.lines.map(line=>line.number)};
}
function accepted(order:ChapaCheckoutView):ChapaCheckoutView{const bids=(order.batchNumbers??[order.bidNumber!]).map(amount=>({id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:order.auctionSlug!,amount,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'}));return {...order,status:order.purpose==='TOP_UP'?'CREDITED':'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:order.purpose==='TOP_UP'?null:{bid:bids[0],hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:order.amount,newlyUnavailable:order.amount,netFeePoints:order.amount},wallet:{available:'25',held:'0'},remainingSubmissions:100-bids.length,ownBids:bids.map(b=>({id:b.id,amount:b.amount,acceptedAt:b.acceptedAt}))}}}
function paymentPhone(dialog:Locator,am:boolean){return dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true})}
async function startTopup(page:Page,am:boolean,phone:string|null='0911652904'){await expect(page.locator('[data-header-balance]')).toContainText('25.00');await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();const dialog=page.getByRole('dialog',{name:am?'ወደ ዋሌት ገንዘብ ያስገቡ':'Top up wallet',exact:true});await dialog.getByRole('textbox',{name:am?'መጠን':'Amount',exact:true}).fill('10');await dialog.locator('[data-payment-action]').click();await expect(dialog.locator('[data-direct-checkout]')).toBeVisible();await expect(paymentPhone(dialog,am)).toHaveValue('');if(phone!==null)await paymentPhone(dialog,am).fill(phone);return dialog}

function batchQuote(auctionSlug:string,numbers:string[],feeCents=1000):BidBatchQuote{
 const totalCents=numbers.length*feeCents;
 return {id:randomUUID(),quoteHash:'b'.repeat(64),auctionSlug,feeVersion:1,ruleVersion:'lowest-unique-v4',lines:numbers.map((number,position)=>({position,number:Number(number).toFixed(2),grossFee:(feeCents/100).toFixed(2),discount:'0.00',netFee:(feeCents/100).toFixed(2)})),entryCount:numbers.length,total:(totalCents/100).toFixed(2),totalCents:String(totalCents),grossTotal:(totalCents/100).toFixed(2),discountTotal:'0.00',status:'QUOTED'};
}
async function openBid(page:Page,title:string){await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-bid-entry]')).toBeVisible();return dialog}

test('bid checkout requires a manual phone above payment choices and rejects a provider-prefix mismatch before submission',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaDirectIntent[]=[];let quote:BidBatchQuote|null=null,quoteRequests=0,order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quoteRequests++;quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/direct',route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order=directOrder(command,'USSD',quote!);return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),phone=paymentPhone(dialog,am),pay=dialog.locator('[data-payment-action]'),feedback=dialog.locator('[data-payment-phone-error]'),funding=dialog.locator('[data-funding-selector]');
  await expect(phone).toHaveValue('');await dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true}).fill('2');await expect(pay).toBeDisabled();
  const phoneBox=await phone.boundingBox(),fundingBox=await funding.boundingBox();expect(phoneBox!.y+phoneBox!.height).toBeLessThanOrEqual(fundingBox!.y);
  await phone.fill('0911652904');await expect(pay).toBeEnabled();await funding.getByRole('radio',{name:'M-Pesa',exact:true}).check();
  for(const value of ['0911652904','+251911652904','251 911 652 904']){await phone.fill(value);await expect(phone).toHaveAttribute('aria-invalid','true');await expect(feedback).toContainText('M-Pesa');await expect(pay).toBeDisabled()}
  expect(quoteRequests).toBe(0);expect(commands).toHaveLength(0);await expect(dialog.locator('[data-bid-submitting],[data-direct-approval]')).toHaveCount(0);await page.screenshot({path:info.outputPath('bid-mpesa-prefix-error.png'),animations:'disabled'});
  await phone.fill('0713339196');await expect(feedback).toHaveCount(0);await expect(pay).toBeEnabled();await funding.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(feedback).toContainText('telebirr');await expect(pay).toBeDisabled();
  await funding.getByRole('radio',{name:'CBE Birr',exact:true}).check();await expect(feedback).toHaveCount(0);await expect(pay).toBeEnabled();await phone.fill('0911652904');await expect(pay).toBeEnabled();
  await phone.clear();await funding.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await expect(phone).toHaveCount(0);await expect(pay).toBeEnabled();expect(quoteRequests).toBe(0);expect(commands).toHaveLength(0);
  await funding.getByRole('radio',{name:'M-Pesa',exact:true}).check();await expect(phone).toHaveValue('');await expect(pay).toBeDisabled();await phone.fill('+251713339196');await expect(pay).toBeEnabled();await pay.click();
  await expect.poll(()=>commands.length).toBe(1);expect(quoteRequests).toBe(1);expect(commands[0]).toMatchObject({purpose:'BID',paymentMethod:'mpesa',phone:'251713339196'});await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();
 }finally{await f.cleanup()}
});

test('top-up phone is blank above providers and an invalid M-Pesa number never starts loading or a charge',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/direct',route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order=directOrder(command,'USSD');return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await startTopup(page,am,null),phone=paymentPhone(dialog,am),pay=dialog.locator('[data-payment-action]'),feedback=dialog.locator('[data-payment-phone-error]');
  await expect(phone).toHaveValue('');await expect(pay).toBeDisabled();const phoneBox=await phone.boundingBox(),providersBox=await dialog.locator('[data-direct-checkout] fieldset').boundingBox();expect(phoneBox!.y+phoneBox!.height).toBeLessThanOrEqual(providersBox!.y);
  await phone.fill('0911652904');await expect(pay).toBeEnabled();const mpesa=dialog.getByRole('radio',{name:'M-Pesa',exact:true});await mpesa.locator('..').click({timeout:10000});await expect(mpesa).toBeChecked();await expect(feedback).toContainText('M-Pesa');await expect(pay).toBeDisabled();expect(commands).toHaveLength(0);await expect(dialog.locator('[data-direct-approval]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('topup-manual-phone-error.png'),animations:'disabled'});await phone.fill('0713339196');await expect(feedback).toHaveCount(0);await pay.click();await expect.poll(()=>commands.length).toBe(1);expect(commands[0]).toMatchObject({purpose:'TOP_UP',paymentMethod:'mpesa',phone:'251713339196'});await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();
 }finally{await f.cleanup()}
});

test('a definitive provider initialization rejection stops the spinner and offers an explicit new checkout',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let order:ChapaCheckoutView|null=null,charges=0,checks=0;
 try{
  // Cover saved pre-fix PENDING attempts as well as new rejected attempts.
  await page.route('**/api/payments/chapa/direct',route=>{charges++;order={...directOrder(route.request().postDataJSON() as ChapaDirectIntent,'USSD'),status:am?'NEEDS_REVIEW':'PENDING',reason:am?'INITIALIZATION_REJECTED':'PROVIDER_CONFIRMATION_REQUIRED',providerStatus:null,verificationState:'UNAVAILABLE',authType:null,authorizationReference:null,initializationIssue:'request'};return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>{checks++;return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await startTopup(page,am);await dialog.locator('[data-payment-action]').click();await expect(dialog.getByRole('status')).toContainText(am?'ክፍያው ሊጀመር አልቻለም':'Checkout could not start');await expect(dialog.locator('[data-direct-approval]')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:am?'አዲስ ክፍያ ይጀምሩ':'Start new checkout',exact:true})).toBeVisible();expect(charges).toBe(1);expect(checks).toBe(0);await page.screenshot({path:info.outputPath('direct-request-rejected.png'),animations:'disabled'});
 }finally{await f.cleanup()}
});

test('one simplified bid sheet totals every amount and sends one explicitly selected direct charge',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaDirectIntent[]=[],quotes:unknown[]=[];let order:ChapaCheckoutView|null=null,quote:BidBatchQuote|null=null,paid=false,verifyRequests=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const body=route.request().postDataJSON() as {numbers:string[]};quotes.push(body);quote=batchQuote(f.auction.slug!,body.numbers);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/direct',route=>{const body=route.request().postDataJSON() as ChapaDirectIntent;commands.push(body);order=directOrder(body,'USSD',quote!);return route.fulfill({status:202,json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>{if(route.request().method()==='POST')verifyRequests++;return route.fulfill({json:paid?accepted(order!):order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true});
  const marker=randomUUID();await dialog.evaluate((node,value)=>node.setAttribute('data-stable-modal',value),marker);
  await expect(input).toBeEnabled();await input.fill('2');await dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click();await input.fill('3');await dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click();await input.fill('4');
  await expect(dialog.locator('[data-bid-total]')).toContainText('30.00');expect(quotes).toHaveLength(0);expect(commands).toHaveLength(0);
  const funding=dialog.locator('[data-funding-selector]'),originalViewport=page.viewportSize()!;
  await expect(funding.getByRole('radio')).toHaveCount(4);await expect(funding.locator('img')).toHaveCount(3);await expect.poll(()=>funding.locator('img').evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0))).toBe(true);
  for(const width of [320,originalViewport.width]){
   await page.setViewportSize({...originalViewport,width});
   const telebirr=await funding.locator('[data-provider="telebirr"]').boundingBox(),cbe=await funding.locator('[data-provider="cbebirr"]').boundingBox(),mpesa=await funding.locator('[data-provider="mpesa"]').boundingBox(),wallet=await funding.locator('[data-provider="wallet"]').boundingBox();
   expect(telebirr!.x+telebirr!.width).toBeLessThanOrEqual(cbe!.x+1);expect(Math.abs(telebirr!.y-cbe!.y)).toBeLessThan(2);expect(mpesa!.y).toBeGreaterThan(telebirr!.y);expect(Math.abs(mpesa!.y-wallet!.y)).toBeLessThan(2);expect(mpesa!.x+mpesa!.width).toBeLessThanOrEqual(wallet!.x+1);
   for(const radio of await funding.getByRole('radio').all())await expect(radio).toHaveCSS('opacity','0');
   for(const image of await funding.locator('img').all()){const box=await image.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(20);expect(box!.height).toBeGreaterThanOrEqual(20)}
   const product=dialog.locator('[data-sheet-preview] img');await expect(product).toBeVisible();expect((await product.boundingBox())!.height).toBeGreaterThan(70);
   const fee=dialog.locator('[data-bid-count]').locator('..'),price=await fee.locator(':scope > div > strong').boundingBox(),bidCount=await fee.locator('[data-bid-count]').boundingBox(),clock=await fee.locator(':scope > span:last-child').boundingBox();
   for(const neighbor of [bidCount!,clock!])expect(price!.x+price!.width<=neighbor.x+1||neighbor.x+neighbor.width<=price!.x+1||price!.y+price!.height<=neighbor.y+1||neighbor.y+neighbor.height<=price!.y+1).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:info.outputPath('simplified-bid-'+width+'.png'),animations:'disabled'});
  }
  await funding.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(funding.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();
  const phone=paymentPhone(dialog,am);await expect(phone).toHaveValue('');await phone.fill('+251911652904');await expect(phone).toHaveValue('911652904');await phone.fill('0911652904');await expect(phone).toHaveValue('911652904');
  await dialog.locator('[data-payment-action]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>commands.length).toBe(1);
  expect(quotes).toHaveLength(1);expect(quotes[0]).toMatchObject({numbers:['2.00','3.00','4.00']});expect(commands[0]).toMatchObject({purpose:'BID',paymentMethod:'telebirr',phone:'251911652904',batchId:quote!.id});
  await expect(dialog.locator('[data-bid-review]')).toHaveCount(0);await expect(dialog).toHaveAttribute('data-stable-modal',marker);await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.locator('input[autocomplete="one-time-code"],input[type="password"]')).toHaveCount(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
  paid=true;await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(verifyRequests).toBeGreaterThan(0);await expect(dialog).toContainText('2.00');await expect(dialog).toContainText('4.00');expect(commands).toHaveLength(1);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.cleanup()}
});

test('wallet selection submits a server quote once from the same sheet and waits for its receipt',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:unknown[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const body=route.request().postDataJSON() as {numbers:string[]};const quote=batchQuote(f.auction.slug!,body.numbers);quotes.push(quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/batches/*/wallet',async route=>{commands.push(route.request().postDataJSON());await gate;const quote=quotes.at(-1)!;const receipt:BidBatchReceipt={batch:{...quote,status:'ACCEPTED'},receipts:quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:f.auction.slug!,amount:line.number,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},charge:{feePoints:'10',newlyUnavailable:'10'}}))};return route.fulfill({json:receipt})});
  await page.route('**/api/payments/chapa/direct',()=>{throw Error('Wallet must not initialize an external charge')});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true});await input.fill('7.25');await dialog.locator('[data-funding-selector]').getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();
  await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');const pay=dialog.locator('[data-payment-action]');await expect(pay).toBeEnabled();await pay.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});
  await expect.poll(()=>commands.length).toBe(1);expect(quotes).toHaveLength(1);expect(commands[0]).toEqual({quoteHash:quotes[0].quoteHash});await expect(pay).toBeDisabled();await expect(pay.locator('[data-bid-submitting]')).toBeVisible();await expect(dialog.locator('[data-bid-review]')).toHaveCount(0);await expect(dialog.locator('[data-payment-state="confirmed"]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('simplified-wallet-submitting.png'),animations:'disabled'});release();await expect(dialog.getByRole('status')).toHaveText(am?'1 ጨረታዎች ተቀብለዋል':'Bid accepted');expect(commands).toHaveLength(1);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
 }finally{release();await f.cleanup()}
});

test('a changed server total requires a second explicit payment confirmation',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let quote:BidBatchQuote|null=null,quoteRequests=0,charges=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quoteRequests++;const body=route.request().postDataJSON() as {numbers:string[]};quote=batchQuote(f.auction.slug!,body.numbers,900);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/direct',route=>{charges++;return route.fulfill({json:directOrder(route.request().postDataJSON() as ChapaDirectIntent,'USSD',quote!)})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({status:503,json:{error:'Synthetic unavailable'}}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true}).fill('6.25');await dialog.getByRole('radio',{name:'M-Pesa',exact:true}).check();await paymentPhone(dialog,am).fill('0713339196');await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');await dialog.locator('[data-payment-action]').click();
  await expect.poll(()=>quoteRequests).toBe(1);await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');expect(charges).toBe(0);await expect(dialog.locator('[data-bid-review]')).toHaveCount(0);
  await dialog.locator('[data-payment-action]').click();await expect.poll(()=>charges).toBe(1);expect(quoteRequests).toBe(1);await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();
 }finally{await f.cleanup()}
});

test('an uncertain wallet debit retries the original quote after its balance and bid limits change',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:{path:string;body:unknown}[]=[];let debited=false;
 let ownSnapshot:Promise<Record<string,unknown>>|null=null;
 try{
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:debited?'5.00':'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
  await page.route('**/api/auctions/*/bids',async route=>{const body=await(ownSnapshot??=route.fetch().then(response=>response.json()));return route.fulfill({json:{...body,...(debited?{open:false,remainingSubmissions:0,ownBids:[{id:randomUUID(),amount:'7.25',acceptedAt:new Date().toISOString()}]}:{})}})});
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/batches/*/wallet',route=>{commands.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});if(commands.length===1){debited=true;return route.abort('failed')}const quote=quotes[0];return route.fulfill({json:{batch:{...quote,status:'ACCEPTED'},receipts:quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:f.auction.slug!,amount:line.number,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},charge:{feePoints:'10',newlyUnavailable:'10'}}))}})});
  await page.route('**/api/payments/chapa/direct',()=>{throw Error('Wallet recovery must not initialize an external charge')});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true}).fill('7.25');await dialog.getByRole('radio',{name:am?'ዋሌት':'Wallet',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  const retry=dialog.getByRole('button',{name:am?'የመጀመሪያውን ክፍያ ይድገሙ':'Retry original payment',exact:true});await expect(retry).toBeVisible();await expect(page.locator('[data-header-balance]')).toContainText('5.00');await expect(dialog).toContainText(am?'ይህ ጨረታ ለአዲስ ጨረታዎች ክፍት አይደለም።':'This auction is not open for new bids.');await expect(retry).toBeEnabled();await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');expect(quotes).toHaveLength(1);expect(commands).toHaveLength(1);
  await retry.click();await expect(dialog.getByRole('status')).toHaveText(am?'1 ጨረታዎች ተቀብለዋል':'Bid accepted');expect(quotes).toHaveLength(1);expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
 }finally{await f.cleanup()}
});

test('an applied coupon can be removed after refreshed availability becomes zero',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),couponId=randomUUID();let unavailable=false,quotes=0;
 let ownSnapshot:Promise<Record<string,unknown>>|null=null;
 try{
  await page.route('**/api/auctions/*/bids',async route=>{const body=await(ownSnapshot??=route.fetch().then(response=>response.json()));return route.fulfill({json:{...body,referralDiscountsAvailable:true,couponAvailableCount:unavailable?0:1}})});
  await page.route('**/api/auctions/*/discount-quote?**',route=>route.fulfill({json:{serverNow:new Date().toISOString(),auctionSlug:f.auction.slug,feeVersion:1,ruleVersion:'lowest-unique-v4',grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',coupon:unavailable?null:{id:couponId,percent:10,expiresAt:new Date(Date.now()+3600000).toISOString()},eligible:!unavailable}}));
  await page.route('**/api/payments/chapa/batches/quote',route=>{quotes++;unavailable=true;return route.fulfill({status:409,json:{code:'COUPON_UNAVAILABLE',error:'Synthetic coupon was already used'}})});
  await page.route('**/api/payments/chapa/direct',()=>{throw Error('An unavailable coupon must not initialize a payment')});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true}).fill('6.25');await paymentPhone(dialog,am).fill('0911652904');const coupon=dialog.locator('[data-bid-coupons]');await coupon.getByRole('button',{name:am?'ተግብር':'Apply',exact:true}).click();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');await dialog.locator('[data-payment-action]').click();
  await expect.poll(()=>quotes).toBe(1);await expect(coupon).toContainText('0');const remove=coupon.getByRole('button',{name:am?'አስወግድ':'Remove',exact:true});await expect(remove).toBeEnabled();await remove.click();await expect(coupon.getByRole('button',{name:am?'ተግብር':'Apply',exact:true})).toBeDisabled();await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');expect(quotes).toBe(1);
 }finally{await f.cleanup()}
});

test('OTP appears only on the provider OTP state; explicit authorization sends it once and cancellation remains unpaid',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),authorizations:unknown[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/direct',route=>{const body=route.request().postDataJSON() as ChapaDirectIntent;commands.push(body);order=directOrder(body,'OTP');return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>{if(new URL(route.request().url()).pathname.endsWith('/authorize')){authorizations.push(route.request().postDataJSON());order={...order!,status:'CANCELLED',providerStatus:'CANCELLED',providerReasonCode:'PAYMENT_CANCELLED',verificationState:'VERIFIED'}}return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.locator('[data-header-balance]')).toContainText('25.00');const dialog=await startTopup(page,am);await dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number'}).fill('0911652904');await dialog.locator('[data-payment-action]').click();const otp=dialog.locator('input[autocomplete="one-time-code"]');await expect(otp).toBeVisible();await expect(dialog).toContainText(am?'የማረጋገጫ ኮዱን ያስገቡ':'Enter your verification code');expect(authorizations).toHaveLength(0);
  await page.screenshot({path:info.outputPath('direct-otp.png'),animations:'disabled'});await otp.fill('123456');await dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm OTP',exact:true}).click();await expect.poll(()=>authorizations.length).toBe(1);expect(authorizations[0]).toEqual({otp:'123456'});await expect(otp).toHaveCount(0);await expect(dialog.locator('[data-payment-state="failed"]')).toBeVisible();expect(commands).toHaveLength(1);await expect(page.locator('[data-header-balance]')).toContainText('25.00');expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.cleanup()}
});

test('lost direct initialization exposes a retry of the exact original intent without a second automatic charge',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{await page.route('**/api/payments/chapa/direct',route=>{const body=route.request().postDataJSON() as ChapaDirectIntent;commands.push(body);if(commands.length===1)return route.abort('failed');order=directOrder(body,'USSD');return route.fulfill({json:order})});await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await startTopup(page,am);await dialog.locator('[data-payment-action]').click();await expect(dialog.getByRole('button',{name:am?'የመጀመሪያውን ጥያቄ ይድገሙ':'Retry original request'})).toBeVisible();expect(commands).toHaveLength(1);await dialog.getByRole('button',{name:am?'የመጀመሪያውን ጥያቄ ይድገሙ':'Retry original request'}).click();await expect.poll(()=>commands.length).toBe(2);expect(commands[1]).toEqual(commands[0]);await expect(dialog).toContainText(am?'ክፍያውን በስልክዎ ይፍቀዱ':'Approve the payment on your phone');expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([])}finally{await f.cleanup()}
});

test('a delayed verification response cannot replace confirmed OTP payment with an authorization prompt',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let order:ChapaCheckoutView|null=null,commands=0,authorizations=0,checks=0;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
 try{
  await page.route('**/api/payments/chapa/direct',route=>{commands++;order=directOrder(route.request().postDataJSON() as ChapaDirectIntent,'OTP');return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',async route=>{
   if(new URL(route.request().url()).pathname.endsWith('/authorize')){authorizations++;return route.fulfill({json:accepted(order!)})}
   checks++;const old={...order!};await gate;await route.fulfill({json:old}).catch(()=>{});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await startTopup(page,am);await dialog.locator('[data-payment-action]').click();const otp=dialog.locator('input[autocomplete="one-time-code"]');await expect(otp).toBeVisible();await expect.poll(()=>checks).toBeGreaterThan(0);
  await otp.fill('123456');await dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm OTP',exact:true}).click();await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();release();await page.waitForTimeout(1500);
  await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();await expect(otp).toHaveCount(0);expect(commands).toBe(1);expect(authorizations).toBe(1);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
 }finally{release();await f.cleanup()}
});

test('an unconfirmed direct initialization stays connecting and retries the same persisted request',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/direct',route=>{
   const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);
   const ready=directOrder(command,'USSD');
   order=commands.length===1?{...ready,status:'SUBMITTING',authType:null,authorizationReference:null,providerStatus:null,verificationState:'UNAVAILABLE'}:{...ready,id:order!.id};
   return route.fulfill({status:202,json:order});
  });
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await startTopup(page,am);await dialog.locator('[data-payment-action]').click();
  const connecting=dialog.locator('[data-direct-approval="connecting"]');await expect(connecting).toBeVisible();
  await expect(connecting.getByRole('status')).toContainText(am?'በመገናኘት':'Connecting');
  await expect(connecting).not.toContainText(am?'ክፍያውን በስልክዎ ይፍቀዱ':'Approve the payment on your phone');
  await expect(dialog.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
  expect((await connecting.boundingBox())!.height).toBeLessThan(430);await page.screenshot({path:info.outputPath('direct-initialization-connecting.png'),animations:'disabled'});
  await connecting.getByRole('button',{name:am?'የመጀመሪያውን ጥያቄ ይድገሙ':'Retry original request',exact:true}).click();
  await expect.poll(()=>commands.length).toBe(2);expect(commands[1]).toEqual(commands[0]);await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();
  expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
 }finally{await f.cleanup()}
});

test('a terminal bid attempt preserves amounts and retries only on a fresh explicit payment',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null,first:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/direct',route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);const ready=directOrder(command,'USSD',quotes.at(-1)!);order=commands.length===1?{...ready,status:'CANCELLED',providerStatus:'CANCELLED',providerReasonCode:'PAYMENT_CANCELLED'}:ready;if(!first)first=structuredClone(order);return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true}).fill('2');await dialog.getByRole('radio',{name:'CBE Birr',exact:true}).check();await paymentPhone(dialog,am).fill('0911652904');await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-payment-state="failed"]')).toBeVisible();expect(commands).toHaveLength(1);expect(commands[0].paymentMethod).toBe('cbebirr');expect(quotes).toHaveLength(1);
  await dialog.getByRole('button',{name:am?'አዲስ ክፍያ ይጀምሩ':'Start new checkout',exact:true}).click();await expect(dialog.locator('[data-bid-entry]')).toBeVisible();await expect(dialog.getByRole('button',{name:am?'2.00 ያስተካክሉ':'Edit 2.00',exact:true})).toBeVisible();expect(quotes).toHaveLength(1);expect(commands).toHaveLength(1);
  await dialog.getByRole('radio',{name:'CBE Birr',exact:true}).check();await paymentPhone(dialog,am).fill('0911652904');await dialog.locator('[data-payment-action]').click();await expect.poll(()=>commands.length).toBe(2);expect(quotes).toHaveLength(2);expect(quotes[1].id).not.toBe(quotes[0].id);expect(commands[1].key).not.toBe(commands[0].key);expect(commands[1]).toMatchObject({purpose:'BID',batchId:quotes[1].id,paymentMethod:'cbebirr'});expect(commands[0]).toMatchObject({purpose:'BID',batchId:quotes[0].id});
  await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();expect(first).toMatchObject({status:'CANCELLED',providerStatus:'CANCELLED'});expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
 }finally{await f.cleanup()}
});

test('verified provider PIN feedback stays on the same USSD attempt and clears after confirmation',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaDirectIntent[]=[];let order:ChapaCheckoutView|null=null,paid=false;
 try{
  await page.route('**/api/payments/chapa/direct',route=>{const command=route.request().postDataJSON() as ChapaDirectIntent;commands.push(command);order={...directOrder(command,'USSD'),providerReasonCode:'INVALID_PIN',pollAfterMs:1000};return route.fulfill({json:order})});
  await page.route('**/api/payments/chapa/checkouts/**',route=>route.fulfill({json:paid?accepted(order!):order}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await startTopup(page,am);await dialog.locator('[data-payment-action]').click();
  await expect(dialog.locator('[data-direct-approval="phone"]')).toBeVisible();await expect(dialog.locator('[data-payment-reason]')).toContainText(am?'PIN ትክክል':'incorrect payment PIN');
  await expect(dialog.locator('input[type="password"],input[autocomplete="one-time-code"]')).toHaveCount(0);expect(commands).toHaveLength(1);
  await page.screenshot({path:info.outputPath('direct-provider-pin-feedback.png'),animations:'disabled'});paid=true;
  await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();await expect(dialog.locator('[data-payment-reason]')).toHaveCount(0);expect(commands).toHaveLength(1);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
 }finally{await f.cleanup()}
});
