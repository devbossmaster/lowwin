import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {contactBotId,decryptPhone} from '../../src/modules/auth/own-contact';
import {formatAuctionBid} from '../../src/lib/money';
import type {PersonalBidList} from '../../src/modules/profile/bid-list';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

const acceptedRows=(db:PrismaClient,userId:string)=>db.bid.findMany({where:{userId},orderBy:[{acceptedAt:'desc'},{id:'desc'}],select:{id:true,amount:true,feePoints:true,auction:{select:{startsAt:true,endsAt:true,status:true,settlement:{select:{id:true}}}}}});
type AcceptedRow=Awaited<ReturnType<typeof acceptedRows>>[number];
const isLive=(row:AcceptedRow,now:Date)=>['LIVE','SCHEDULED'].includes(row.auction.status)&&!!row.auction.startsAt&&row.auction.startsAt<=now&&!!row.auction.endsAt&&row.auction.endsAt>now&&!row.auction.settlement;

test('My Bids accepted Live/Finished records, paging and cached auction sheets in English/Amharic',async({page,browser},info)=>{
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Explicit disposable loopback _test database required');
 const db=new PrismaClient({datasourceUrl:database}),root=process.env.CLIENT_FLOW_REPORT_DIR??'test-results/client-flow';mkdirSync(root,{recursive:true});
 const errors:string[]=[],requests:string[]=[],financial:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url()),path=url.pathname;if(path.startsWith('/api/'))requests.push(`${request.method()} ${path}${url.search}`);if(request.method()==='POST'&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/top-ups)/.test(path))financial.push(path)});
 try{
  const restricted=await db.userRestriction.findMany({where:{suspended:true},select:{userId:true}});
  const candidates=await db.user.findMany({where:{id:{notIn:restricted.map(row=>row.userId)},telegramId:{not:null},ownContact:{is:{botId:contactBotId(),revokedAt:null}},staffMember:{is:null},bids:{some:{},every:{auction:{isDemo:false,testRunId:null}}}},include:{ownContact:true,_count:{select:{bids:true}}},orderBy:{bids:{_count:'desc'}},take:30});
  const [{now}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  let user:typeof candidates[number]|undefined,rows:AcceptedRow[]=[];
  for(const candidate of candidates){try{decryptPhone(candidate.ownContact!.phoneCipher,contactBotId())}catch{continue}const accepted=await acceptedRows(db,candidate.id);if(accepted.filter(row=>isLive(row,now)).length>20||accepted.filter(row=>!isLive(row,now)).length>20){user=candidate;rows=accepted;break}}
  if(!user)throw Error('An existing verified fixture with >20 accepted bids in one Live/Finished page group is required; this browser never submits a bid.');
  const owned=user,groups={live:rows.filter(row=>isLive(row,now)),finished:rows.filter(row=>!isLive(row,now))},pagedView=groups.finished.length>20?'finished':'live';
  const financialSnapshot=async()=>JSON.stringify({bids:(await acceptedRows(db,owned.id)).map(row=>({id:row.id,amount:row.amount.toString(),fee:row.feePoints.toString()})),accounts:await db.ledgerAccount.findMany({where:{wallet:{userId:owned.id}},orderBy:{id:'asc'},select:{id:true,balance:true}}),checkouts:await db.chapaCheckout.count({where:{userId:owned.id}})});
  const beforeFinancial=await financialSnapshot();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});
  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id:Number(owned.telegramId),first_name:'My Bids QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();
  const wallet=await page.request.get('/api/wallet');expect(wallet.status()).toBe(200);expect((await wallet.json()).currency).toBe('ETB');
  expect((await page.request.get('/api/my-bids?view=live&userId='+owned.id)).status()).toBe(422);
  const anonymous=await browser.newContext({baseURL:process.env.BETTER_AUTH_URL,ignoreHTTPSErrors:true});try{expect((await anonymous.request.get('/api/my-bids?view=finished')).status()).toBe(401)}finally{await anonymous.close()}
  const report:Record<string,unknown>={width:info.project.name,acceptedTotal:rows.length,live:groups.live.length,finished:groups.finished.length,pageSize:20,languages:[]};
  const cards=page.locator('[data-bid-id]');
  const readPage=async(view:'live'|'finished',pageNumber:number,language:'en'|'am')=>{
   const response=await page.request.get(`/api/my-bids?view=${view}&page=${pageNumber}&language=${language}`);expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('private');expect(response.headers()['cache-control']).toContain('no-store');expect(response.headers().vary).toContain('Cookie');
   const result=await response.json() as PersonalBidList,expected=groups[view].slice((pageNumber-1)*20,pageNumber*20);expect(result.pageSize).toBe(20);expect(result.page).toBe(pageNumber);expect(result.hasNext).toBe(groups[view].length>pageNumber*20);expect(result.items.map(item=>item.id)).toEqual(expected.map(row=>row.id));
   for(const item of result.items){const original=expected.find(row=>row.id===item.id)!;expect(original.amount.eq(item.amount)).toBe(true);expect(item.outcome==='LIVE').toBe(view==='live');for(const key of ['userId','wallet','phone','phoneCipher','payment','feePoints','discount','receipt'])expect(item).not.toHaveProperty(key)}return result;
  };
  for(const language of ['en','am'] as const){
   const am=language==='am';if(am){await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click();await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'ጨረታዎቼ',exact:true}).click()}
   const tab=page.getByRole('tab',{name:am?'ቀጥታ':'Live',exact:true}),finished=page.getByRole('tab',{name:am?'ያለቁ':'Finished',exact:true});await expect(tab).toBeVisible();await expect(finished).toBeVisible();
   for(const view of ['live','finished'] as const){
    const selected=view==='live'?tab:finished,expected=groups[view];await selected.click();await expect(selected).toHaveAttribute('aria-selected','true');await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();
    const firstPage=await readPage(view,1,language);await expect(cards).toHaveCount(Math.min(20,expected.length));expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-id')))).toEqual(expected.slice(0,20).map(row=>row.id));
    if(!expected.length){await expect(page.getByRole('heading',{name:view==='live'?(am?'የቀጥታ ጨረታዎች ገና የሉም':'No live bids yet'):(am?'ያለቁ ጨረታዎች ገና የሉም':'No finished bids yet'),exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:am?'የጨረታ ገጾች':'Bid pages',exact:true})).toHaveCount(0);continue}
    const item=firstPage.items[0],first=cards.first();await expect(first.locator('[data-bid-thumbnail]')).toContainText(formatAuctionBid(item.amount,item.auction.ruleVersion??undefined).replace(/^ETB\s*/,''));await expect(first.locator('[data-outcome]')).toHaveAttribute('data-outcome',item.outcome);if(view==='live')await expect(first.getByRole('timer')).toBeVisible();
    expect((await first.boundingBox())!.height).toBeLessThan(155);for(const row of await cards.all())expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(async()=>{await document.fonts.ready;scrollTo({top:0,behavior:'instant'})});await page.screenshot({path:`${root}/my-bids-${view}-${info.project.name}-${language}.png`});
    await page.emulateMedia({reducedMotion:'reduce'});const before=requests.length,began=performance.now();await first.click();const detail=page.getByRole('dialog',{name:view==='live'?(am?'ጨረታዎን ያቅርቡ':'Place your bid'):(am?'የጨረታ ውጤት':'Auction result'),exact:true});await expect(detail).toBeVisible();const visibleMs=Math.round(performance.now()-began),title=am?item.auction.titleAm||item.auction.title:item.auction.title;await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(detail.getByText(am?'በመጫን ላይ…':'Loading…',{exact:true})).toHaveCount(0);
    if(view==='live'){await expect(detail.locator('[data-bid-entry]')).toBeVisible();await expect(detail.locator('[data-bid-continue]')).toBeDisabled()}else await expect(detail.locator('[data-result-breakdown], [role=status]').first()).toBeVisible();await expect(detail).toHaveCSS('animation-name','none');
    const privateReads=requests.slice(before).filter(request=>request.startsWith('GET /api/my-bids'));expect(privateReads).toEqual([]);await page.screenshot({path:`${root}/my-bid-detail-${view}-${info.project.name}-${language}.png`});
    // Finish loading actual result controls before testing Tab navigation; a
    // native dialog containing only Close can cycle through browser chrome.
    if(view==='finished'&&['WON','LOST','NO_WINNER'].includes(item.outcome))await expect(detail.locator('[data-result-amount]').first()).toBeVisible();
    const close=detail.getByRole('button',{name:am?'ዝጋ':'Close',exact:true});await close.focus();await expect(close).toBeFocused();expect(await detail.evaluate(element=>element.matches(':modal'))).toBe(true);await first.evaluate(element=>element.focus());await expect(close).toBeFocused();
    if(await detail.locator('button:not([disabled]),input:not([disabled]),a[href],select:not([disabled]),textarea:not([disabled]),[tabindex="0"]').count()>1){await page.keyboard.press('Tab');await expect.poll(()=>detail.evaluate(element=>element.contains(document.activeElement))).toBe(true)}
    await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(first).toBeFocused();
    const repeat=requests.length;await first.click();await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();expect(requests.slice(repeat).filter(request=>request.startsWith('GET /api/my-bids')||request.startsWith('GET /api/catalog/auctions/'))).toEqual([]);await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await page.emulateMedia({reducedMotion:'no-preference'});
    const pager=page.getByRole('navigation',{name:am?'የጨረታ ገጾች':'Bid pages',exact:true});
    if(expected.length>20){await pager.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true}).click();const secondPage=await readPage(view,2,language);await expect(cards).toHaveCount(Math.min(20,expected.length-20));expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-id')))).toEqual(secondPage.items.map(row=>row.id));if(expected.length<=40)await expect(pager.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true})).toBeDisabled();const cached=requests.length;await pager.getByRole('button',{name:am?'የቀድሞ ገጽ':'Previous page',exact:true}).click();await expect(cards).toHaveCount(20);expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-id')))).toEqual(expected.slice(0,20).map(row=>row.id));expect(requests.slice(cached).filter(request=>request.startsWith('GET /api/my-bids'))).toEqual([])}else await expect(pager).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);(report.languages as unknown[]).push({language,view,auctionVisibleMs:visibleMs,detailPrivateApiReads:privateReads.length,acceptedOnly:true,newestFirst:true,paginationAccurate:true,cachedPageReturn:true});
   }
  }
  await page.getByRole('tab',{name:pagedView==='live'?'ቀጥታ':'ያለቁ',exact:true}).click();
  let fail=true;await page.route('**/api/my-bids?*',async route=>{if(fail){fail=false;await route.fulfill({status:503,json:{error:'Isolated retry fixture'}})}else await route.continue()});await page.reload();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'እንደገና ይሞክሩ',exact:true}).click();await expect(cards).toHaveCount(20);await page.unroute('**/api/my-bids?*');report.retryRecovered=true;
  expect(await financialSnapshot()).toBe(beforeFinancial);expect(financial).toEqual([]);expect(errors).toEqual([]);report.financialPosts=0;report.errors=errors;writeFileSync(`${root}/my-bids-ui-${info.project.name}.json`,JSON.stringify(report,null,2)+'\n');
 }finally{await db.$disconnect()}
});

