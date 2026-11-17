import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomUUID,randomInt} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {verifiedReferralUser} from '../referral-fixtures';
import {bidAuction} from '../bid-fixtures';
import {submitBid} from '../../src/modules/auctions/bids';
import {creditDevelopmentPoints} from '../../src/modules/wallet/ledger';

test('My Bids groups owned accepted records and pages auctions in English/Amharic',async({page},info)=>{
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Explicit disposable loopback _test database required');
 const db=new PrismaClient({datasourceUrl:database}),root=process.env.CLIENT_FLOW_REPORT_DIR??'test-results/client-flow';mkdirSync(root,{recursive:true});
 const errors:string[]=[],financial:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/top-ups)/.test(path))financial.push(path)});
 try{
  const user=await verifiedReferralUser(db,'Independent grouped My Bids QA'),previous=process.env.DEV_POINTS_ENABLED;process.env.DEV_POINTS_ENABLED='true';
  try{await creditDevelopmentPoints(db,user.id,'1000','my-bids-browser-'+randomUUID())}finally{if(previous===undefined)delete process.env.DEV_POINTS_ENABLED;else process.env.DEV_POINTS_ENABLED=previous}
  for(let i=0;i<11;i++){
   const auction=await bidAuction(db,{ruleVersion:'lowest-unique-v5',fee:1,isDemo:false,endDelayMs:3600000});await db.product.update({where:{id:auction.productId!},data:{isDemo:false,title:`Grouped My Bids ${i} ${randomUUID().slice(0,6)}`,titleAm:`የጨረታ ሙከራ ${i}`,images:{create:{path:'/catalog/watch.svg',alt:'Isolated grouped bid fixture',sourceType:'ORIGINAL'}}}});
   for(let n=0;n<(i===10?25:1);n++)await submitBid(db,{userId:user.id,auctionSlug:auction.slug!,amount:(1+n/10).toFixed(2),feeVersion:1,key:randomUUID()});
  }
  const snapshot=async()=>({bids:await db.bid.findMany({where:{userId:user.id},orderBy:{id:'asc'},select:{id:true,amount:true,feePoints:true,operationId:true}}),operations:await db.operation.findMany({where:{userId:user.id,scope:'BID'},orderBy:{id:'asc'},select:{id:true,result:true,journal:{select:{id:true,postings:{orderBy:{id:'asc'},select:{id:true,delta:true}}}}}})}),before=await snapshot();expect(before.bids).toHaveLength(35);expect(before.operations).toHaveLength(35);
  await page.setExtraHTTPHeaders({'x-forwarded-for':`198.18.${Math.floor(user.telegramId%65536/256)}.${user.telegramId%256}`});await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({launch})=>{localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id:user.telegramId,first_name:'My Bids QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();
  for(const language of ['en','am'] as const){
   const am=language==='am';if(am){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
   const response=await page.request.get(`/api/my-bids?view=live&grouped=1&page=1&language=${language}`);expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('private, no-store');const expected=await response.json();expect(expected.pageSize).toBe(10);expect(expected.hasNext).toBe(true);
   const cards=page.locator('[data-bid-auction]');await expect(cards).toHaveCount(10);await expect(page.locator('[data-my-bids-tabs] [role=tab]')).toHaveCount(2);await expect(page.getByRole('tab',{name:am?'ቀጥታ':'Live',exact:true})).toHaveAttribute('aria-selected','true');
   expect(await cards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-auction')))).toEqual(expected.items.map((group:{auction:{code:string}})=>group.auction.code));await expect(cards.first().locator('[data-bid-id]')).toHaveCount(25);expect(await cards.first().locator('[data-bid-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-bid-id')))).toEqual(expected.items[0].bids.map((bid:{id:string})=>bid.id));
   await page.evaluate(async()=>{await document.fonts.ready;scrollTo({top:0,behavior:'instant'})});await page.screenshot({path:`${root}/my-bids-${info.project.name}-${language}.png`});
   const trigger=cards.first().getByRole('button').first();await trigger.click();const detail=page.getByRole('dialog');await expect(detail.locator('[data-bid-step=entry]')).toBeVisible();await expect(detail).toContainText(am?expected.items[0].auction.titleAm:expected.items[0].auction.title);await page.keyboard.press('Tab');expect(await detail.evaluate(element=>element.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(trigger).toBeFocused();
   const pager=page.getByRole('navigation',{name:am?'የጨረታ ገጾች':'Bid pages',exact:true});await pager.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true}).click();await expect(cards).toHaveCount(1);const second=await (await page.request.get(`/api/my-bids?view=live&grouped=1&page=2&language=${language}`)).json();expect(await cards.first().getAttribute('data-bid-auction')).toBe(second.items[0].auction.code);await expect(pager.getByRole('button',{name:am?'ቀጣይ ገጽ':'Next page',exact:true})).toBeDisabled();await pager.getByRole('button',{name:am?'የቀድሞ ገጽ':'Previous page',exact:true}).click();await expect(cards).toHaveCount(10);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(await snapshot()).toEqual(before);expect(financial).toEqual([]);expect(errors).toEqual([]);writeFileSync(`${root}/my-bids-ui-${info.project.name}.json`,JSON.stringify({acceptedTotal:35,auctionTotal:11,pageSize:10,languages:['en','am'],financialPosts:0,receiptsUnchanged:true},null,2)+'\n');
 }finally{await db.$disconnect()}
});

test('My Bids new authenticated account has honest live and finished empty states',async({page})=>{
 const database=process.env.TEST_DATABASE_URL!,url=new URL(database);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');const db=new PrismaClient({datasourceUrl:database});
 try{
  const id=randomInt(8000000000,8900000000);await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));await page.setExtraHTTPHeaders({'x-forwarded-for':`198.18.${Math.floor(id%65536/256)}.${id%256}`});await page.addInitScript(({launch})=>{localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Empty My Bids QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));await expect(page.locator('[data-my-bids-ready=true]')).toBeVisible();await expect(page.locator('[data-bid-auction]')).toHaveCount(0);await expect(page.getByRole('heading',{name:'No live bids yet',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Bid pages',exact:true})).toHaveCount(0);await page.getByRole('tab',{name:'Finished',exact:true}).click();await expect(page.getByRole('heading',{name:'No finished bids yet',exact:true})).toBeVisible();const response=await page.request.get('/api/my-bids?view=finished&grouped=1');expect(response.status()).toBe(200);expect((await response.json()).items).toEqual([]);
 }finally{await db.$disconnect()}
});
