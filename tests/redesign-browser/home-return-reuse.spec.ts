import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {mkdirSync,writeFileSync} from 'node:fs';
import {contactBotId,decryptPhone} from '../../src/modules/auth/own-contact';
import {signedLaunch} from '../helpers';
import {centsToEtb,etbToCents} from '../../src/lib/money';

test('returning Home retains exact filters, loaded batch and scroll position',async({page},info)=>{
 const url=new URL(process.env.TEST_DATABASE_URL??'');if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');const db=new PrismaClient({datasourceUrl:url.href});
 try{
  const candidates=await db.user.findMany({where:{telegramId:{not:null},ownContact:{is:{botId:contactBotId(),revokedAt:null}},staffMember:{is:null}},include:{ownContact:true},take:100});const user=candidates.find(row=>{try{return !!decryptPhone(row.ownContact!.phoneCipher,contactBotId())}catch{return false}});if(!user)throw Error('Existing verified local fixture required');
  const auction=await db.auction.findFirst({where:{isDemo:false,status:{in:['LIVE','SCHEDULED']},endsAt:{gt:new Date()},product:{is:{title:{startsWith:'QA client flow '},visible:true}}},include:{product:true}});if(!auction?.product)throw Error('Existing twelve-item client-flow catalog fixture required');const marker=auction.product.title.replace(/ \d\d$/,'');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id:Number(user.telegramId),first_name:'Home return QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));const cards=page.locator('#discover-auctions .auction-card'),nav=page.getByRole('navigation',{name:'Your navigation'});await expect(cards).toHaveCount(10);await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(cards).toHaveCount(12);await cards.nth(8).scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const expected=await page.evaluate(()=>scrollY),href=new URL(page.url()).pathname+new URL(page.url()).search;expect(expected).toBeGreaterThan(1000);
  let walletGets=0,lastWalletReceiptAt=-Infinity,walletDuplicates=0,balanceSnapshot:string|null=null;const walletPending=new Set<import('@playwright/test').Request>();
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/wallet'&&request.method()==='GET'){walletGets++;walletPending.add(request);if(walletPending.size>1)walletDuplicates++}});
  page.on('requestfinished',request=>walletPending.delete(request));page.on('requestfailed',request=>walletPending.delete(request));
  page.on('response',response=>{if(new URL(response.url()).pathname==='/api/wallet'&&response.request().method()==='GET'&&response.status()===200)lastWalletReceiptAt=performance.now()});
  const returns=[];for(let round=0;round<2;round++){
   for(const destination of ['Winners','My Bids','Profile']){await nav.getByRole('link',{name:destination,exact:true}).click();await expect(page.getByRole('heading',{name:destination,exact:true}).first()).toBeVisible();await expect(page.getByRole('banner',{name:'Mini App header',exact:true})).toHaveCount(0)}
   if(round===0){
    // Establish a real, committed cache receipt on Profile. This makes the
    // immediate Home return an explicit fresh-cache check rather than assuming
    // every route change must issue another financial read.
    await expect.poll(()=>walletPending.size,{timeout:10000}).toBe(0);const fresh=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/wallet'&&response.request().method()==='GET'&&response.status()===200,{timeout:10000});await page.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));const response=await fresh;balanceSnapshot=centsToEtb(etbToCents((await response.json()).available));await response.finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   }
   const walletBefore=walletGets,receiptBefore=lastWalletReceiptAt;await nav.getByRole('link',{name:'Home',exact:true}).click();await expect(cards).toHaveCount(12);const header=page.getByRole('banner',{name:'Mini App header',exact:true});await expect(header).toHaveCount(1);expect(await header.locator('[data-header-balance] > span').textContent()).toBe(balanceSnapshot);await expect(header.locator('[data-header-balance] > small')).toHaveText('ETB');await expect(page.locator('.customer-loading')).toHaveCount(0);const mountedHeader=await header.elementHandle();await page.waitForTimeout(450);expect(await mountedHeader!.evaluate(node=>node.isConnected)).toBe(true);
   const walletReads=walletGets-walletBefore,knownFresh=performance.now()-receiptBefore<15000;expect(walletReads).toBeLessThanOrEqual(1);if(knownFresh)expect(walletReads).toBe(0);expect(walletDuplicates).toBe(0);expect(new URL(page.url()).pathname+new URL(page.url()).search).toBe(href);await expect.poll(async()=>Math.abs((await page.evaluate(()=>scrollY))-expected),{timeout:5000}).toBeLessThan(80);returns.push({round:round+1,expected,actual:await page.evaluate(()=>scrollY),cards:await cards.count(),hrefPreserved:true,knownFreshWalletCache:knownFresh,walletReads,balanceReused:true});
  }
  const root=process.env.CLIENT_FLOW_REPORT_DIR??'test-results/client-flow';mkdirSync(root,{recursive:true});writeFileSync(`${root}/home-return-${info.project.name}.json`,JSON.stringify({mode:process.env.REDESIGN_PRODUCTION==='1'?'optimized HTTPS loopback':'isolated development preflight',width:info.project.name,returns,concurrentWalletDuplicates:walletDuplicates},null,2)+'\n');
 }finally{await db.$disconnect()}
});