test('My Bids new authenticated account has honest empty Live and Finished states',async({page})=>{
 const database=process.env.TEST_DATABASE_URL!,url=new URL(database);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');const db=new PrismaClient({datasourceUrl:database});
 try{
  const id=randomInt(8000000000,8900000000);await verifyFixtureContact(db,id);const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Empty My Bids QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids?view=history'));await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();await expect(page.getByRole('tab',{name:'Finished',exact:true})).toHaveAttribute('aria-selected','true');
  for(const [view,label,empty] of [['live','Live','No live bids yet'],['finished','Finished','No finished bids yet']] as const){const tab=page.getByRole('tab',{name:label,exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe(view);await expect(page.getByRole('heading',{name:empty,exact:true})).toBeVisible();await expect(page.locator('[data-bid-id]')).toHaveCount(0);await expect(page.getByRole('navigation',{name:'Bid pages',exact:true})).toHaveCount(0);const response=await page.request.get('/api/my-bids?view='+view);expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');expect(await response.json()).toMatchObject({items:[],page:1,pageSize:20,hasNext:false})}
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(id)}});expect(await db.bid.count({where:{userId:user.id}})).toBe(0);expect(await db.chapaCheckout.count({where:{userId:user.id}})).toBe(0);
 }finally{await db.$disconnect()}
});
