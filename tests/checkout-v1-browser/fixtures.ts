import {type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from '../chapa-browser/fixtures';
import type {BidBatchQuote} from '../../src/lib/bid-batch-client';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import {etbToCents} from '../../src/lib/money';

export type V1BrowserCommand={key:string;purpose:'BID'|'TOP_UP';amount?:string;batchId?:string;quoteHash?:string;flow:'INLINE'|'HOSTED';paymentMethod:string;phone:string};
export type V1SDKCommand={tx_ref:string;amount:string;currency:string;mobile:string;availablePaymentMethods:string[]};
const sdkFixture=`window.ChapaCheckout=class {
 constructor(options){this.options=options;window.__lowwinChapaSDKOptions=options}
 initialize(id){const button=document.createElement('button');button.id='chapa-pay-button';button.textContent='Fixture pay';button.onclick=()=>fetch(new URL('/__v1-sdk-fixture',parent.location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tx_ref:this.options.tx_ref,amount:this.options.amount,currency:this.options.currency,mobile:this.options.mobile,availablePaymentMethods:this.options.availablePaymentMethods})});document.getElementById(id).append(button)}
};`;

/** Owned loopback customer and synthetic payment transport. No Chapa HTTP is used. */
export async function v1Fixture(page:Page,am=false){
 const f=await fixture(page,am),quotes:BidBatchQuote[]=[],commands:V1BrowserCommand[]=[],sdkCommands:V1SDKCommand[]=[],checks:string[]=[],unexpected:string[]=[],resolutions:string[]=[],ownedIntents=new Map<string,ChapaCheckoutView>();
 const title=am?'የሙከራ 45W 20,000mAh ፓወር ባንክ — '+f.title:f.title;
 if(am)await f.db.product.update({where:{id:f.auction.productId!},data:{titleAm:title}});
 let order:ChapaCheckoutView|null=null,fee=1000,activeChecks=0,maxActiveChecks=0,unavailable=false,interruptInitialization=false;
 await page.route('**/api/wallet',route=>route.fulfill({json:{available:'25.00',held:'0.00',revision:'0',currency:'ETB',bidsEnabled:true,topUp:{enabled:true,reason:null}}}));
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route(/https:\/\/(?:api|checkout)\.chapa\.(?:co|global)\//,route=>{unexpected.push(route.request().url());return route.abort()});
 await page.route('**/vendor/chapa-inline-v1*.js',route=>route.fulfill({contentType:'application/javascript',body:sdkFixture}));
 await page.route('**/__v1-sdk-fixture',route=>{sdkCommands.push(route.request().postDataJSON() as V1SDKCommand);return route.fulfill({json:{fixture:true}})});
 await page.route('**/api/payments/chapa/v1/config',route=>route.fulfill({json:{enabled:true,configured:true,mode:'test',minTopup:'1.00',maxTopup:'43200.00',methods:[{name:'telebirr',slug:'telebirr'},{name:'M-Pesa',slug:'mpesa'},{name:'CBE Birr',slug:'cbebirr'},{name:'eBirr',slug:'ebirr'}],phone:'251911652904',cbeBankEnabled:true,cbeGuideUrl:'/test-assets/cbe-guide.mp4'}}));
 await page.route('**/test-assets/cbe-guide.mp4',route=>route.fulfill({contentType:'video/mp4',body:Buffer.from([])}));
 await page.route('**/api/payments/chapa/batches/quote',route=>{
  const numbers=route.request().postDataJSON().numbers as string[],total=fee*numbers.length;
  const q:BidBatchQuote={id:randomUUID(),quoteHash:'b'.repeat(64),auctionSlug:f.auction.slug!,feeVersion:1,ruleVersion:'lowest-unique-v4',lines:numbers.map((number,position)=>({position,number,grossFee:(fee/100).toFixed(2),discount:'0.00',netFee:(fee/100).toFixed(2)})),entryCount:numbers.length,total:(total/100).toFixed(2),totalCents:String(total),grossTotal:(total/100).toFixed(2),discountTotal:'0.00',status:'QUOTED'};
  quotes.push(q);return route.fulfill({json:q});
 });
 await page.route('**/api/payments/chapa/v1',route=>{
  const command=route.request().postDataJSON() as V1BrowserCommand;commands.push(command);
  const q=quotes.find(q=>q.id===command.batchId),amount=command.purpose==='BID'?q!.total:command.amount!,id=randomUUID(),txRef='LWfixture'+id.replaceAll('-','').slice(0,10);
  order={...pending(command.purpose==='BID'?{key:command.key,purpose:'BID',auctionSlug:q!.auctionSlug,amount:q!.lines[0].number,feeVersion:q!.feeVersion}:{key:command.key,purpose:'TOP_UP',amount},id),amount,amountCents:String(etbToCents(amount)),chargeType:command.flow==='INLINE'?'INLINE':'HOSTED',apiVersion:'v1',merchantReference:txRef,status:'PENDING',providerStatus:null,verificationState:'UNVERIFIED',reason:'AWAITING_PAYMENT',checkoutUrl:command.flow==='HOSTED'?'https://checkout.chapa.co/pay/'+id:null,paymentMethod:command.paymentMethod,payerPhoneMasked:'251*****2904',...(q?{batch:q,batchNumbers:q.lines.map(line=>line.number)}:{})} as ChapaCheckoutView;
  ownedIntents.set(command.key,order);
  if(interruptInitialization){interruptInitialization=false;return route.abort('failed')}
  return route.fulfill({json:{order,...(command.flow==='INLINE'?{inline:{publicKey:'CHAPUBK_TEST-browser-fixture-only',txRef,amount,currency:'ETB',phone:'0'+command.phone.slice(3),paymentMethod:command.paymentMethod}}:{})}});
 });
 await page.route(/\/api\/payments\/chapa\/v1\?key=/,route=>{const key=new URL(route.request().url()).searchParams.get('key')??'';resolutions.push(key);const stored=ownedIntents.get(key),resolved=stored&&order?.id===stored.id?order:stored;return route.fulfill(resolved?{json:resolved}:{status:404,json:{code:'NOT_FOUND',error:'Payment not found.'}})});
 await page.route('**/api/payments/chapa/checkouts/**',async route=>{
  const checking=route.request().method()==='POST';if(checking){activeChecks++;maxActiveChecks=Math.max(maxActiveChecks,activeChecks);checks.push(new URL(route.request().url()).pathname.split('/').at(-1)!)}
  try{await new Promise(resolve=>setTimeout(resolve,30));return await route.fulfill(unavailable?{status:503,json:{code:'UNAVAILABLE',error:'Synthetic status interruption'}}:{json:order})}finally{if(checking)activeChecks--}
 });
 return {...f,title,commands,sdkCommands,quotes,checks,unexpected,resolutions,interruptNextInitialization:()=>{interruptInitialization=true},maxActiveChecks:()=>maxActiveChecks,setFee:(next:number)=>{fee=next},setOrder:(next:Partial<ChapaCheckoutView>)=>{if(!order)throw Error('No owned fixture attempt');order={...order,...next}},setUnavailable:(next:boolean)=>{unavailable=next},order:()=>{if(!order)throw Error('No owned fixture attempt');return order},cleanup:async()=>{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}};
}

export async function openBid(page:Page,title:string){await page.locator('.auction-card').filter({hasText:title}).getByRole('button').click();return page.getByRole('dialog')}
export async function wakePayment(page:Page){await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'))})}
export async function sdkSignal(page:Page,kind:'success'|'failure',value:unknown){const handle=await page.locator('iframe[title="Lowwin payment connection"]').elementHandle(),frame=await handle?.contentFrame();if(!frame)throw Error('The owned Inline SDK frame is missing');await frame.evaluate(({kind,value})=>{const options=Reflect.get(window,'__lowwinChapaSDKOptions');options[kind==='success'?'onSuccessfulPayment':'onPaymentFailure'](value)},{kind,value})}
