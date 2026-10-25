import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {contactBotId,decryptPhone} from '../../src/modules/auth/own-contact';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

test('My Bids compact accepted records, paging and local receipts in English/Amharic',async({page},info)=>{
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Explicit disposable loopback _test database required');
 const db=new PrismaClient({datasourceUrl:database}),root=process.env.CLIENT_FLOW_REPORT_DIR??'test-results/client-flow';mkdirSync(root,{recursive:true});
 const errors:string[]=[],requests:string[]=[],financial:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/'))requests.push(`${request.method()} ${path}`);if(request.method()==='POST'&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/top-ups)/.test(path))financial.push(path)});
 try{
  const restricted=await db.userRestriction.findMany({where:{suspended:true},select:{userId:true}});
  const candidates=await db.user.findMany({where:{id:{notIn:restricted.map(r=>r.userId)},telegramId:{not:null},ownContact:{is:{botId:contactBotId(),revokedAt:null}},staffMember:{is:null},bids:{some:{},every:{auction:{isDemo:false,testRunId:null}}}},include:{ownContact:true,_count:{select:{bids:true}}},orderBy:{bids:{_count:'desc'}},take:30});
  const user=candidates.find(row=>{try{return row._count.bids>20&&!!decryptPhone(row.ownContact!.phoneCipher,contactBotId())}catch{return false}});if(!user)throw Error('An existing verified accepted-record fixture with >20 bids is required; no bid is submitted by this browser check.');
  const rows=await db.bid.findMany({where:{userId:user.id},orderBy:[{acceptedAt:'desc'},{id:'desc'}],select:{id:true,feePoints:true,amount:true,auction:{select:{terms:{select:{ruleVersion:true}},settlement:{select:{outcome:true,winningBidId:true}},status:true,endsAt:true}}}});
  const now=new Date(),active=rows.filter(r=>['LIVE','SCHEDULED'].includes(r.auction.status)&&!!r.auction.endsAt&&r.auction.endsAt>now&&!r.auction.settlement).length,won=rows.filter(r=>r.auction.settlement?.outcome==='WINNER'&&r.auction.settlement.winningBidId===r.id).length;
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});
  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id:Number(user.telegramId),first_name:'My Bids QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();
  const report:Record<string,unknown>={width:info.project.name,acceptedTotal:rows.length,active,won,pageSize:20,languages:[]};
  for(const language of ['en','am'] as const){
   const am=language==='am';if(am){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
   const summary=page.locator('[data-my-bids-summary]');await expect(summary.locator('strong')).toHaveText([String(rows.length),String(active),String(won)]);await expect(summary).not.toContainText(/Coupon|ኩፖን/);
   const cards=page.locator('[data-bid-id]');await expect(cards).toHaveCount(20);expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-id')))).toEqual(rows.slice(0,20).map(row=>row.id));
   await expect(cards.first().locator('time')).toBeVisible();expect((await cards.first().boundingBox())!.height).toBeLessThan(155);for(const row of await cards.all())expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
   await page.evaluate(async()=>{await document.fonts.ready;scrollTo({top:0,behavior:'instant'})});await page.screenshot({path:`${root}/my-bids-${info.project.name}-${language}.png`});
   await page.emulateMedia({reducedMotion:'reduce'});const first=cards.first(),before=requests.length,began=performance.now();await first.click();const detail=page.getByRole('dialog',{name:am?'የጨረታ ዝርዝር':'Bid details',exact:true});await expect(detail.locator(`[data-bid-receipt="${rows[0].id}"]`)).toBeVisible();const visibleMs=Math.round(performance.now()-began);await expect(detail).toContainText(rows[0].id);await expect(detail.locator('.customer-loading,.loading-spinner-ring')).toHaveCount(0);await expect(detail.getByText(am?'የጨረታ ግቤት መለያ':'Bid ID',{exact:true})).toBeVisible();await expect(detail).toHaveCSS('animation-name','none');
   const detailReads=requests.slice(before).filter(path=>path.includes('/api/my-bids'));expect(detailReads).toEqual([]);await detail.evaluate(async element=>{await Promise.all(element.getAnimations().map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`${root}/my-bid-detail-${info.project.name}-${language}.png`});
   await page.keyboard.press('Tab');expect(await detail.evaluate(element=>element.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(first).toBeFocused();await page.emulateMedia({reducedMotion:'no-preference'});
   const pager=page.getByRole('navigation',{name:am?'የጨረታ ገጾች':'Bid pages',exact:true});await pager.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true}).click();await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();await expect(cards).toHaveCount(Math.min(20,rows.length-20));expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-id')))).toEqual(rows.slice(20,40).map(row=>row.id));await expect(summary.locator('strong')).toHaveText([String(rows.length),String(active),String(won)]);
   if(rows.length<=40)await expect(pager.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true})).toBeDisabled();await pager.getByRole('button',{name:am?'የቀድሞ ገጽ':'Previous page',exact:true}).click();await expect(cards).toHaveCount(20);await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);(report.languages as unknown[]).push({language,receiptVisibleMs:visibleMs,detailApiReads:detailReads.length,summaryAccurate:true,newestFirst:true,paginationAccurate:true});
  }
  let fail=true;await page.route('**/api/my-bids?*',async route=>{if(fail){fail=false;await route.fulfill({status:503,json:{error:'Isolated retry fixture'}})}else await route.continue()});await page.reload();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'እንደገና ይሞክሩ',exact:true}).click();await expect(page.locator('[data-bid-id]')).toHaveCount(20);await page.unroute('**/api/my-bids?*');report.retryRecovered=true;
  expect(financial).toEqual([]);expect(errors).toEqual([]);report.financialPosts=0;report.errors=errors;writeFileSync(`${root}/my-bids-ui-${info.project.name}.json`,JSON.stringify(report,null,2)+'\n');
 }finally{await db.$disconnect()}
});

test('My Bids new authenticated account has honest zero and empty state',async({page})=>{
 const database=process.env.TEST_DATABASE_URL!,url=new URL(database);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');const db=new PrismaClient({datasourceUrl:database});
 try{
  const id=randomInt(8000000000,8900000000);await verifyFixtureContact(db,id);const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Empty My Bids QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();await expect(page.locator('[data-my-bids-summary] strong')).toHaveText(['0','0','0']);await expect(page.locator('[data-bid-id]')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Your first bid starts here',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Bid pages',exact:true})).toHaveCount(0);
 }finally{await db.$disconnect()}
});
