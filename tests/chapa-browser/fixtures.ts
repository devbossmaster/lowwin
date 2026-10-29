import {type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {ENGLISH_UI_STATE,signedLaunch} from '../helpers';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';

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
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.addInitScript(launch=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},openLink(url){const links=Reflect.get(window,'chapaOpened')??[];links.push(url);Reflect.set(window,'chapaOpened',links)}}}},signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Recovery fixture'}),...(startParam?{start_param:startParam}:{})},process.env.TELEGRAM_BOT_TOKEN));
 await page.route('**/api/wallet',route=>route.fulfill({json:{available:'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
 await page.route('**/api/payments/chapa',route=>route.fulfill({json:{enabled:true,configured:true,mode:'test',walletBidsEnabled:true,minTopup:'1.00',maxTopup:'43200.00',reason:null}}));
 const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
 return {db,auction,title,user,home:'/?q='+encodeURIComponent(title)};
}

export function pending(intent:ChapaIntent,id:string=randomUUID()):ChapaCheckoutView{
 return {id,purpose:intent.purpose,mode:'test',amount:intent.purpose==='TOP_UP'?intent.amount:'10.00',amountCents:intent.purpose==='TOP_UP'?'10000':'1000',currency:'ETB',status:'PENDING',reason:'AWAITING_PAYMENT',checkoutUrl:'https://checkout.chapa.global/CH-recovery-'+id,auctionSlug:intent.purpose==='BID'?intent.auctionSlug:null,bidNumber:intent.purpose==='BID'?intent.amount:null,feeVersion:intent.purpose==='BID'?intent.feeVersion:null,grossFee:intent.purpose==='BID'?'10.00':null,discountPoints:'0',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),pollAfterMs:15000,fundsPreserved:false,receipt:null};
}

