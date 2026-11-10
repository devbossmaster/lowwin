import {expect,type Locator,type Page,type Route,type Request} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from '../chapa-browser/fixtures';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import type {BidBatchQuote,ChapaDirectIntent} from '../../src/lib/bid-batch-client';

export const supportedMethods=[
 {name:'Telebirr',slug:'telebirr',minAmountCents:'100',maxAmountCents:'10000000'},
 {name:'CBE Birr',slug:'cbebirr',minAmountCents:'100',maxAmountCents:'10000000'},
 {name:'M-Pesa',slug:'mpesa',minAmountCents:'500',maxAmountCents:'10000000'},
];

export async function setup(page:Page,am:boolean,methods=supportedMethods){
 const f=await fixture(page,am);
 const network={combined:0,quotes:0,direct:0,commands:[] as unknown[]};
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/api/payments/chapa/direct/bid'){network.combined++;network.commands.push(request.postDataJSON())}else if(path==='/api/payments/chapa/batches/quote')network.quotes++;else if(path==='/api/payments/chapa/direct')network.direct++});
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route('**/api/payments/chapa/methods*',route=>route.fulfill({json:{methods,paymentPhone:'251911652904'}}));
 return {...f,network,async cleanup(){await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}};
}

/** Keep existing scenario callbacks while simulating one atomic server command.
 * Quote preparation runs in memory, never through another browser HTTP request.
 * An interrupted command reuses its quote/key. Changed totals cannot dispatch. */
export async function mockBidCommand(page:Page,handlers:{quote:(route:Route)=>unknown;direct:(route:Route)=>unknown}){
 const quotes=new Map<string,BidBatchQuote>();
 const requestWith=(request:Request,body:unknown)=>new Proxy(request,{get(target,key){if(key==='postDataJSON')return ()=>body;if(key==='postData')return ()=>JSON.stringify(body);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 await page.route('**/api/payments/chapa/direct',handlers.direct);
 await page.route('**/api/payments/chapa/direct/bid',async route=>{
  const body=route.request().postDataJSON() as {key:string;purpose:'BID';auctionSlug:string;numbers:string[];feeVersion:number;couponId?:string;approvedTotal:string;paymentMethod:string;phone:string};
  let quote=quotes.get(body.key);
  if(!quote){
   const capture=new Proxy(route,{get(target,key){if(key==='request')return ()=>requestWith(target.request(),body);if(key==='fulfill')return async(options:{json:BidBatchQuote})=>{quote=options.json};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
   await handlers.quote(capture);if(!quote)throw Error('Combined mock requires an authoritative quote');quotes.set(body.key,quote);
  }
  if(Number(body.approvedTotal)!==Number(quote.total))return route.fulfill({status:200,json:{kind:'quote',quote}});
  const command:ChapaDirectIntent={key:body.key,purpose:'BID',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:body.paymentMethod,phone:body.phone};
  const direct=new Proxy(route,{get(target,key){if(key==='request')return ()=>requestWith(target.request(),command);if(key==='fulfill')return (options:{status?:number;json:unknown})=>target.fulfill({...options,json:options.status&&options.status>=400?options.json:{kind:'payment',order:options.json}});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  return handlers.direct(direct);
 });
}

export async function openBid(page:Page,title:string){
 await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();
 const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-bid-entry]')).toBeVisible();return dialog;
}
export function amount(dialog:Locator,am:boolean){return dialog.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true})}
export function phone(dialog:Locator,am:boolean){return dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true})}
export function add(dialog:Locator,am:boolean){return dialog.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true})}
export function edit(dialog:Locator,am:boolean,value:string){return dialog.getByRole('button',{name:am?`${value} ያስተካክሉ`:`Edit ${value}`,exact:true})}
export function remove(dialog:Locator,am:boolean,value:string){return dialog.getByRole('button',{name:am?`${value} ያስወግዱ`:`Remove ${value}`,exact:true})}
export function pay(dialog:Locator){return dialog.locator('[data-payment-action]')}
export function retryOriginal(dialog:Locator,am:boolean){return dialog.getByRole('button',{name:am?'የመጀመሪያውን ጥያቄ ይድገሙ':'Retry original request',exact:true})}
export function tryAgain(dialog:Locator,am:boolean){return dialog.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true})}

export function quoteFor(auctionSlug:string,numbers:string[],feeCents=1000):BidBatchQuote{
 const totalCents=numbers.length*feeCents;
 return {id:randomUUID(),quoteHash:'b'.repeat(64),auctionSlug,feeVersion:1,ruleVersion:'lowest-unique-v4',lines:numbers.map((value,position)=>({position,number:Number(value).toFixed(2),grossFee:(feeCents/100).toFixed(2),discount:'0.00',netFee:(feeCents/100).toFixed(2)})),entryCount:numbers.length,total:(totalCents/100).toFixed(2),totalCents:String(totalCents),grossTotal:(totalCents/100).toFixed(2),discountTotal:'0.00',status:'QUOTED'};
}
export function directOrder(command:ChapaDirectIntent,batch:BidBatchQuote,authType:'USSD'|'OTP'='USSD'):ChapaCheckoutView{
 return {...pending({key:command.key,purpose:'BID',amount:batch.lines[0].number,auctionSlug:batch.auctionSlug,feeVersion:batch.feeVersion}),chargeType:'DIRECT',authType,authorizationReference:'CH-'+randomUUID(),checkoutUrl:null,status:'AUTH_NEEDED',reason:null,amount:batch.total,amountCents:batch.totalCents,payerPhoneMasked:'251*****2904',paymentMethod:command.paymentMethod,providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',batch,batchNumbers:batch.lines.map(line=>line.number),pollAfterMs:1000};
}
export function accepted(order:ChapaCheckoutView):ChapaCheckoutView{
 const bids=order.batch!.lines.map(line=>({id:randomUUID(),auctionCode:'Synthetic QA',auctionSlug:order.auctionSlug!,amount:line.number,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'}));
 return {...order,status:'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:{bid:bids[0],hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:order.amount,newlyUnavailable:order.amount,netFeePoints:order.amount},wallet:{available:'25',held:'0'},remainingSubmissions:100-bids.length,ownBids:bids.map(b=>({id:b.id,amount:b.amount,acceptedAt:b.acceptedAt}))}};
}

export async function expectInViewport(element:Locator,page:Page){
 const box=await element.boundingBox(),viewport=page.viewportSize()!;
 expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.y).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);
}
