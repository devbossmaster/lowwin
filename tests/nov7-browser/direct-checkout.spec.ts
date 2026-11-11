import {test,expect,type Locator,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending,batchQuote} from '../chapa-browser/fixtures';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';
import type {BidBatchQuote,BidBatchReceipt} from '../../src/lib/bid-batch-client';

async function setup(page:Page,am:boolean){
 const f=await fixture(page,am),retired:string[]=[],provider:string[]=[];
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(/^\/api\/payments\/chapa\/(?:direct(?:\/bid)?|methods)$/.test(path))retired.push(path)});
 await page.route('https://api.chapa.co/**',route=>{provider.push(route.request().url());return route.abort()});
 await page.route('https://api.chapa.global/**',route=>{provider.push(route.request().url());return route.abort()});
 return {...f,retired,async cleanup(){try{expect(retired).toEqual([]);expect(provider).toEqual([]);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect((await f.db.ledgerAccount.findUnique({where:{name:`user:${f.user.id}:available`}}))?.balance.toString()??'0').toBe('0');await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}})}finally{await f.db.$disconnect()}}};
}
async function noCustomCheckout(dialog:Locator){
 await expect(dialog.getByRole('radio')).toHaveCount(0);
 await expect(dialog.locator('input[type="tel"],input[type="password"],input[autocomplete="one-time-code"],[data-direct-checkout],[data-direct-approval],[data-funding-selector]')).toHaveCount(0);
}
async function openTopup(page:Page,am:boolean){
 await expect(page.locator('[data-header-balance]')).toContainText('25.00');await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-wallet-top-up]')).toBeVisible();return dialog;
}
async function openBid(page:Page,title:string){await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-bid-entry]')).toBeVisible();return dialog}
const bidInput=(dialog:Locator,am:boolean)=>dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true});
const topupInput=(dialog:Locator,am:boolean)=>dialog.getByRole('textbox',{name:am?'የሚያስገቡት መጠን':'Amount to top up',exact:true});
const walletAction=(dialog:Locator,am:boolean)=>dialog.getByRole('button',{name:am?/^ከዋሌት /:/^Pay .* from wallet$/});
const checked=(dialog:Locator,am:boolean)=>dialog.getByRole('button',{name:am?'ክፍያ ያረጋግጡ':'Check payment',exact:true});
function accepted(order:ChapaCheckoutView):ChapaCheckoutView{
 const bid={id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:order.auctionSlug!,amount:order.batchNumbers?.[0]??'2.00',acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:order.amount};
 return {...order,status:order.purpose==='TOP_UP'?'CREDITED':'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:order.purpose==='TOP_UP'?null:{bid,hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:order.amount,newlyUnavailable:order.amount},wallet:{available:'25',held:'0'},remainingSubmissions:99,ownBids:[{id:bid.id,amount:bid.amount,acceptedAt:bid.acceptedAt}]}};
}
function walletReceipt(quote:BidBatchQuote):BidBatchReceipt{return {batch:{...quote,status:'ACCEPTED'},receipts:quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:quote.auctionSlug,amount:line.number,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:line.netFee},charge:{feePoints:line.netFee,newlyUnavailable:line.netFee}}))}}

test('new bid checkout sends one immutable server batch to V1 hosted checkout without phone, provider or OTP entry',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaIntent[]=[],quotes:BidBatchQuote[]=[];let order:ChapaCheckoutView|null=null,paid=false;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/checkouts**',route=>{const request=route.request();if(new URL(request.url()).pathname.endsWith('/checkouts')&&request.method()==='POST'){const intent=request.postDataJSON() as ChapaIntent;commands.push(intent);order=pending(intent,randomUUID(),quotes.at(-1));return route.fulfill({status:201,json:order})}return route.fulfill({json:paid?accepted(order!):order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=bidInput(dialog,am);
  for(const number of ['2','3']){await input.fill(number);await dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click()}await input.fill('4');
  await noCustomCheckout(dialog);await expect(dialog.locator('[data-bid-total]')).toContainText('30.00');expect(quotes).toHaveLength(0);expect(commands).toHaveLength(0);
  const pay=dialog.locator('[data-bid-continue]');await expect(pay).toBeEnabled();await pay.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});
  await expect.poll(()=>commands.length).toBe(1);expect(quotes).toHaveLength(1);expect(quotes[0].lines.map(line=>line.number)).toEqual(['2.00','3.00','4.00']);expect(Object.keys(commands[0]).sort()).toEqual(['batchId','key','purpose','quoteHash']);expect(commands[0]).toMatchObject({purpose:'BID',batchId:quotes[0].id,quoteHash:quotes[0].quoteHash});
  await expect(dialog.locator('[data-hosted-checkout-status]')).toContainText('30.00');await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([order!.checkoutUrl]);expect(order!.apiVersion).toBe(1);await noCustomCheckout(dialog);await expect(page.getByRole('dialog')).toHaveCount(1);await expect(dialog.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toHaveCount(0);await expect(page.locator('[data-header-balance]')).toContainText('25.00');
  paid=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toBeVisible();expect(commands).toHaveLength(1);
 }finally{await f.cleanup()}
});

