import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

test('card shell opens before data, pending reopen dedups and late selection cannot overwrite',async({page})=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const gate=()=>{let release!:()=>void;return {pending:new Promise<void>(resolve=>{release=resolve}),release:()=>release()}};
 const first=gate(),second=gate(),wallet=gate();let firstGets=0,secondGets=0,walletGets=0,financialPosts=0;
 try{
  const a=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),b=await bidAuction(db,{fee:20,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),marker='QA immediate '+randomUUID().slice(0,6),id=randomInt(8000000000,8900000000);
  await db.product.update({where:{id:a.productId!},data:{title:marker+' first'}});await db.product.update({where:{id:b.productId!},data:{title:marker+' second'}});await verifyFixtureContact(db,id);
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/wallet',async route=>{walletGets++;await wallet.pending;await route.continue()});
  for(const [auction,held] of [[a,first],[b,second]] as const)await page.route(`**/api/auctions/${auction.slug}/bids`,async route=>{if(route.request().method()==='POST'){financialPosts++;await route.abort();return}if(auction.id===a.id)firstGets++;else secondGets++;await held.pending;await route.continue()});
  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Immediate sheet QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));
  const cards=page.locator('#discover-auctions .auction-card'),firstCard=cards.filter({has:page.getByRole('heading',{name:marker+' first',exact:true})}),secondCard=cards.filter({has:page.getByRole('heading',{name:marker+' second',exact:true})});await expect(cards).toHaveCount(2);
  const openFirst=firstCard.getByRole('button');await openFirst.click();const sheet=page.getByRole('dialog',{name:'Place your bid',exact:true});await expect(sheet).toBeVisible();await expect(sheet).toContainText(marker+' first');await expect(sheet).toContainText('ETB 10.00');await expect(sheet.locator('[data-sheet-details-ready]')).toHaveAttribute('data-sheet-details-ready','false');await expect(sheet.locator('.customer-loading,.loading-spinner-ring')).toHaveCount(0);
  // Published limits already arrive on the Home card. Only the held wallet
  // balance needs a skeleton while the private acceptance state loads.
  const fields=sheet.locator('span[role="status"][aria-label]');await expect(fields).toHaveCount(1);await expect(fields).toHaveAccessibleName('Loading wallet balance');for(const field of await fields.all()){const box=await field.boundingBox();expect(box!.height).toBeLessThanOrEqual(16);expect(box!.width).toBeLessThanOrEqual(100)}
  await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await openFirst.click();await expect(sheet).toBeVisible();await expect.poll(()=>firstGets).toBe(1);expect(walletGets).toBe(1);await page.keyboard.press('Escape');
  await secondCard.getByRole('button').click();await expect(sheet).toContainText(marker+' second');await expect(sheet).toContainText('ETB 20.00');await expect.poll(()=>secondGets).toBe(1);
  first.release();wallet.release();const balance=sheet.locator('[data-bid-balance]');await expect(balance).toHaveCount(1);await expect(balance).toHaveText('0.00 ETB');await expect(sheet.getByRole('radio',{name:'Wallet balance',exact:true})).toBeChecked();await expect(sheet).toContainText(marker+' second');await expect(sheet).toContainText('ETB 20.00');await expect(sheet.locator('[data-sheet-details-ready]')).toHaveAttribute('data-sheet-details-ready','false');
  second.release();await expect(sheet.locator('[data-sheet-details-ready]')).toHaveAttribute('data-sheet-details-ready','true');await expect(fields).toHaveCount(0);await page.keyboard.press('Escape');
  await openFirst.click();await expect(sheet.locator('[data-sheet-details-ready]')).toHaveAttribute('data-sheet-details-ready','true');expect(firstGets).toBe(1);expect(walletGets).toBe(1);expect(financialPosts).toBe(0);await page.keyboard.press('Escape');await expect(openFirst).toBeFocused();
 }finally{first.release();second.release();wallet.release();await db.$disconnect()}
});
