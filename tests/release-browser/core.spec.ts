import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {signedLaunch,LOCAL_ACCESS_KEY} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';
import {creditDevelopmentPoints} from '../../src/modules/wallet/ledger';

test.beforeEach(async({page})=>{await page.route('https://telegram.org/**',r=>r.fulfill({body:''}))});
test('navigation, centered deposit, locale persistence and blurred page loading',async({page},info)=>{
 const response=await page.request.post('/api/auth/lowin/dev-identity',{headers:{origin:'http://localhost:3123'},data:{accessKey:LOCAL_ACCESS_KEY}});expect(response.status()).toBe(200);
 await page.goto('/');
 const nav=page.getByRole('navigation',{name:'Your navigation'});
 await expect(nav.getByRole('link')).toHaveCount(7);
 const boxes=await nav.getByRole('link').evaluateAll(links=>links.map(link=>({top:link.getBoundingClientRect().top,left:link.getBoundingClientRect().left,width:link.getBoundingClientRect().width})));
 expect(Math.max(...boxes.map(b=>b.top))-Math.min(...boxes.map(b=>b.top))).toBeLessThan(2);
 expect(Math.abs(boxes[3].left+boxes[3].width/2-info.project.use.viewport!.width/2)).toBeLessThan(2);
 await expect(nav.getByRole('link',{name:'Deposit'})).toHaveAttribute('href','/wallet#add-etb');
 await page.getByRole('button',{name:'Language',exact:true}).click();await page.getByRole('menuitemradio').nth(1).click();
 await expect(page.locator('html')).toHaveAttribute('lang','am');await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','am');
 // Reset only locale for the English selectors below, never authentication.
 await page.evaluate(()=>{localStorage.setItem('lowwin-language','en');document.cookie='lowwin-language=en; path=/'});await page.reload();
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/profile/wins?*',async route=>{await held;await route.fulfill({json:{items:[],page:1,total:0,totalPages:0}})});
 const requested=page.waitForRequest(request=>request.url().includes('/api/profile/wins?'));
 await nav.getByRole('link',{name:'Winning Bids'}).click();await requested;
 await page.waitForURL('**/profile/wins');
 await expect(page.locator('.page-loading-backdrop')).toBeVisible();
 await expect.poll(()=>page.locator('.page-loading-backdrop').evaluate(node=>getComputedStyle(node).backdropFilter)).toContain('blur');
 await expect(page.locator('.app-frame')).toHaveAttribute('inert','');
 await page.screenshot({path:`test-results/release/loading-${info.project.name}.png`});release();
 await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);
 await expect(page.getByText('No winning bids found.')).toBeVisible();
 await nav.getByRole('link',{name:'Deposit'}).click();await expect(page.getByRole('button',{name:'Submit deposit'})).toBeDisabled();
 await page.getByRole('button',{name:'Telebirr',exact:false}).click();await expect(page.getByText('Selected payment account')).toBeVisible();await page.getByRole('button',{name:'Telebirr',exact:false}).click();await expect(page.getByText('Selected payment account')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/release/wallet-${info.project.name}.png`,fullPage:true});
});

test('signed contact, bid confirmation, receipt and private balance',async({page},info)=>{
 Object.assign(process.env,{NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
 const db=new PrismaClient();
 try {
  const auction=await bidAuction(db,{fee:2,endDelayMs:300000});
  const telegramId=randomInt(7000000000,8000000000);await verifyFixtureContact(db,telegramId);
  const data=signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Lowwin player'})});
  await page.addInitScript(data=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}}},data);
  await page.goto('/profile');await expect(page.locator('.profile-heading h2')).toBeVisible();
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
  const me=await page.request.get('/api/me');expect(me.status()).toBe(200);expect((await me.json()).user.id).toBe(user.id);
  await creditDevelopmentPoints(db,user.id,'1000',randomUUID());
  await page.goto(`/auctions/${auction.slug}`);await page.getByLabel('ETB amount',{exact:true}).fill('40');
  await page.getByRole('button',{name:'Review ETB bid'}).click();await expect(page.locator('.preview-total')).toContainText('ETB 42.00');
  await page.getByRole('button',{name:'Confirm bid'}).click();await expect(page.locator('.receipt-panel')).toContainText('ETB 958.00');
  await expect(page.locator('.receipt-panel')).toContainText('ETB 40.00');
  const publicResponse=await page.request.get(`/api/catalog/auctions/${auction.slug}`);expect(publicResponse.status()).toBe(200);const text=await publicResponse.text();expect(text).not.toContain(user.id);expect(text).not.toContain('ownBids');
  await page.getByRole('link',{name:'View wallet'}).click();await expect(page.getByText('958.00 ETB',{exact:true})).toBeVisible();
  await page.getByText('Wallet activity',{exact:true}).click();await expect(page.getByText('Auction entry fee',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/release/bid-wallet-${info.project.name}.png`,fullPage:true});
 }finally{await db.$disconnect()}
});
