import { test,expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { bidAuction } from '../bid-fixtures';
import { cancelAuction,closeAuction } from '../../src/modules/auctions/settlement';

test('closing and cancelled states stay truthful at mobile widths',async({page},testInfo)=>{
  test.skip(!process.env.TEST_DATABASE_URL,'Disposable database required');
  const url=process.env.TEST_DATABASE_URL!;
  const client=new PrismaClient({datasourceUrl:url});
  const raw={...process.env,DATABASE_URL:url,APP_ENV:'local',NODE_ENV:'test'};
  try {
    const closing=await bidAuction(client,{endDelayMs:-1000});
    await page.goto(`/auctions/${closing.slug}`);
    await expect(page.getByRole('region',{name:'Auction activity'})).toContainText('Result pending');
    await expect(page.getByRole('link',{name:'View result',exact:true})).toHaveCount(0);
    await expect(page.getByText('Opening your Lowwin…')).toBeHidden({timeout:20000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);await page.screenshot({caret:'initial',path:`docs/screenshots/settlement-closing-${testInfo.project.name}.png`,fullPage:true});
    await closeAuction(client,closing.id,raw);
    const cancelled=await bidAuction(client);
    await cancelAuction(client,{auctionId:cancelled.id,actor:{id:'browser-test-owner',permission:'auction:cancel'},reason:'DEMO mobile fixture',key:randomUUID()},raw);
    await page.goto(`/auctions/${cancelled.slug}`);
    await expect(page.getByRole('region',{name:'Auction activity'})).toContainText('Auction cancelled');await expect(page.getByText(/all.*entry fees|entry fees.*refund/i).first()).toBeVisible();
    await expect(page.getByRole('heading',{name:'Cancelled',exact:true})).toBeVisible();
    await expect(page.getByText('Opening your Lowwin…')).toBeHidden({timeout:20000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);await page.screenshot({caret:'initial',path:`docs/screenshots/settlement-cancelled-${testInfo.project.name}.png`,fullPage:true});
  }finally {await client.$disconnect()}
});
