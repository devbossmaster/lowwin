import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomInt,randomUUID} from 'node:crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

test('returning Home retains exact filters, loaded batch and scroll position',async({page},info)=>{
 const url=new URL(process.env.TEST_DATABASE_URL??'');if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');const db=new PrismaClient({datasourceUrl:url.href});
 try{
  const telegramId=randomInt(8000000000,8900000000),marker='QA return '+randomUUID().slice(0,8);await verifyFixtureContact(db,telegramId);
  for(let index=0;index<12;index++){const auction=await bidAuction(db,{ruleVersion:'lowest-unique-v5',fee:10,isDemo:false,endDelayMs:3600000});await db.product.update({where:{id:auction.productId!},data:{title:marker+' '+String(index).padStart(2,'0'),images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'Synthetic return-navigation fixture',sourceType:'ORIGINAL'}}}})}
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://telegram.org/*']});await page.addInitScript(({launch})=>{localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Home return QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));const cards=page.locator('#discover-auctions .auction-card'),nav=page.getByRole('navigation',{name:'Your navigation'});await expect(cards).toHaveCount(10);await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(cards).toHaveCount(12);await cards.nth(8).scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const expected=await page.evaluate(()=>scrollY),href=new URL(page.url()).pathname+new URL(page.url()).search;expect(expected).toBeGreaterThan(1000);
  let walletGets=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/wallet'&&request.method()==='GET')walletGets++});
  const returns=[];for(let round=0;round<2;round++){
   for(const [destination,heading] of [['Winners','Winners'],['My Bids','My Bids'],['Me','Profile']]){await nav.getByRole('link',{name:destination,exact:true}).click();await expect(page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible();await expect(page.getByRole('banner',{name:'Mini App header',exact:true})).toHaveCount(0)}
   const walletBefore=walletGets;await nav.getByRole('link',{name:'Home',exact:true}).click();await expect(cards).toHaveCount(12);await expect.poll(()=>walletGets-walletBefore).toBe(1);await page.waitForTimeout(150);expect(walletGets-walletBefore).toBe(1);await expect(page.getByRole('banner',{name:'Mini App header',exact:true})).toHaveCount(1);await expect(page.locator('.customer-loading')).toHaveCount(0);const mountedHeader=await page.getByRole('banner',{name:'Mini App header',exact:true}).elementHandle();await page.waitForTimeout(300);expect(await mountedHeader!.evaluate(node=>node.isConnected)).toBe(true);expect(new URL(page.url()).pathname+new URL(page.url()).search).toBe(href);await expect.poll(async()=>Math.abs((await page.evaluate(()=>scrollY))-expected),{timeout:5000}).toBeLessThan(80);returns.push({round:round+1,expected,actual:await page.evaluate(()=>scrollY),cards:await cards.count(),hrefPreserved:true});
  }
  const root=process.env.CLIENT_FLOW_REPORT_DIR??'test-results/client-flow';mkdirSync(root,{recursive:true});writeFileSync(`${root}/home-return-${info.project.name}.json`,JSON.stringify({mode:process.env.REDESIGN_PRODUCTION==='1'?'optimized HTTPS loopback':'isolated development preflight',width:info.project.name,returns},null,2)+'\n');
 }finally{await db.$disconnect()}
});
