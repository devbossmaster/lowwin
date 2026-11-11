import {type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';
import type {BidBatchQuote} from '../../src/lib/bid-batch-client';
import type {TransactionRow} from '../../src/lib/transactions';

export async function fixture(page:Page,am:boolean,startParam?:string){
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const telegramId=randomInt(8000000000,8900000000),auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),title='Recovery fixture '+randomUUID().slice(0,7);
 // Each scenario represents a separate customer. Keep its address stable while
 // isolating it from other scenarios sharing the loopback test server; the
 // application's persistent authentication rate limiter remains enabled.
 await page.setExtraHTTPHeaders({'x-forwarded-for':`198.18.${Math.floor(telegramId%65536/256)}.${telegramId%256}`});
 await db.product.update({where:{id:auction.productId!},data:{title,titleAm:title,images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic checkout regression fixture',sourceType:'ORIGINAL'}}}});
 await verifyFixtureContact(db,telegramId);
 await page.context().addCookies([{name:'lowwin-language',value:am?'am':'en',domain:'localhost',path:'/'}]);
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.addInitScript(launch=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},openLink(url){const links=Reflect.get(window,'chapaOpened')??[];links.push(url);Reflect.set(window,'chapaOpened',links)}}}},signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Recovery fixture'}),...(startParam?{start_param:startParam}:{})},process.env.TELEGRAM_BOT_TOKEN));
 await page.route('**/api/wallet',route=>route.fulfill({json:{available:'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
 await page.route('**/api/payments/chapa',route=>route.fulfill({json:{enabled:true,configured:true,mode:'test',walletBidsEnabled:true,minTopup:'1.00',maxTopup:'43200.00',reason:null}}));
 const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
 return {db,auction,title,user,home:'/?q='+encodeURIComponent(title)};
}

export function batchQuote(auctionSlug:string,numbers:string[],feeCents=1000):BidBatchQuote{
 const totalCents=numbers.length*feeCents;
 return {id:randomUUID(),quoteHash:'b'.repeat(64),auctionSlug,feeVersion:1,ruleVersion:'lowest-unique-v4',entryCount:numbers.length,lines:numbers.map((number,position)=>({position,number:Number(number).toFixed(2),grossFee:(feeCents/100).toFixed(2),discount:'0.00',netFee:(feeCents/100).toFixed(2)})),total:(totalCents/100).toFixed(2),totalCents:String(totalCents),grossTotal:(totalCents/100).toFixed(2),discountTotal:'0.00',status:'QUOTED'};
}
export function pending(intent:ChapaIntent,id:string=randomUUID(),batch?:BidBatchQuote):ChapaCheckoutView{
 const isBatch=intent.purpose==='BID'&&'batchId'in intent;
 if(isBatch&&(!batch||batch.id!==intent.batchId||batch.quoteHash!==intent.quoteHash))throw new Error('A hosted bid fixture must resolve the exact immutable batch quote.');
 const single=intent.purpose==='BID'&&!('batchId'in intent)?intent:null;
 const amount=intent.purpose==='TOP_UP'?Number(intent.amount).toFixed(2):isBatch?batch!.total:'10.00';
 return {id,apiVersion:1,chargeType:'HOSTED',purpose:intent.purpose,mode:'test',amount,amountCents:String(Math.round(Number(amount)*100)),currency:'ETB',status:'PENDING',reason:'AWAITING_PAYMENT',checkoutUrl:'https://checkout.chapa.co/CH-recovery-'+id,auctionSlug:single?.auctionSlug??batch?.auctionSlug??null,bidNumber:single?.amount??null,feeVersion:single?.feeVersion??batch?.feeVersion??null,grossFee:intent.purpose==='BID'?batch?.grossTotal??'10.00':null,discountPoints:batch?.discountTotal??'0',...(batch?{batch,batchNumbers:batch.lines.map(line=>line.number)}:{}),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),pollAfterMs:15000,fundsPreserved:false,receipt:null};
}

/** The current activity endpoint returns a summary row, never a checkout DTO. */
export function transaction(order:ChapaCheckoutView,summary:TransactionRow['summary'],direction:TransactionRow['direction']):TransactionRow{
 return {id:order.id,source:'chapa',type:order.purpose,title:order.auctionTitle??order.auctionSlug??'Bid submission fee',titleAm:order.auctionTitleAm??null,amount:order.amount,direction,summary,paymentMethod:order.paymentMethod??'Chapa',createdAt:order.createdAt,mode:order.mode,fundsPreserved:order.fundsPreserved};
}