test('top-up validates decimal ETB amounts and waits for server credit after provider success',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaIntent[]=[];let order:ChapaCheckoutView|null=null,phase:'pending'|'provider-success'|'credited'='pending';
 try{
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:phase==='credited'?'35.75':'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
  await page.route('**/api/payments/chapa/checkouts**',route=>{const request=route.request();if(new URL(request.url()).pathname.endsWith('/checkouts')&&request.method()==='POST'){const intent=request.postDataJSON() as ChapaIntent;commands.push(intent);order=pending(intent);return route.fulfill({json:order})}return route.fulfill({json:phase==='credited'?accepted(order!):{...order,...(phase==='provider-success'?{providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openTopup(page,am),amount=topupInput(dialog,am),pay=dialog.locator('[data-top-up-continue]');await noCustomCheckout(dialog);
  for(const value of ['0','50000']){await amount.fill(value);await expect(pay).toBeDisabled()}await amount.fill('10.75');await expect(pay).toBeEnabled();await pay.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>commands.length).toBe(1);expect(commands[0]).toMatchObject({purpose:'TOP_UP',amount:'10.75'});expect(Object.keys(commands[0]).sort()).toEqual(['amount','key','purpose']);
  await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();phase='provider-success';await checked(dialog,am).click();await expect(dialog.getByRole('heading',{name:am?'መለያዎ በመዘመን ላይ…':'Updating your account…',exact:true})).toBeVisible();await expect(page.locator('[data-header-balance]')).toContainText('25.00');
  phase='credited';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.getByRole('heading',{name:am?'ዋሌት ገብቷል':'Wallet credited',exact:true})).toBeVisible();await expect(page.locator('[data-header-balance]')).toContainText('35.75');expect(commands).toHaveLength(1);await noCustomCheckout(dialog);
 }finally{await f.cleanup()}
});

test('retired direct creation and method APIs require the owned session, same origin, and private 410 responses',async({page,browser},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.locator('[data-header-balance]')).toContainText('25.00');const origin=new URL(page.url()).origin;
  for(const path of ['/api/payments/chapa/direct','/api/payments/chapa/direct/bid']){
   const response=await page.request.post(path,{headers:{origin},data:{key:randomUUID(),purpose:'TOP_UP',amount:'10',paymentMethod:'telebirr',phone:'0911652904'}});expect(response.status()).toBe(410);expect(await response.json()).toMatchObject({code:'HOSTED_CHECKOUT_REQUIRED'});expect(response.headers()['cache-control']).toContain('private');expect(response.headers()['cache-control']).toContain('no-store');expect(response.headers().vary).toContain('Cookie');
   expect((await page.request.post(path,{headers:{origin:'https://untrusted.example'},data:{}})).status()).toBe(403);
  }
  const methods=await page.request.get('/api/payments/chapa/methods');expect(methods.status()).toBe(410);expect(await methods.json()).toMatchObject({code:'HOSTED_CHECKOUT_REQUIRED'});expect(methods.headers()['cache-control']).toContain('no-store');
  const anonymous=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true});try{expect((await anonymous.request.get('/api/payments/chapa/methods')).status()).toBe(401);for(const path of ['/api/payments/chapa/direct','/api/payments/chapa/direct/bid'])expect((await anonymous.request.post(path,{headers:{origin},data:{}})).status()).toBe(401)}finally{await anonymous.close()}
 }finally{await f.cleanup()}
});

