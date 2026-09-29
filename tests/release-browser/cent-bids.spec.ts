import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';
import {creditDevelopmentPoints,reconcile} from '../../src/modules/wallet/ledger';
import {submitBid} from '../../src/modules/auctions/bids';

test('v3 decimal confirmation, cent gap, receipt and bilingual mobile layout',async({page},info)=>{
 Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
 const db=new PrismaClient();
 try{
  const auction=await bidAuction(db,{ruleVersion:'lowest-unique-v3',fee:0.03,endDelayMs:300000});
  const telegramId=randomInt(7000000000,8000000000);await verifyFixtureContact(db,telegramId);
  await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));
  const data=signedLaunch({user:JSON.stringify({id:telegramId,first_name:'DEMO decimal bidder'})});
  await page.addInitScript(data=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}},data);
  await page.goto('/profile');await expect(page.locator('.profile-heading h2')).toBeVisible();
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
  await creditDevelopmentPoints(db,user.id,'10.25',randomUUID());
  for(const amount of ['1.01','1.02','1.03'])await submitBid(db,{userId:user.id,auctionSlug:auction.slug!,amount,key:randomUUID()});
  await page.goto(`/auctions/${auction.slug}`);
  const input=page.getByLabel('ETB amount',{exact:true}),review=page.getByRole('button',{name:'Review ETB bid'});
  await expect(input).toHaveAttribute('inputmode','decimal');
  await input.fill('0.99');await expect(review).toBeDisabled();
  await input.fill('1.971');await expect(review).toBeDisabled();
  await input.fill('1.04');await expect(review).toBeDisabled();await expect(page.getByText('Leave a gap after three consecutive cent amounts.')).toBeVisible();
  await input.fill('1.05');await expect(review).toBeEnabled();
  await input.fill('1.97');await review.click();
  await expect(page.locator('.preview-total')).toContainText('ETB 0.97');
  await expect(page.locator('.auction-rule').first()).toContainText('Minimum bid ETB 1.00');
  await page.screenshot({path:`test-results/release/cent-confirm-${info.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Confirm bid'}).click();
  await expect(page.locator('.receipt-panel')).toContainText('ETB 1.97');
  await expect(page.locator('.receipt-panel')).toContainText('ETB 8.16');
  await page.getByRole('link',{name:'View wallet'}).click();await expect(page.getByText('8.16 ETB',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Language',exact:true}).click();await page.getByRole('menuitemradio').nth(1).click();
  await page.goto(`/auctions/${auction.slug}`);await expect(page.locator('html')).toHaveAttribute('lang','am');
  await expect(page.locator('.auction-rule').first()).toContainText('ዝቅተኛው የጨረታ መጠን 1.00 ብር');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/release/cent-auction-am-${info.project.name}.png`,fullPage:true});
  expect(await reconcile(db)).toEqual([]);
 }finally{await db.$disconnect()}
});
