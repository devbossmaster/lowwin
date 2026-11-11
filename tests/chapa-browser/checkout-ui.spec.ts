import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending,batchQuote} from './fixtures';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';
import type {BidBatchQuote} from '../../src/lib/bid-batch-client';

async function openTopup(page:Page,am:boolean){
 await expect(page.locator('[data-header-balance]')).toContainText('25.00');
 await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-wallet-top-up]')).toBeVisible();return dialog;
}
async function openBid(page:Page,title:string){
 await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();
 const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-bid-entry]')).toBeVisible();return dialog;
}
function credited(order:ChapaCheckoutView):ChapaCheckoutView{
 const bid={id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:order.auctionSlug!,amount:order.batchNumbers?.[0]??order.bidNumber??'2.00',acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:order.amount};
 return {...order,status:order.purpose==='TOP_UP'?'CREDITED':'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:order.purpose==='TOP_UP'?null:{bid,hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:order.amount,newlyUnavailable:order.amount},wallet:{available:'25',held:'0'},remainingSubmissions:100-(order.batchNumbers?.length??1),ownBids:[{id:bid.id,amount:bid.amount,acceptedAt:bid.acceptedAt}]}};
}

test('one bid action freezes every selected number and opens V1 hosted checkout without a custom payment form',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),commands:ChapaIntent[]=[],quotes=new Map<string,BidBatchQuote>();let order:ChapaCheckoutView|null=null,paid=false,quoteReads=0,directCalls=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quoteReads++;const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.set(quote.id,quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/direct',route=>{directCalls++;return route.abort()});
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const req=route.request();if(new URL(req.url()).pathname.endsWith('/checkouts')){
    if(req.method()!=='POST')return route.fulfill({json:{items:order?[order]:[],page:1,nextPage:null}});
    const command=req.postDataJSON() as ChapaIntent;commands.push(command);expect(command.purpose).toBe('BID');expect('batchId'in command).toBe(true);
    if(command.purpose!=='BID'||!('batchId'in command))throw Error('Expected the server-owned hosted batch contract.');
    order=pending(command,randomUUID(),quotes.get(command.batchId));return route.fulfill({status:201,json:order});
   }return route.fulfill({json:paid?credited(order!):order});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title),input=dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true});
  for(const number of ['2','3']){await input.fill(number);await dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click()}await input.fill('4');
  await expect(dialog.locator('[data-bid-total]')).toContainText('30.00');expect(quoteReads).toBe(0);expect(commands).toHaveLength(0);
  await expect(dialog.getByRole('radio')).toHaveCount(0);await expect(dialog.locator('input[type="tel"],input[autocomplete="one-time-code"],[data-funding-selector]')).toHaveCount(0);
  const pay=dialog.locator('[data-bid-continue]');await expect(pay).toHaveText(am?'በChapa ይክፈሉ':'Pay with Chapa');await expect(pay).toBeEnabled();await pay.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});
  await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();await expect.poll(()=>commands.length).toBe(1);expect(quoteReads).toBe(1);
  const quote=[...quotes.values()][0];expect(quote.lines.map(line=>line.number)).toEqual(['2.00','3.00','4.00']);expect(Object.keys(commands[0]).sort()).toEqual(['batchId','key','purpose','quoteHash']);expect(commands[0]).toMatchObject({batchId:quote.id,quoteHash:quote.quoteHash});
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([order!.checkoutUrl]);expect(order!.checkoutUrl).toMatch(/^https:\/\/checkout\.chapa\.co\//);expect(directCalls).toBe(0);
  await expect(dialog.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toHaveCount(0);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
  paid=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toBeVisible();expect(commands).toHaveLength(1);await expect(dialog.getByRole('link',{name:am?'የእኔ ጨረታዎች':'View My Bids',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.$disconnect()}
});

test('top-up validates the amount and updates the wallet only after server-confirmed fulfillment',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),commands:ChapaIntent[]=[];let order:ChapaCheckoutView|null=null,phase:'pending'|'provider-success'|'credited'='pending';
 try{
  await page.route('**/api/wallet',route=>route.fulfill({json:{available:phase==='credited'?'35.75':'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const req=route.request();if(new URL(req.url()).pathname.endsWith('/checkouts')&&req.method()==='POST'){const command=req.postDataJSON() as ChapaIntent;commands.push(command);order=pending(command);return route.fulfill({json:order})}
   return route.fulfill({json:phase==='credited'?credited(order!):{...order,...(phase==='provider-success'?{providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openTopup(page,am),amount=dialog.getByRole('textbox',{name:am?'የሚያስገቡት መጠን':'Amount to top up',exact:true}),pay=dialog.locator('[data-top-up-continue]');
  await expect(dialog.getByRole('radio')).toHaveCount(0);await expect(dialog.locator('[data-direct-checkout],input[type="tel"],input[autocomplete="one-time-code"]')).toHaveCount(0);
  for(const value of ['0','50000']){await amount.fill(value);await expect(pay).toBeDisabled()}await dialog.getByRole('button',{name:'250',exact:true}).click();await expect(amount).toHaveValue('250');await amount.fill('10.75');
  await expect(pay).toBeEnabled();await pay.evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>commands.length).toBe(1);expect(commands[0]).toMatchObject({purpose:'TOP_UP',amount:'10.75'});expect(Object.keys(commands[0]).sort()).toEqual(['amount','key','purpose']);
  await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();await expect(page.locator('[data-header-balance]')).toContainText('25.00');
  phase='provider-success';await dialog.getByRole('button',{name:am?'ክፍያ ያረጋግጡ':'Check payment',exact:true}).click();await expect(dialog.getByRole('heading',{name:am?'መለያዎ በመዘመን ላይ…':'Updating your account…',exact:true})).toBeVisible();await expect(page.locator('[data-header-balance]')).toContainText('25.00');
  phase='credited';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(dialog.getByRole('heading',{name:am?'ዋሌት ገብቷል':'Wallet credited',exact:true})).toBeVisible();await expect(page.locator('[data-header-balance]')).toContainText('35.75');expect(commands).toHaveLength(1);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.db.$disconnect()}
});

for(const purpose of ['TOP_UP','BID'] as const)for(const outcome of ['lost-response','pending-without-url'] as const)test(`${purpose} ${outcome} resumes the exact original intent after closing and reopening`,async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),commands:ChapaIntent[]=[],quotes=new Map<string,BidBatchQuote>();let order:ChapaCheckoutView|null=null,quoteReads=0;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quoteReads++;const quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers);quotes.set(quote.id,quote);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const req=route.request();if(new URL(req.url()).pathname.endsWith('/checkouts')&&req.method()==='POST'){
    const command=req.postDataJSON() as ChapaIntent;commands.push(command);const quote=command.purpose==='BID'&&'batchId'in command?quotes.get(command.batchId):undefined;
    order=pending(command,order?.id??randomUUID(),quote);
    if(commands.length===1){if(outcome==='lost-response')return route.abort('failed');order={...order,checkoutUrl:null,reason:'INITIALIZATION_PENDING',verificationState:'UNAVAILABLE'};return route.fulfill({status:202,json:order})}
    return route.fulfill({json:order});
   }return route.fulfill({json:order});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=purpose==='TOP_UP'?await openTopup(page,am):await openBid(page,f.title);
  if(purpose==='TOP_UP'){await dialog.getByRole('textbox',{name:am?'የሚያስገቡት መጠን':'Amount to top up',exact:true}).fill('17.25');await dialog.locator('[data-top-up-continue]').click()}
  else{await dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true}).fill('7.25');await dialog.locator('[data-bid-continue]').click()}
  await expect.poll(()=>commands.length).toBe(1);await expect(dialog.getByRole('button',{name:am?'ክፍያውን ይቀጥሉ':'Resume checkout',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  if(purpose==='TOP_UP')await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();else await page.locator('.auction-card').filter({hasText:f.title}).getByRole('button').click();dialog=page.getByRole('dialog');
  await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();await expect(dialog.locator('[data-wallet-top-up],[data-bid-entry]')).toHaveCount(0);await dialog.getByRole('button',{name:am?'ክፍያውን ይቀጥሉ':'Resume checkout',exact:true}).click();
  await expect.poll(()=>commands.length).toBe(2);expect(commands[1]).toEqual(commands[0]);expect(quoteReads).toBe(purpose==='BID'?1:0);await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([order!.checkoutUrl]);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.$disconnect()}
});

test('a changed server quote requires explicit acceptance of the updated fee before opening Chapa',async({page})=>{
 const f=await fixture(page,false),commands:ChapaIntent[]=[];let quote:BidBatchQuote|null=null,quoteReads=0,order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>{quoteReads++;quote=batchQuote(f.auction.slug!,route.request().postDataJSON().numbers,1100);return route.fulfill({json:quote})});
  await page.route('**/api/payments/chapa/checkouts**',route=>{if(new URL(route.request().url()).pathname.endsWith('/checkouts')&&route.request().method()==='POST'){const command=route.request().postDataJSON() as ChapaIntent;commands.push(command);order=pending(command,randomUUID(),quote!)}return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openBid(page,f.title);await dialog.getByRole('textbox',{name:'Your bid amount',exact:true}).fill('2');await expect(dialog.locator('[data-bid-total]')).toContainText('10.00');await dialog.locator('[data-bid-continue]').click();
  await expect(dialog.getByRole('alert')).toContainText('The fee changed');await expect(dialog.locator('[data-bid-total]')).toContainText('11.00');expect(commands).toHaveLength(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);
  await dialog.locator('[data-bid-continue]').click();await expect.poll(()=>commands.length).toBe(1);expect(quoteReads).toBe(1);await expect(dialog.locator('[data-hosted-checkout-status]')).toContainText('11.00');
 }finally{await f.db.$disconnect()}
});

test('an untrusted hosted URL never opens and leaves the owned payment checkable',async({page})=>{
 const f=await fixture(page,false);let order:ChapaCheckoutView|null=null;
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{if(new URL(route.request().url()).pathname.endsWith('/checkouts')&&route.request().method()==='POST')order={...pending(route.request().postDataJSON() as ChapaIntent),checkoutUrl:'https://checkout.chapa.co.evil.example/steal'};return route.fulfill({json:order})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await openTopup(page,false);await dialog.locator('[data-top-up-continue]').click();await expect(dialog.locator('[data-hosted-checkout-status]')).toBeVisible();await expect(dialog.getByRole('button',{name:'Check payment',exact:true})).toBeVisible();await expect(dialog.getByRole('link',{name:'Continue to Chapa',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>Reflect.get(window,'chapaOpened')??[])).toEqual([]);await expect(page.locator('[data-header-balance]')).toContainText('25.00');
 }finally{await f.db.$disconnect()}
});
