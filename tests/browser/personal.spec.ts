import {verifyFixtureContact} from '../contact-fixtures';
import { test,expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomInt,randomUUID } from 'node:crypto';
import { signedLaunch } from '../helpers';
import { bidAuction } from '../bid-fixtures';
import { creditDevelopmentPoints,reconcile } from '../../src/modules/wallet/ledger';
import { submitBid } from '../../src/modules/auctions/bids';
import { closeAuction,cancelAuction } from '../../src/modules/auctions/settlement';

test('public results and private pages at mobile widths',async({page},testInfo)=>{
  test.skip(!process.env.TEST_DATABASE_URL,'Disposable database required');
  const url=new URL(process.env.TEST_DATABASE_URL!);if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Loopback test database required');
  Object.assign(process.env,{DATABASE_URL:url.toString(),DIRECT_URL:url.toString(),APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
  const client=new PrismaClient({datasourceUrl:url.toString()});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const capture=async(name:string)=>{await expect(page.getByText('Opening your Lowwin…')).toBeHidden({timeout:20000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();await page.evaluate(()=>scrollTo(0,0));await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);await page.screenshot({caret:'initial',path:`docs/screenshots/phase4b-${name}-${testInfo.project.name}.png`,fullPage:true})};
  try {
    const telegramId=randomInt(5000000000,6000000000),launch=signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Mika'})});
    await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
    await verifyFixtureContact(client,telegramId);
    const signin=await page.request.post('/api/auth/telegram/miniapp/signin',{headers:{origin:'http://localhost:3107'},data:{initData:launch}});expect(signin.status()).toBe(200);
    const user=await client.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});await creditDevelopmentPoints(client,user.id,'1000',randomUUID());
    const won=await bidAuction(client,{fee:2,endDelayMs:1800}),cancelled=await bidAuction(client,{fee:3}),live=await bidAuction(client,{fee:1}),pending=await bidAuction(client,{endDelayMs:-1000});
    for(const [auction,title] of [[won,'DEMO walnut lounge chair'],[cancelled,'DEMO everyday watch'],[live,'DEMO studio desk'],[pending,'DEMO result pending']] as const){await client.product.update({where:{id:auction.productId!},data:{title}});await client.productImage.create({data:{productId:auction.productId!,path:auction.id===cancelled.id?'/catalog/watch.svg':auction.id===live.id?'/catalog/computer.svg':'/catalog/chair.svg',alt:`Original designed placeholder for ${title}`,sourceType:'ORIGINAL',sourceCredit:'Original Lowwin geometric placeholder'}})}
    for(const [auction,amount] of [[won,2],[won,20],[cancelled,8],[live,30]] as const)await submitBid(client,{userId:user.id,auctionSlug:auction.slug!,amount:String(amount),key:randomUUID()});
    await cancelAuction(client,{auctionId:cancelled.id,actor:{id:'browser-owner',permission:'auction:cancel'},reason:'DEMO UI fixture',key:randomUUID()});
    const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;await new Promise(resolve=>setTimeout(resolve,Math.max(0,won.endsAt!.getTime()-now.getTime()+30)));await closeAuction(client,won.id);
    await page.goto('/winners?q=DEMO');await expect(page.getByRole('heading',{name:'Winners',exact:true})).toBeVisible();await expect(page.locator('main')).toContainText('DEMO · settled test');await capture('winners');
    await page.getByRole('textbox',{name:'Search auctions',exact:true}).fill(won.code);await page.getByRole('textbox',{name:'Search auctions',exact:true}).press('Enter');await expect(page.getByRole('link',{name:'View Results',exact:true})).toHaveCount(1);await page.getByRole('link',{name:'View Results',exact:true}).click();await expect(page.locator('.result-summary')).toContainText('ETB 2.00');await expect(page.getByText('Anonymous winner',{exact:true})).toBeVisible();await capture('result');
    expect(await page.locator('article').innerText()).not.toContain(user.id);expect(await page.content()).not.toMatch(/amountFrequencies|winnerUserId|winningBidId|transactionId|settlementId/);
    await page.goto(`/winners/${pending.code}`);await expect(page.locator('.result-summary')).toContainText('Closing / result pending');await capture('pending');
    await page.goto(`/winners/${cancelled.code}`);await expect(page.locator('.result-summary')).toContainText('Cancelled');await capture('cancelled');
    await page.goto('/profile');const privateResponse=await page.request.get('/api/profile');expect(privateResponse.headers()['cache-control']).toContain('no-store');await expect(page.locator('.profile-heading h2')).toHaveText('Lowwin player');await expect(page.locator('.profile-wallet')).toContainText('963');await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Display name').fill('Mika’s corner');await page.getByLabel('About you').fill('Furniture, watches and small discoveries.');await page.getByRole('button',{name:'Save profile'}).click();await expect(page.locator('.profile-heading h2')).toHaveText('Mika’s corner');await capture('profile');
    await page.goto('/my-bids');await expect(page.getByRole('link',{name:/View (live auction|auction result):.*your bid/})).toHaveCount(1);await expect(page.getByRole('link',{name:/View (live auction|auction result):.*your bid/})).toContainText('ETB 30.00');await capture('my-bids-live');await page.getByRole('button',{name:/History/}).click();await expect(page.getByRole('link',{name:/View (live auction|auction result):.*your bid/})).toHaveCount(3);await expect(page.getByText(/All entry fees refunded/)).toBeVisible();await capture('my-bids-history');
    await page.goto(`/auctions/${live.slug}`);await page.getByRole('button',{name:'Save to favorites'}).click();await expect(page.getByRole('button',{name:'Saved to favorites'})).toHaveAttribute('aria-pressed','true');
    await page.goto('/profile/favorites');await expect(page.locator('.auction-card')).toHaveCount(1);await page.reload();await expect(page.locator('.auction-card')).toContainText('DEMO studio desk');await capture('favorites');await page.getByRole('button',{name:'Remove from favorites'}).click();await expect(page.getByText('No favorites found.',{exact:true})).toBeVisible();
    await page.goto('/profile/wins');await expect(page.locator('.personal-win')).toHaveCount(1);await expect(page.locator('.personal-win')).toContainText('Fulfillment: Pending');await capture('my-wins');
    await page.goto('/wallet');await page.getByText('Wallet activity',{exact:true}).click();await expect(page.getByText('Cancelled auction fee refund')).toBeVisible();await expect(page.getByText('ETB 30.00 held for auctions')).toBeVisible();await capture('wallet');
    await page.context().clearCookies();await page.goto('/profile/favorites');await expect(page.getByRole('heading',{name:'Your Lowwin starts in Telegram'})).toBeVisible();await expect(page.locator('.auction-card')).toHaveCount(0);expect(errors).toEqual([]);expect(await reconcile(client)).toEqual([]);
  }finally{await client.$disconnect()}
});
