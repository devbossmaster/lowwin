import { test,expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomInt,randomUUID } from 'node:crypto';
import { signedLaunch } from '../helpers';
import { bidAuction } from '../bid-fixtures';
import { creditDevelopmentPoints } from '../../src/modules/wallet/ledger';

test('signed mobile bid confirmation, receipt and wallet activity',async({page},testInfo)=>{
  test.skip(!process.env.TEST_DATABASE_URL,'A disposable loopback database is required');
  const url=new URL(process.env.TEST_DATABASE_URL!);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Disposable loopback *_test database required');
  Object.assign(process.env,{DATABASE_URL:url.toString(),DIRECT_URL:url.toString(),APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
  const client=new PrismaClient();
  try {
    const auction=await bidAuction(client,{fee:2,endDelayMs:300000});
    const telegramId=randomInt(4000000000,5000000000),launch=signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Browser bidder'})});
    await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
    await page.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}}, {data:launch});
    await page.goto('/profile');
    await expect(page.locator('.profile-heading h2')).toHaveText('Browser bidder',{timeout:20000});
    const user=await client.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
    await creditDevelopmentPoints(client,user.id,'1000',`browser-bid-${randomUUID()}`);
    await page.goto(`/auctions/${auction.slug}`);
    await expect(page.getByRole('heading',{name:'Choose a point amount'})).toBeVisible();
    await page.getByLabel('Point amount').fill('40');
    await page.getByRole('button',{name:'Review point bid'}).click();
    await expect(page.getByText('Previous maximum hold')).toBeVisible();
    await expect(page.locator('.preview-total')).toContainText('42 pts');
    await page.screenshot({path:`docs/screenshots/bid-confirm-${testInfo.project.name}.png`,fullPage:true});
    await page.getByRole('button',{name:'Confirm bid'}).click();
    await expect(page.getByRole('heading',{name:'40 points accepted'})).toBeVisible({timeout:20000});
    await expect(page.locator('.receipt-panel')).toContainText('958 pts');
    await page.screenshot({path:`docs/screenshots/bid-receipt-${testInfo.project.name}.png`,fullPage:true});
    await page.getByRole('link',{name:'View wallet'}).click();
    await expect(page.locator('.wallet-summary strong')).toContainText('958');
    await expect(page.locator('.wallet-summary')).toContainText('40 pts');
    await expect(page.getByText('Auction entry fee')).toBeVisible();
    await page.screenshot({path:`docs/screenshots/bid-wallet-${testInfo.project.name}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'My Bids'}).click();
    await expect(page.locator('.personal-bid-row')).toContainText('40 pts');
    await page.screenshot({path:`docs/screenshots/bid-my-bids-${testInfo.project.name}.png`,fullPage:true});
    const publicResponse=await page.request.get(`/api/catalog/auctions/${auction.slug}`);
    expect(publicResponse.status()).toBe(200);
    const publicJson=JSON.stringify(await publicResponse.json());
    expect(publicJson).not.toContain(user.id);expect(publicJson).not.toContain('ownBids');
  } finally {await client.$disconnect()}
});