test('invalid and four-consecutive bid numbers cannot request a quote or hosted charge',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let quotes=0,charges=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quotes++;return route.abort()});await page.route('**/api/payments/chapa/checkouts',route=>{charges++;return route.abort()});await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=bidInput(dialog,am),pay=dialog.locator('[data-bid-continue]');
  await input.fill('0');await expect(pay).toBeDisabled();await expect(dialog.getByRole('alert')).toBeVisible();for(const number of ['1.01','1.02','1.03']){await input.fill(number);await dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click()}await input.fill('1.04');await expect(pay).toBeDisabled();await expect(dialog.getByRole('alert')).toHaveText(am?'ከሦስት በላይ ተከታታይ ቁጥሮች አይፈቀዱም።':'Only 3 consecutive amounts. Skip at least one step.');expect(quotes).toBe(0);expect(charges).toBe(0);
 }finally{await f.cleanup()}
});

test('a changed server fee requires a second explicit acceptance before hosted initialization',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaIntent[]=[];let quote:BidBatchQuote|null=null,quoteReads=0,order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quoteReads++;quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers,900);return route.fulfill({json:quote})});await page.route('**/api/payments/chapa/checkouts**',route=>{if(new URL(route.request().url()).pathname.endsWith('/checkouts')&&route.request().method()==='POST'){const intent=route.request().postDataJSON() as ChapaIntent;commands.push(intent);order=pending(intent,randomUUID(),quote!)}return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await bidInput(dialog,am).fill('6.25');await dialog.locator('[data-bid-continue]').click();await expect(dialog.getByRole('alert')).toContainText(am?'ክፍያው ተቀይሯል':'The fee changed');await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');expect(commands).toHaveLength(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
  await dialog.locator('[data-bid-continue]').click();await expect.poll(()=>commands.length).toBe(1);expect(quoteReads).toBe(1);expect(commands[0]).toMatchObject({batchId:quote!.id,quoteHash:quote!.quoteHash});await expect(dialog.locator('[data-hosted-checkout-status]')).toContainText('9.00');
 }finally{await f.cleanup()}
});

test('an unavailable applied coupon can be removed without starting an external payment',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),couponId=randomUUID();let unavailable=false,quotes=0,charges=0,ownSnapshot:Promise<Record<string,unknown>>|null=null;
 try{
  await page.route('**/api/auctions/*/bids',async route=>{const body=await(ownSnapshot??=route.fetch().then(response=>response.json()));return route.fulfill({json:{...body,referralDiscountsAvailable:true,couponAvailableCount:unavailable?0:1}})});await page.route('**/api/auctions/*/discount-quote?**',route=>route.fulfill({json:{serverNow:new Date().toISOString(),auctionSlug:f.auction.slug,feeVersion:1,ruleVersion:'lowest-unique-v4',grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',coupon:unavailable?null:{id:couponId,percent:10,expiresAt:new Date(Date.now()+3600000).toISOString()},eligible:!unavailable}}));
  await page.route('**/api/payments/chapa/batches/quote',route=>{quotes++;unavailable=true;return route.fulfill({status:409,json:{code:'COUPON_UNAVAILABLE',error:'Synthetic coupon was already used'}})});await page.route('**/api/payments/chapa/checkouts',route=>{charges++;return route.abort()});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await bidInput(dialog,am).fill('6.25');const coupon=dialog.locator('[data-bid-coupons]');await coupon.getByRole('button',{name:am?'ተግብር':'Apply',exact:true}).click();await expect(dialog.locator('[data-bid-total]')).toContainText('9.00');await dialog.locator('[data-bid-continue]').click();await expect.poll(()=>quotes).toBe(1);await expect(coupon).toContainText('0');await coupon.getByRole('button',{name:am?'አስወግድ':'Remove',exact:true}).click();await expect(coupon.getByRole('button',{name:am?'ተግብር':'Apply',exact:true})).toBeDisabled();await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');expect(charges).toBe(0);
 }finally{await f.cleanup()}
});

test('wallet payment submits one frozen quote and waits for an accepted server receipt',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:{path:string;body:unknown}[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});await page.route('**/api/payments/chapa/batches/*/wallet',async route=>{commands.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});await gate;return route.fulfill({json:walletReceipt(quotes[0])})});await page.route('**/api/payments/chapa/checkouts',()=>{throw Error('Wallet payment must not initialize Chapa')});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await bidInput(dialog,am).fill('7.25');const pay=walletAction(dialog,am);await expect(pay).toBeEnabled();await pay.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>commands.length).toBe(1);expect(quotes).toHaveLength(1);expect(commands[0]).toEqual({path:'/api/payments/chapa/batches/'+quotes[0].id+'/wallet',body:{quoteHash:quotes[0].quoteHash}});await expect(pay).toBeDisabled();await expect(dialog.getByRole('heading',{name:am?'ጨረታዎች ተቀብለዋል':'Bids accepted',exact:true})).toHaveCount(0);await expect(page.locator('[data-header-balance]')).toContainText('25.00');release();await expect(dialog.getByRole('heading',{name:am?'ጨረታዎች ተቀብለዋል':'Bids accepted',exact:true})).toBeVisible();expect(commands).toHaveLength(1);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
 }finally{release();await f.cleanup()}
});

