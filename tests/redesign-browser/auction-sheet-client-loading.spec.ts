import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

test('card entry opens before private data, pending reopen dedups and late selection cannot overwrite',async({page})=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const gate=()=>{let release!:()=>void;return {pending:new Promise<void>(resolve=>{release=resolve}),release:()=>release()}};
 const first=gate(),second=gate(),wallet=gate();let firstGets=0,secondGets=0,walletGets=0,financialPosts=0;
 try{
  const a=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),b=await bidAuction(db,{fee:20,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),marker='QA immediate '+randomUUID().slice(0,6),id=randomInt(8000000000,8900000000);
  await db.product.update({where:{id:a.productId!},data:{title:marker+' first'}});await db.product.update({where:{id:b.productId!},data:{title:marker+' second'}});await verifyFixtureContact(db,id);
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/wallet',async route=>{walletGets++;await wallet.pending;await route.continue()});
  for(const [auction,held] of [[a,first],[b,second]] as const)await page.route('**/api/auctions/'+auction.slug+'/bids',async route=>{if(route.request().method()==='POST'){financialPosts++;await route.abort();return}if(auction.id===a.id)firstGets++;else secondGets++;await held.pending;await route.continue()});
  await page.addInitScript(({launch})=>{localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Immediate sheet QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));
  const cards=page.locator('#discover-auctions .auction-card'),firstCard=cards.filter({has:page.getByRole('heading',{name:marker+' first',exact:true})}),secondCard=cards.filter({has:page.getByRole('heading',{name:marker+' second',exact:true})});await expect(cards).toHaveCount(2);
  const openFirst=firstCard.getByRole('button',{name:'Place a bid',exact:true}),sheet=page.getByRole('dialog',{name:/^Place your bid/});
  await openFirst.click();await expect(sheet).toBeVisible();await expect(sheet.getByRole('textbox',{name:'Your bid number',exact:true})).toBeVisible();await expect(sheet).toContainText(marker+' first');await expect(sheet).toContainText('ETB 10.00');await expect(sheet.locator('.customer-loading,.loading-spinner-ring')).toHaveCount(0);
  await expect.poll(()=>firstGets).toBe(1);await expect.poll(()=>walletGets).toBe(1);await expect(page.locator('[data-header-balance]')).toHaveAttribute('aria-busy','true');
  await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await openFirst.click();await expect(sheet).toBeVisible();expect(firstGets).toBe(1);expect(walletGets).toBe(1);await page.keyboard.press('Escape');
  await secondCard.getByRole('button',{name:'Place a bid',exact:true}).click();await expect(sheet).toContainText(marker+' second');await expect(sheet).toContainText('ETB 20.00');await expect.poll(()=>secondGets).toBe(1);
  const firstResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auctions/'+a.slug+'/bids');first.release();wallet.release();await (await firstResponse).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await expect(page.locator('[data-header-balance]')).toHaveText(/^0\.00\s*ETB$/);
  await expect(sheet).toContainText(marker+' second');await expect(sheet).toContainText('ETB 20.00');await expect(sheet).toContainText('Enter an amount from 1. Step 0.01.');
  const secondResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auctions/'+b.slug+'/bids');second.release();await (await secondResponse).finished();await page.keyboard.press('Escape');
  await openFirst.click();await expect(sheet).toContainText(marker+' first');await expect(sheet).toContainText('ETB 10.00');expect(firstGets).toBe(1);expect(walletGets).toBe(1);expect(financialPosts).toBe(0);await page.keyboard.press('Escape');await expect(openFirst).toBeFocused();
 }finally{first.release();second.release();wallet.release();await db.$disconnect()}
});
