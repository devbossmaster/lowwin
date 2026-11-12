import {expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from '../chapa-browser/fixtures';
import type {BidBatchQuote} from '../../src/lib/bid-batch-client';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import type {BidReceipt} from '../../src/modules/auctions/bids';
import {etbToCents} from '../../src/lib/money';

export type InlineCommand={key:string;purpose:'BID'|'TOP_UP';amount?:string;batchId?:string;quoteHash?:string;flow:'INLINE'|'HOSTED';paymentMethod:string;phone:string};

/** Real loopback account/authentication UI with synthetic owned payment state.
 * Every provider HTTP origin is intercepted; these fixtures cannot charge. */
export async function inlineFixture(page:Page,am=false){
 const f=await fixture(page,am),commands:InlineCommand[]=[],quotes:BidBatchQuote[]=[],checks:string[]=[],resolutions:string[]=[],authorizations:Array<{otp?:string}>=[],sdkLoads:string[]=[],unexpected:string[]=[],owned=new Map<string,ChapaCheckoutView>();
 let order:ChapaCheckoutView|null=null,fee=1000,available='25.00',unavailable=false,interrupt=false,activeChecks=0,maxChecks=0,authType:'USSD'|'OTP'='USSD',invalidOtp=false;
 const title=am?'የሙከራ 45W 20,000mAh ፓወር ባንክ — '+f.title:f.title;
 if(am)await f.db.product.update({where:{id:f.auction.productId!},data:{titleAm:title}});
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route(/https:\/\/(?:api|checkout)\.chapa\.(?:co|global)\//,route=>{unexpected.push(route.request().url());return route.abort()});
 await page.route('https://inline.chapaservices.net/**',route=>{unexpected.push(route.request().url());return route.abort()});
 await page.route('**/vendor/chapa-inline-v1*.js',route=>{sdkLoads.push(route.request().url());return route.abort()});
 await page.route('**/api/wallet',route=>route.fulfill({json:{available,held:'0.00',revision:'0',currency:'ETB',bidsEnabled:true,topUp:{enabled:true,reason:null}}}));
 await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[],page:1,nextPage:null}}));
 await page.route('**/api/payments/chapa/inline/config',route=>route.fulfill({json:{apiVersion:'v2',enabled:true,configured:true,mode:'test',minTopup:'1.00',maxTopup:'43200.00',methods:[{name:'telebirr',slug:'telebirr'},{name:'CBE Birr',slug:'cbebirr'},{name:'M-Pesa',slug:'mpesa'}],phone:'251911652904',cbeBankEnabled:true,cbeGuideUrl:'/test-assets/cbe-guide.mp4'}}));
 await page.route('**/test-assets/cbe-guide.mp4',route=>route.fulfill({contentType:'video/mp4',body:Buffer.from([])}));
 await page.route('**/api/payments/chapa/batches/quote',route=>{
  const numbers=route.request().postDataJSON().numbers as string[],total=fee*numbers.length;
  const quote:BidBatchQuote={id:randomUUID(),quoteHash:'b'.repeat(64),auctionSlug:f.auction.slug!,feeVersion:1,ruleVersion:'lowest-unique-v4',lines:numbers.map((number,position)=>({position,number,grossFee:(fee/100).toFixed(2),discount:'0.00',netFee:(fee/100).toFixed(2)})),entryCount:numbers.length,total:(total/100).toFixed(2),totalCents:String(total),grossTotal:(total/100).toFixed(2),discountTotal:'0.00',status:'QUOTED'};
  quotes.push(quote);return route.fulfill({json:quote});
 });
 await page.route('**/api/payments/chapa/inline',route=>{
  const command=route.request().postDataJSON() as InlineCommand;commands.push(command);
  const previous=owned.get(command.key);if(previous)return route.fulfill({json:{order:previous}});
  const quote=quotes.find(item=>item.id===command.batchId),amount=command.purpose==='BID'?quote!.total:command.amount!,id=randomUUID(),reference='CHfixture'+id.replaceAll('-','').slice(0,10);
  order={...pending(command.purpose==='BID'?{key:command.key,purpose:'BID',auctionSlug:quote!.auctionSlug,amount:quote!.lines[0].number,feeVersion:quote!.feeVersion}:{key:command.key,purpose:'TOP_UP',amount},id),apiVersion:'v2',flowVersion:4,chargeType:command.flow==='HOSTED'?'HOSTED':'INLINE',amount,amountCents:String(etbToCents(amount)),merchantReference:'LW'+id.replaceAll('-','').slice(0,18),status:command.flow==='HOSTED'?'PENDING':'AUTH_NEEDED',providerStatus:null,verificationState:'UNVERIFIED',reason:null,checkoutUrl:command.flow==='HOSTED'?'https://checkout.chapa.global/owned-'+id:null,authType:command.flow==='HOSTED'?null:authType,authorizationReference:command.flow==='HOSTED'?null:reference,paymentMethod:command.paymentMethod,payerPhoneMasked:'251*****2904',pollAfterMs:2000,...(quote?{batch:quote,batchNumbers:quote.lines.map(line=>line.number)}:{})};
  owned.set(command.key,order);if(interrupt){interrupt=false;return route.abort('failed')}return route.fulfill({json:{order}});
 });
 await page.route(/\/api\/payments\/chapa\/inline\?key=/,route=>{const key=new URL(route.request().url()).searchParams.get('key')??'';resolutions.push(key);const saved=owned.get(key),result=saved&&order?.id===saved.id?order:saved;return route.fulfill(result?{json:result}:{status:404,json:{code:'NOT_FOUND',error:'Payment not found.'}})});
 await page.route('**/api/payments/chapa/checkouts/**',async route=>{
  const isCheck=route.request().method()==='POST';if(isCheck){activeChecks++;maxChecks=Math.max(maxChecks,activeChecks);checks.push(new URL(route.request().url()).pathname.split('/').at(-1)!)}
  try{await new Promise(resolve=>setTimeout(resolve,30));return await route.fulfill(unavailable?{status:503,json:{code:'UNAVAILABLE',error:'Synthetic connection interruption'}}:{json:order})}finally{if(isCheck)activeChecks--}
 });
 await page.route(/\/api\/payments\/chapa\/checkouts\/[^/]+\/authorize$/,route=>{
  const body=route.request().postDataJSON() as {otp?:string};authorizations.push(body);
  if(invalidOtp){invalidOtp=false;return route.fulfill({status:422,json:{code:'INVALID_OTP',error:'The code was not accepted.'}})}
  return route.fulfill({json:order});
 });
 const setOrder=(next:Partial<ChapaCheckoutView>)=>{if(!order)throw Error('Owned fixture attempt is missing');order={...order,...next}};
 const acceptBids=()=>{
  if(!order?.batch)throw Error('Owned bid quote is missing');const quote=order.batch,acceptedAt=new Date().toISOString(),ownBids=quote.lines.map(line=>({id:randomUUID(),amount:line.number,acceptedAt}));
  const receipts:BidReceipt[]=quote.lines.map((line,index)=>({bid:{...ownBids[index],auctionCode:String(f.auction.publicCode),auctionSlug:quote.auctionSlug,termsVersion:quote.feeVersion,feePoints:line.grossFee},hold:{previousMax:'0.00',newMax:'0.00',extraReserved:'0.00'},charge:{feePoints:line.grossFee,discountPoints:line.discount,netFeePoints:line.netFee,newlyUnavailable:line.netFee},wallet:{available,held:'0.00'},remainingSubmissions:100-ownBids.length,ownBids}));
  setOrder({status:'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:receipts[0],receipts,batch:{...quote,status:'ACCEPTED'}});
 };
 return {...f,title,commands,quotes,checks,resolutions,authorizations,sdkLoads,unexpected,setOrder,acceptBids,order:()=>{if(!order)throw Error('Owned fixture attempt is missing');return order},setBalance:(next:string)=>{available=next},setUnavailable:(value:boolean)=>{unavailable=value},setFee:(value:number)=>{fee=value},setAuthType:(value:'USSD'|'OTP')=>{authType=value},rejectNextOtp:()=>{invalidOtp=true},interruptNextInitialization:()=>{interrupt=true},maxActiveChecks:()=>maxChecks,cleanup:async()=>{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}};
}

export async function openBid(page:Page,title:string){await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();return page.getByRole('dialog')}
export async function selectBids(page:Page,title:string,numbers=['4.25'],am=false){const dialog=await openBid(page,title),input=dialog.locator('[data-bid-step="entry"] input[inputmode="decimal"]');for(let index=0;index<numbers.length;index++){await input.fill(numbers[index]);if(index<numbers.length-1)await dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click()}await dialog.locator('[data-bid-continue]').click();if(numbers.length>1)await dialog.getByRole('button',{name:am?'በደህና ይክፈሉ':'Pay securely',exact:true}).click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();return dialog}
export async function wakePayment(page:Page){await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'))})}