test('an uncertain wallet submission retries its exact original batch after balance and limits change',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:{path:string;body:unknown}[]=[];let debited=false,ownSnapshot:Promise<Record<string,unknown>>|null=null;
 try{
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:debited?'5.00':'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));await page.route('**/api/auctions/*/bids',async route=>{const body=await(ownSnapshot??=route.fetch().then(response=>response.json()));return route.fulfill({json:{...body,...(debited?{open:false,remainingSubmissions:0,ownBids:[{id:randomUUID(),amount:'7.25',acceptedAt:new Date().toISOString()}]}:{})}})});
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});await page.route('**/api/payments/chapa/batches/*/wallet',route=>{commands.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON()});if(commands.length===1){debited=true;return route.abort('failed')}return route.fulfill({json:walletReceipt(quotes[0])})});await page.route('**/api/payments/chapa/checkouts',()=>{throw Error('Wallet recovery must not initialize Chapa')});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await bidInput(dialog,am).fill('7.25');await walletAction(dialog,am).click();const retry=dialog.getByRole('button',{name:am?'ጥያቄውን ያረጋግጡ':'Check submission',exact:true});await expect(retry).toBeEnabled();await expect(page.locator('[data-header-balance]')).toContainText('5.00');expect(quotes).toHaveLength(1);expect(commands).toHaveLength(1);await retry.click();await expect(dialog.getByRole('heading',{name:am?'ጨረታዎች ተቀብለዋል':'Bids accepted',exact:true})).toBeVisible();expect(quotes).toHaveLength(1);expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
 }finally{await f.cleanup()}
});

for(const purpose of ['TOP_UP','BID'] as const)for(const outcome of ['lost-response','pending-without-url'] as const)test(`${purpose} ${outcome} reopens and resumes only its exact hosted request`,async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaIntent[]=[],quotes:BidBatchQuote[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});await page.route('**/api/payments/chapa/checkouts**',route=>{const request=route.request();if(new URL(request.url()).pathname.endsWith('/checkouts')&&request.method()==='POST'){const intent=request.postDataJSON() as ChapaIntent;commands.push(intent);order=pending(intent,order?.id??randomUUID(),quotes.at(-1));if(commands.length===1){if(outcome==='lost-response')return route.abort('failed');order={...order,checkoutUrl:null,reason:'INITIALIZATION_PENDING',verificationState:'UNAVAILABLE'};return route.fulfill({status:202,json:order})}return route.fulfill({json:order})}return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=purpose==='TOP_UP'?await openTopup(page,am):await openBid(page,f.title);if(purpose==='TOP_UP'){await topupInput(dialog,am).fill('17.25');await dialog.locator('[data-top-up-continue]').click()}else{await bidInput(dialog,am).fill('7.25');await dialog.locator('[data-bid-continue]').click()}
  await expect.poll(()=>commands.length).toBe(1);await expect(dialog.getByRole('button',{name:am?'ክፍያውን ይቀጥሉ':'Resume checkout',exact:true})).toBeEnabled();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);dialog=purpose==='TOP_UP'?await openTopupReentry(page,am):await reopenBid(page,f.title);await expect(dialog.locator('[data-wallet-top-up],[data-bid-entry]')).toHaveCount(0);await dialog.getByRole('button',{name:am?'ክፍያውን ይቀጥሉ':'Resume checkout',exact:true}).click();await expect.poll(()=>commands.length).toBe(2);expect(commands[1]).toEqual(commands[0]);expect(quotes).toHaveLength(purpose==='BID'?1:0);await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([order!.checkoutUrl]);await noCustomCheckout(dialog);
 }finally{await f.cleanup()}
});
async function openTopupReentry(page:Page,am:boolean){await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();return dialog}
async function reopenBid(page:Page,title:string){await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();return dialog}

