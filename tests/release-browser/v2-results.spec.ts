import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from '../bid-fixtures';
import {LOCAL_ACCESS_KEY} from '../helpers';
import {submitBid} from '../../src/modules/auctions/bids';
import {closeAuction} from '../../src/modules/auctions/settlement';

test('v2 disclosure, fallback result and Amharic never call the fallback unique',async({page},info)=>{
 Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
 const db=new PrismaClient();
 try{
  await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));
  const sign=await page.request.post('/api/auth/lowin/dev-identity',{headers:{origin:'http://localhost:3123'},data:{accessKey:LOCAL_ACCESS_KEY}});expect(sign.status()).toBe(200);
  const a=await bidAuction(db,{ruleVersion:'lowest-unique-v2',fee:2,endDelayMs:25000}),first=await bidUser(db),second=await bidUser(db);
  await submitBid(db,{userId:first,auctionSlug:a.slug!,amount:'1',key:randomUUID()});await submitBid(db,{userId:second,auctionSlug:a.slug!,amount:'1',key:randomUUID()});
  await page.goto(`/auctions/${a.slug}`);
  await expect(page.locator('.auction-rule').first()).toContainText('At least two eligible people');
  await expect(page.locator('.auction-rule').first()).toContainText('A higher unique amount always takes priority');
  const [{now}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;await new Promise(r=>setTimeout(r,Math.max(0,a.endsAt!.getTime()-now.getTime()+30)));await closeAuction(db,a.id);
  await page.goto(`/winners/${a.publicCode}`);
  await expect(page.locator('.result-summary')).toContainText('First accepted lowest amount');
  await expect(page.locator('.result-summary')).not.toContainText('Lowest unique amount');
  expect(await page.locator('article').innerText()).not.toContain(first);
  await page.getByRole('button',{name:'Language',exact:true}).click();await page.getByRole('menuitemradio').nth(1).click();
  await expect(page.locator('.result-summary')).toContainText('መጀመሪያ የተቀበለው ዝቅተኛ መጠን');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/release/v2-fallback-am-${info.project.name}.png`,fullPage:true});
 }finally{await db.$disconnect()}
});
