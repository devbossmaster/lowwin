import {expect,test,type Locator,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {BidBatchReceipt} from '../../src/lib/bid-batch-client';
import type {PersonalBidList,PersonalBidListItem} from '../../src/modules/profile/bid-list';
import type {BidReceipt} from '../../src/modules/auctions/bids';
import {centsToEtb,etbToCents} from '../../src/lib/money';
import {openBid,v1Fixture,wakePayment} from './fixtures';

/** Synthetic transport only: these scenarios never send a wallet debit to the
 * application or contact Chapa. The existing account/auth UI remains real. */
async function walletFixture(page:Page,initial='25.00',am=false){
 const f=await v1Fixture(page,am),walletCommands:Array<{id:string;quoteHash:string}>=[],receipts=new Map<string,BidBatchReceipt>(),sdkLoads:string[]=[];
 let available=initial,revision=0n,debits=0,interrupt=false,rejectFunds=false,holdReads=false,released:()=>void=()=>{};
 const reads=new Promise<void>(resolve=>{released=resolve});
 page.on('request',request=>{if(/\/vendor\/chapa-inline-v1[^/]*\.js/.test(request.url()))sdkLoads.push(request.url())});
 const list=():PersonalBidList=>({items:[...receipts.values()].flatMap(receipt=>receipt.receipts.map(({bid}):PersonalBidListItem=>({id:bid.id,amount:bid.amount,acceptedAt:bid.acceptedAt,outcome:'LIVE',auction:{ruleVersion:receipt.batch.ruleVersion,code:bid.auctionCode,slug:bid.auctionSlug,status:'LIVE',title:f.title,titleAm:f.title,image:{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic checkout regression fixture'},startsAt:f.auction.startsAt?.toISOString()??null,endsAt:f.auction.endsAt?.toISOString()??null,isDemo:false}}))),page:1,pageSize:20,hasNext:false,serverNow:new Date().toISOString()});
 await page.route('**/api/wallet',async route=>{if(holdReads)await reads;return route.fulfill({json:{available,held:'0.00',revision:String(revision),currency:'ETB',bidsEnabled:true,topUp:{enabled:true,reason:null}}})});
 await page.route('**/api/my-bids?*',async route=>{if(holdReads)await reads;return route.fulfill({json:list()})});
 await page.route(/\/api\/payments\/chapa\/batches\/[^/]+\/wallet$/,async route=>{
  const id=new URL(route.request().url()).pathname.split('/').at(-2)!,{quoteHash}=route.request().postDataJSON() as {quoteHash:string};walletCommands.push({id,quoteHash});
  const quote=f.quotes.find(item=>item.id===id);if(!quote||quoteHash!==quote.quoteHash)return route.fulfill({status:409,json:{code:'KEY_REUSED',error:'The original payment details changed.'}});
  let receipt=receipts.get(id);
  if(!receipt){
   if(rejectFunds){rejectFunds=false;available='5.00';return route.fulfill({status:422,json:{code:'INSUFFICIENT_POINTS',error:'Your wallet balance is too low.',wallet:{available,required:quote.total,shortfall:centsToEtb(etbToCents(quote.total)-etbToCents(available)),currency:'ETB'}}})}
   available=centsToEtb(etbToCents(available)-etbToCents(quote.total));revision++;debits++;
   const acceptedAt=new Date().toISOString(),accepted=quote.lines.map(line=>({bid:{id:randomUUID(),auctionCode:String(f.auction.publicCode),auctionSlug:quote.auctionSlug,amount:line.number,acceptedAt,termsVersion:quote.feeVersion,feePoints:line.grossFee},charge:{feePoints:line.grossFee,discountPoints:line.discount,netFeePoints:line.netFee,newlyUnavailable:line.netFee}}));
   receipt={batch:{...quote,status:'ACCEPTED'},receipts:accepted,wallet:{available,held:'0.00',revision:String(revision)},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:quote.total,acceptedBidIds:accepted.map(({bid})=>bid.id)}};receipts.set(id,receipt);
  }
  if(interrupt){interrupt=false;return route.abort('failed')}
  return route.fulfill({json:receipt});
 });
 return {...f,walletCommands,sdkLoads,receipts,debits:()=>debits,freezeReads:()=>{holdReads=true},releaseReads:()=>{holdReads=false;released()},interruptNextWalletReply:()=>{interrupt=true},rejectNextWalletForFunds:()=>{rejectFunds=true},setBalance:(next:string)=>{available=next;revision++},list,cleanup:async()=>{holdReads=false;released();await f.cleanup()}};
}

async function chooseBids(page:Page,title:string,numbers=['4.25']){
 const dialog=await openBid(page,title),input=dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]');
 for(let i=0;i<numbers.length;i++){await input.fill(numbers[i]);if(i<numbers.length-1)await dialog.getByRole('button',{name:'Add bid amount',exact:true}).click()}
 await dialog.locator('[data-bid-continue]').click();
 if(numbers.length>1)await dialog.getByRole('button',{name:'Pay securely',exact:true}).click();
 await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();return dialog;
}
async function selectWallet(dialog:Locator){await dialog.getByRole('radio',{name:'Lowwin Wallet',exact:true}).check();await expect(dialog.getByRole('textbox',{name:'Payment phone number',exact:true})).toHaveCount(0)}

test('wallet stays independent of unavailable Chapa, submits once and publishes committed balance and cached bids',async({page},info)=>{
 test.skip(info.project.name!=='360','One isolated wallet/cache lifecycle.');const f=await walletFixture(page);
 try{
  await page.route('**/api/payments/chapa/v1/config',route=>route.fulfill({status:503,json:{code:'UNAVAILABLE',error:'Synthetic external outage'}}));
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));await expect(page.getByRole('heading',{name:'No live bids yet',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Home',exact:true}).click();const dialog=await chooseBids(page,f.title,['4.25','5.50']);await selectWallet(dialog);await expect(dialog.locator('[data-payment-action]')).toHaveText('Pay 20.00 ETB from wallet');await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  f.freezeReads();await dialog.locator('[data-payment-action]').evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();
  expect(f.walletCommands).toHaveLength(1);expect(f.debits()).toBe(1);await expect(page.locator('[data-header-balance]')).toContainText('5.00');await expect(dialog).toContainText('Internal wallet');await expect(dialog).not.toContainText('Waiting for authorization');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('link',{name:'My Bids',exact:true}).click();
  const receipt=[...f.receipts.values()][0];for(const {bid} of receipt.receipts)await expect(page.locator(`[data-bid-id="${bid.id}"]`)).toBeVisible();await expect(page.locator('[data-bid-id]')).toHaveCount(2);expect(new Set(receipt.receipts.map(({bid})=>bid.amount))).toEqual(new Set(['4.25','5.50']));
  expect(f.commands).toHaveLength(0);expect(f.sdkCommands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);expect(f.checks).toHaveLength(0);expect(f.unexpected).toHaveLength(0);await expect(page.locator('iframe[title="Lowwin payment connection"]')).toHaveCount(0);
 }finally{await f.cleanup()}
});

test('insufficient wallet shows exact balance, requirement and shortfall without submitting or switching payment',async({page},info)=>{
 const f=await walletFixture(page,'5.00');
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await chooseBids(page,f.title,['4.25','5.50']);await selectWallet(dialog);const shortfall=dialog.locator('[data-wallet-insufficient]');await expect(shortfall).toBeVisible();await expect(shortfall.locator('dl > div').nth(0)).toContainText('5.00');await expect(shortfall.locator('dl > div').nth(1)).toContainText('20.00');await expect(shortfall.locator('dl > div').nth(2)).toContainText('15.00');await expect(dialog.getByRole('button',{name:'Top up wallet',exact:true})).toBeVisible();await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await expect(dialog.getByRole('radio',{name:'Lowwin Wallet',exact:true})).toBeChecked();
  expect(f.walletCommands).toHaveLength(0);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);expect(await dialog.locator('[data-sheet-body]').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await dialog.screenshot({path:info.outputPath('wallet-insufficient.png')});
 }finally{await f.cleanup()}
});

test('a server-confirmed wallet shortfall preserves the selected amounts and offers explicit recovery',async({page},info)=>{
 test.skip(info.project.name!=='360','One authoritative balance change check.');const f=await walletFixture(page);f.rejectNextWalletForFunds();
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await chooseBids(page,f.title,['4.25','5.50']);await selectWallet(dialog);await dialog.locator('[data-payment-action]').click();await expect(dialog.locator('[data-wallet-insufficient]')).toContainText('15.00');await expect(dialog.locator('[data-payment-method-form]')).toContainText('4.25');await expect(dialog.locator('[data-payment-method-form]')).toContainText('5.50');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();expect(f.walletCommands).toHaveLength(1);expect(f.debits()).toBe(0);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('an interrupted wallet reply recovers the same batch after closing without a second debit',async({page},info)=>{
 test.skip(info.project.name!=='360','One ambiguous internal payment recovery.');const f=await walletFixture(page);f.interruptNextWalletReply();
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=await chooseBids(page,f.title);await selectWallet(dialog);await dialog.locator('[data-payment-action]').click();await expect(dialog).toContainText('Confirm your wallet payment');await expect(dialog.getByRole('button',{name:'Retry original payment',exact:true})).toBeVisible();await expect(dialog).not.toContainText('Nothing was charged');expect(f.debits()).toBe(1);const original=f.walletCommands[0];
  await dialog.getByRole('button',{name:'Close',exact:true}).first().click();dialog=await openBid(page,f.title);await expect(dialog.getByRole('button',{name:'Retry original payment',exact:true})).toBeVisible();expect(f.walletCommands).toHaveLength(1);await dialog.getByRole('button',{name:'Retry original payment',exact:true}).click();await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(f.walletCommands).toEqual([original,original]);expect(f.debits()).toBe(1);expect(f.quotes).toHaveLength(1);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('verified top-up restores the bid draft and a fresh quote before another explicit wallet Pay',async({page},info)=>{
 test.skip(info.project.name!=='360','One embedded funding and explicit wallet confirmation.');const f=await walletFixture(page,'5.00');
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await chooseBids(page,f.title,['4.25','5.50']);await selectWallet(dialog);const original=f.quotes.at(-1)!.id;await dialog.getByRole('button',{name:'Top up wallet',exact:true}).click();await expect(dialog.locator('[data-wallet-top-up]')).toBeVisible();await dialog.locator('[data-wallet-top-up] input[inputmode="decimal"]').fill('15');await dialog.locator('[data-top-up-continue]').click();await expect(dialog.getByRole('radio',{name:'Lowwin Wallet',exact:true})).toHaveCount(0);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(1);expect(f.commands[0]).toMatchObject({purpose:'TOP_UP',amount:'15.00',paymentMethod:'telebirr'});
  f.setBalance('20.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(dialog.locator('[data-bid-funding-notice]')).toContainText('Wallet topped up');await expect(dialog.locator('[data-payment-method-form]')).toContainText('4.25');await expect(dialog.locator('[data-payment-method-form]')).toContainText('5.50');await expect(dialog.getByRole('radio',{name:'Lowwin Wallet',exact:true})).toBeChecked();await expect.poll(()=>f.quotes.length).toBe(2);expect(f.quotes[1].id).not.toBe(original);expect(f.walletCommands).toHaveLength(0);await expect(page.getByRole('dialog')).toHaveCount(1);await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  await dialog.locator('[data-payment-action]').click();await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(f.walletCommands).toHaveLength(1);expect(f.walletCommands[0].id).toBe(f.quotes[1].id);expect(f.receipts.get(f.quotes[1].id)?.payment?.total).toBe('20.00');expect(f.debits()).toBe(1);expect(f.commands).toHaveLength(1);expect(f.sdkCommands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('an externally accepted bid clears its retained funding draft before checkout is reopened',async({page},info)=>{
 test.skip(info.project.name!=='360','One funded-draft external acceptance lifecycle.');const f=await walletFixture(page,'5.00');
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));let dialog=await chooseBids(page,f.title,['4.25','5.50']);await selectWallet(dialog);await dialog.getByRole('button',{name:'Top up wallet',exact:true}).click();await dialog.locator('[data-wallet-top-up] input[inputmode="decimal"]').fill('15');await dialog.locator('[data-top-up-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(1);
  f.setBalance('20.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(dialog.locator('[data-bid-funding-notice]')).toContainText('Wallet topped up');await expect.poll(()=>f.quotes.length).toBe(2);const quote=f.quotes[1];
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await expect(dialog.getByRole('textbox',{name:'Payment phone number',exact:true})).toHaveValue('911652904');expect(f.commands).toHaveLength(1);expect(f.walletCommands).toHaveLength(0);await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.sdkCommands.length).toBe(2);expect(f.commands[1]).toMatchObject({purpose:'BID',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr'});
  const acceptedAt=new Date().toISOString(),ownBids=quote.lines.map(line=>({id:randomUUID(),amount:line.number,acceptedAt}));
  const receipts:BidReceipt[]=quote.lines.map((line,index)=>({bid:{...ownBids[index],auctionCode:String(f.auction.publicCode),auctionSlug:quote.auctionSlug,termsVersion:quote.feeVersion,feePoints:line.grossFee},hold:{previousMax:'0.00',newMax:'0.00',extraReserved:'0.00'},charge:{feePoints:line.grossFee,discountPoints:line.discount,netFeePoints:line.netFee,newlyUnavailable:line.netFee},wallet:{available:'20.00',held:'0.00'},remainingSubmissions:100-ownBids.length,ownBids}));
  f.setOrder({status:'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:receipts[0],receipts,batch:{...quote,status:'ACCEPTED'},batchNumbers:quote.lines.map(line=>line.number)});await wakePayment(page);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Done',exact:true}).click();dialog=await openBid(page,f.title);
  const entry=dialog.locator('[data-bid-step="entry"]');await expect(entry).toBeVisible();await expect(entry.locator('input[inputmode="decimal"]')).toHaveValue('');await expect(entry.getByRole('button',{name:'Remove 4.25',exact:true})).toHaveCount(0);await expect(entry.getByRole('button',{name:'Remove 5.50',exact:true})).toHaveCount(0);await expect(dialog.locator('[data-bid-continue]')).toBeDisabled();await expect(dialog.locator('[data-bid-total]')).toContainText('0.00');expect(f.commands).toHaveLength(2);expect(f.sdkCommands).toHaveLength(2);expect(f.walletCommands).toHaveLength(0);expect(f.quotes).toHaveLength(2);expect(f.unexpected).toHaveLength(0);await expect(page.getByRole('dialog')).toHaveCount(1);
 }finally{await f.cleanup()}
});

for(const am of [false,true])test(`wallet and external selection stay distinct and readable ${am?'AM':'EN'}`,async({page},info)=>{
 test.skip(info.project.name==='360','Visual pair at 320 and 430.');const f=await walletFixture(page,'12345.67',am);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await chooseBids(page,f.title);await dialog.locator('[data-lowwin-wallet] input[value="wallet"]').check();await expect(dialog.locator('[data-payment-action]')).toBeEnabled();await expect(dialog.locator('input[type="tel"]')).toHaveCount(0);await expect(dialog.locator('[data-lowwin-wallet]')).toContainText('12,345.67');await expect(dialog.locator('[data-chapa-methods] input[type="radio"]')).toHaveCount(5);await expect(page.getByRole('dialog')).toHaveCount(1);expect(await dialog.locator('[data-sheet-body]').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.walletCommands).toHaveLength(0);expect(f.commands).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);await dialog.screenshot({path:info.outputPath(`wallet-selection-${am?'am':'en'}-${info.project.name}.png`)});
 }finally{await f.cleanup()}
});