for(const state of ['review','expired'] as const)test(`an unresolved hosted ${state} stays checkable without a new charge or manual authorization form`,async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),commands:ChapaIntent[]=[],checks:string[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{const request=route.request(),path=new URL(request.url()).pathname;if(path.endsWith('/checkouts')&&request.method()==='POST'){const intent=request.postDataJSON() as ChapaIntent;commands.push(intent);const base=pending(intent);order=state==='review'?{...base,status:'NEEDS_REVIEW',checkoutUrl:null,reason:'PROVIDER_REFERENCE_UNAVAILABLE',verificationState:'UNAVAILABLE'}:{...base,expiresAt:new Date(Date.now()-1000).toISOString()};return route.fulfill({json:order})}checks.push(path);return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openTopup(page,am);await dialog.locator('[data-top-up-continue]').click();await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();await noCustomCheckout(dialog);await expect(dialog.getByRole('link',{name:am?'ወደ Chapa ቀጥል':'Continue to Chapa',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:am?'ክፍያውን ይቀጥሉ':'Resume checkout',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true})).toHaveCount(0);if(state==='review')await expect(dialog.getByRole('link',{name:am?'ድጋፍ ያግኙ':'Contact support',exact:true})).toBeVisible();await checked(dialog,am).click();expect(commands).toHaveLength(1);expect(checks.length).toBeGreaterThan(0);expect(checks.every(path=>path==='/api/payments/chapa/checkouts/'+order!.id)).toBe(true);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);await expect(page.locator('[data-header-balance]')).toContainText('25.00');
 }finally{await f.cleanup()}
});

test('a verified cancelled bid preserves selection and requires an explicit fresh hosted payment',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am),quotes:BidBatchQuote[]=[],commands:ChapaIntent[]=[];let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.push(quote);return route.fulfill({json:quote})});await page.route('**/api/payments/chapa/checkouts**',route=>{const request=route.request();if(new URL(request.url()).pathname.endsWith('/checkouts')&&request.method()==='POST'){const intent=request.postDataJSON() as ChapaIntent;commands.push(intent);const created=pending(intent,randomUUID(),quotes.at(-1));order=commands.length===1?{...created,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED'}:created}return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await bidInput(dialog,am).fill('2');await dialog.locator('[data-bid-continue]').click();await expect(dialog.getByRole('heading',{name:am?'ክፍያው አልተጠናቀቀም':'Payment not completed',exact:true})).toBeVisible();expect(commands).toHaveLength(1);await dialog.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true}).click();await expect(dialog.locator('[data-bid-entry]')).toBeVisible();await expect(dialog.getByRole('button',{name:am?'2.00 ያስተካክሉ':'Edit 2.00',exact:true})).toBeVisible();expect(commands).toHaveLength(1);await dialog.locator('[data-bid-continue]').click();await expect.poll(()=>commands.length).toBe(2);expect(quotes).toHaveLength(2);expect(commands[1].key).not.toBe(commands[0].key);expect(commands[1]).toMatchObject({batchId:quotes[1].id,quoteHash:quotes[1].quoteHash});await noCustomCheckout(dialog);
 }finally{await f.cleanup()}
});

test('an untrusted hosted URL cannot open and the original owned payment remains checkable',async({page},info)=>{
 const am=info.project.name==='430',f=await setup(page,am);let order:ChapaCheckoutView|null=null,creates=0;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{if(new URL(route.request().url()).pathname.endsWith('/checkouts')&&route.request().method()==='POST'){creates++;order={...pending(route.request().postDataJSON() as ChapaIntent),checkoutUrl:'https://checkout.chapa.co.untrusted.example/payment'}}return route.fulfill({json:order})});await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openTopup(page,am);await dialog.locator('[data-top-up-continue]').click();await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();await expect(checked(dialog,am)).toBeVisible();await expect(dialog.getByRole('link',{name:am?'ወደ Chapa ቀጥል':'Continue to Chapa',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);await checked(dialog,am).click();expect(creates).toBe(1);await expect(page.locator('[data-header-balance]')).toContainText('25.00');
 }finally{await f.cleanup()}
});
