import {test,expect,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import type {ChapaCheckoutView,ChapaIntent} from '../../src/lib/chapa-client';

async function fixture(page:Page,am:boolean){
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const telegramId=randomInt(8000000000,8900000000),auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),title='Recovery fixture '+randomUUID().slice(0,7);
 await db.product.update({where:{id:auction.productId!},data:{title,titleAm:title,images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic checkout regression fixture',sourceType:'ORIGINAL'}}}});
 await verifyFixtureContact(db,telegramId);
 await page.context().addCookies([{name:'lowwin-language',value:am?'am':'en',domain:'localhost',path:'/'}]);
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.addInitScript(launch=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},openLink(url){const links=Reflect.get(window,'chapaOpened')??[];links.push(url);Reflect.set(window,'chapaOpened',links)}}}},signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Recovery fixture'})},process.env.TELEGRAM_BOT_TOKEN));
 await page.route('**/api/wallet',route=>route.fulfill({json:{available:'25.00',held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
 await page.route('**/api/payments/chapa',route=>route.fulfill({json:{enabled:true,configured:true,mode:'test',walletBidsEnabled:true,minTopup:'1.00',maxTopup:'43200.00',reason:null}}));
 const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
 return {db,auction,title,user,home:'/?q='+encodeURIComponent(title)};
}

function pending(intent:ChapaIntent,id=randomUUID()):ChapaCheckoutView{
 return {id,purpose:intent.purpose,mode:'test',amount:intent.purpose==='TOP_UP'?intent.amount:'10.00',amountCents:intent.purpose==='TOP_UP'?'10000':'1000',currency:'ETB',status:'PENDING',reason:'AWAITING_PAYMENT',checkoutUrl:'https://checkout.chapa.global/CH-recovery-'+id,auctionSlug:intent.purpose==='BID'?intent.auctionSlug:null,bidNumber:intent.purpose==='BID'?intent.amount:null,feeVersion:intent.purpose==='BID'?intent.feeVersion:null,grossFee:intent.purpose==='BID'?'10.00':null,discountPoints:'0',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),pollAfterMs:15000,fundsPreserved:false,receipt:null};
}

test('interrupted bid and top-up requests reopen with their original key and one checkout',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),requests:ChapaIntent[]=[],orders=new Map<string,ChapaCheckoutView>(),fail=new Set(['BID','TOP_UP']);
 try{
  await page.route('**/api/payments/chapa/checkouts**',async route=>{
   if(route.request().method()==='POST'&&new URL(route.request().url()).pathname.endsWith('/checkouts')){
    const body=route.request().postDataJSON() as ChapaIntent;requests.push(body);
    if(!orders.has(body.key))orders.set(body.key,pending(body));
    if(fail.delete(body.purpose))return body.purpose==='BID'?route.fulfill({status:503,json:{code:'PAYMENT_UNAVAILABLE',error:'Connection interrupted. Resume this same payment.'}}):route.abort('timedout');
    const order=orders.get(body.key)!;
    if(body.purpose==='BID'&&requests.filter(item=>item.key===body.key).length===2){order.checkoutUrl=null;order.reason='INITIALIZATION_PENDING';return route.fulfill({status:202,json:order})}
    order.checkoutUrl='https://checkout.chapa.global/CH-recovery-'+order.id;order.reason='AWAITING_PAYMENT';
    return route.fulfill({json:orders.get(body.key)});
   }
   const id=new URL(route.request().url()).pathname.split('/').at(-1),order=[...orders.values()].find(item=>item.id===id);
   return route.fulfill({status:order?200:404,json:order??{error:'Payment not found.'}});
  });
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  const openBid=()=>page.locator('#discover-auctions .auction-card').first().getByRole('button').click();
  await openBid();const input=page.getByRole('textbox',{name:am?'የጨረታ ቁጥርዎ':'Your bid number',exact:true});await input.fill('3.60');
  let bid=page.getByRole('dialog',{name:am?'ጨረታዎን ያቅርቡ':'Place your bid',exact:true});await bid.getByRole('radio',{name:'Chapa',exact:true}).check();await bid.locator('[data-payment-action]').click();
  await expect(page.getByRole('alert').filter({hasText:am?'ክፍያው':'Connection interrupted'})).toBeVisible();
  await page.keyboard.press('Escape');await openBid();
  bid=page.getByRole('dialog',{name:am?'የጨረታ ክፍያ':'Bid payment',exact:true});const resume=bid.locator('[data-payment-recovery]');await expect(resume).toBeEnabled();
  // Restoring an ID-less intent is read-only until the customer chooses Resume.
  expect(requests).toHaveLength(1);await expect(bid).not.toContainText(am?'ጨረታው ተቀብሏል':'Bid accepted');
  mkdirSync('test-results/chapa-ui/recovery',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/recovery/interrupted-${info.project.name}.png`,animations:'disabled'});
  await resume.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});await expect(resume).toBeEnabled();expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  // A normal202 can carry an ID but still have no URL. Reopening must retain
  // a direct initialization retry instead of relying on background workers.
  await page.keyboard.press('Escape');await openBid();await expect(resume).toBeEnabled();await resume.click();await expect(bid.getByRole('link',{name:am?'ወደ Chapa ይቀጥሉ':'Continue to Chapa',exact:true})).toBeVisible();
  expect(requests).toHaveLength(3);expect(requests[2]).toEqual(requests[0]);expect(orders.size).toBe(1);await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(1);
  await page.keyboard.press('Escape');await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();
  let topup=page.getByRole('dialog',{name:am?'ወደ ዋሌት ገንዘብ ያስገቡ':'Top up wallet',exact:true});await topup.locator('[data-payment-action]').click();await expect(topup.getByRole('alert')).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true}).click();topup=page.getByRole('dialog',{name:am?'ወደ ዋሌት ገንዘብ ያስገቡ':'Top up wallet',exact:true});
  await expect(topup.getByRole('textbox',{name:am?'መጠን':'Amount',exact:true})).toBeDisabled();await expect(topup.locator('[data-payment-action]')).toBeEnabled();await topup.locator('[data-payment-action]').click();
  await expect(topup.getByRole('link',{name:am?'ወደ Chapa ይቀጥሉ':'Continue to Chapa',exact:true})).toBeVisible();expect(requests).toHaveLength(5);expect(requests[4]).toEqual(requests[3]);expect(orders.size).toBe(2);
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'chapaOpened')?.length??0)).toBe(2);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.db.$disconnect()}
});

test('owned return page refreshes cached My Bids only after authoritative bid confirmation',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),order=pending({purpose:'BID',key:randomUUID(),auctionSlug:f.auction.slug!,amount:'3.60',feeVersion:1});let confirmed=false,bidReads=0,creates=0;
 try{
  await page.route('**/api/my-bids?**',route=>{bidReads++;return route.fulfill({json:{items:[],page:1,totalPages:1,total:confirmed?1:0,counts:{total:confirmed?1:0,live:confirmed?1:0,active:confirmed?1:0,history:0,won:0}}})});
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request();if(new URL(request.url()).pathname.endsWith('/checkouts')){creates++;return route.fulfill({status:400,json:{error:'No new payment allowed'}})}
   if(confirmed&&request.method()==='POST')Object.assign(order,{status:'BID_ACCEPTED',reason:null,receipt:{bid:{id:randomUUID(),amount:'3.60',auctionCode:f.auction.code,auctionSlug:f.auction.slug,acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:'10',newlyUnavailable:'10'},wallet:{available:'25.00',held:'0'},remainingSubmissions:99,ownBids:[]}});
   return route.fulfill({json:order});
  });
  const path='/payments/chapa/return?checkout='+order.id;
  await page.goto('/telegram?next='+encodeURIComponent(path));await expect(page).toHaveURL(new URL(path,process.env.BETTER_AUTH_URL!).href);await expect(page.getByRole('link',{name:am?'ወደ Chapa ይቀጥሉ':'Continue to Chapa',exact:true})).toBeVisible();
  await page.locator('main a[href="/"]').first().click();await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:am?'ጨረታዎቼ':'My Bids',exact:true}).click();await expect(page.locator('[data-my-bids-ready]')).toBeVisible();
  // Keep this cached page fresh while exercising routing; timers still run.
  await page.clock.setFixedTime(new Date());
  const before=bidReads;await page.goBack();await page.goBack();await expect(page).toHaveURL(new URL(path,process.env.BETTER_AUTH_URL!).href);await expect(page.getByRole('link',{name:am?'ወደ Chapa ይቀጥሉ':'Continue to Chapa',exact:true})).toBeVisible();expect(bidReads).toBe(before);
  confirmed=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('heading',{name:am?'ጨረታው ተቀብሏል':'Bid accepted',exact:true})).toBeVisible();
  await page.getByRole('link',{name:am?'የእኔ ጨረታዎች':'View My Bids',exact:true}).click();await expect.poll(()=>bidReads).toBeGreaterThan(before);await expect(page.locator('[data-my-bids-summary]').locator('strong').first()).toHaveText('1');expect(creates).toBe(0);
  expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.db.$disconnect()}
});
