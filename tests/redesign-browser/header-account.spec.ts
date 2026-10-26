import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {creditDevelopmentPoints,reconcile} from '../../src/modules/wallet/ledger';

test('account header: real balance, destinations, avatar fallback, language and unread updates',async({page},info)=>{
 page.setDefaultTimeout(30000);
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database}),name='Abebe With A Very Long Telegram Display Name',root=process.env.HEADER_CAPTURE_DIR??'test-results/header-captures';mkdirSync(root,{recursive:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let failAvatar=false;
 try{
  const id=randomInt(9800000000,9900000000);await verifyFixtureContact(db,id);
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('https://header-avatar.example.test/**',route=>route.fulfill(failAvatar?{status:404,body:''}:{contentType:'image/png',body:readFileSync('public/logo.png')}));
  await page.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{data:signedLaunch({user:JSON.stringify({id,first_name:name,photo_url:'https://header-avatar.example.test/avatar.png'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/');const header=page.getByRole('banner',{name:'Mini App header'});
  await expect(header.locator('[data-header-balance]')).toHaveText('0.00 ETB');
  const balance=header.locator('a[href="/wallet"]'),pill=balance.locator('..');await expect(balance).toHaveCSS('color','rgb(255, 255, 255)');
  const capsule=await pill.evaluate(node=>{const shape=getComputedStyle(node,'::before'),box=node.getBoundingClientRect();return {width:box.width,height:box.height-parseFloat(shape.top)-parseFloat(shape.bottom),color:shape.backgroundColor}});expect(capsule.width).toBeGreaterThanOrEqual(110);expect(capsule.width).toBeLessThanOrEqual(125);expect(capsule.height).toBe(32);expect(capsule.color).toBe('rgb(201, 162, 39)');
  await header.screenshot({path:`${root}/header-${info.project.name}-zero.png`});
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(id)}});
  // The avatar must arrive from signed Telegram data, not a seeded database image.
  expect(user.image).toBe('https://header-avatar.example.test/avatar.png');
  await db.playerProfile.upsert({where:{userId:user.id},create:{userId:user.id,displayName:name,bio:''},update:{displayName:name}});
  await page.reload();await expect(header.locator('[data-header-balance]')).toHaveText('0.00 ETB');
  Object.assign(process.env,{DEV_POINTS_ENABLED:'true',NODE_ENV:'test'});
  await creditDevelopmentPoints(db,user.id,'1234.50','header-fixture-'+randomUUID());
  await page.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));
  await expect(header.locator('[data-header-balance]')).toHaveText('1234.50 ETB');
  const brand=header.getByRole('link',{name:'Lowwin Home',exact:true});await expect(brand).toHaveText('Lowwin');await expect(brand.locator('img')).toBeVisible();await expect(brand).toHaveCSS('color','rgb(0, 0, 0)');
  const profile=header.getByRole('link',{name:`Profile, ${name}`,exact:true});await expect(profile).toHaveAttribute('href','/profile');
  await expect(profile.locator('img')).toBeVisible();await expect.poll(()=>profile.locator('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
  for(const control of await header.locator('a,button').all()){const box=await control.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const centers=await header.locator('a,button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return r.top+r.height/2}));expect(Math.max(...centers)-Math.min(...centers)).toBeLessThanOrEqual(1);
  expect(await header.locator('[data-header-balance] > span').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await header.screenshot({path:`${root}/header-${info.project.name}-en.png`});
  await db.notificationInbox.create({data:{key:'header-alert-'+randomUUID(),userId:user.id,kind:'PAYMENT_VERIFIED',title:'Header notification fixture',body:'Local test only',href:'/payments'}});
  await page.evaluate(()=>window.dispatchEvent(new Event('lowin-alerts')));const bell=header.getByRole('button',{name:'Notifications, 1 unread',exact:true});await expect(bell).toBeVisible();await bell.click();await expect(page.getByRole('dialog',{name:'Notifications'})).toContainText('Header notification fixture');await page.keyboard.press('Escape');await expect(bell).toBeFocused();
  await header.getByRole('link',{name:'Wallet, 1234.50 ETB',exact:true}).click();await expect(page).toHaveURL(/\/profile#wallet$/);const wallet=page.getByRole('region',{name:'Your wallet',exact:true});await expect(wallet).toContainText('1234.50 ETB');await expect(wallet.getByRole('link',{name:'Top up wallet',exact:true})).toBeVisible();await expect(header).toHaveCount(0);await expect(page.getByRole('heading',{name:'Profile',exact:true})).toHaveCount(1);
  await page.getByRole('navigation',{name:'Your navigation',exact:true}).getByRole('link',{name:'Home',exact:true}).click();await expect(header).toBeVisible();
  const deposit=header.getByRole('link',{name:'Deposit',exact:true});await deposit.click();const topUp=page.getByRole('dialog',{name:'Top up wallet',exact:true});await expect(topUp).toBeVisible();await expect(topUp.getByRole('button',{name:'Top up',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(topUp).toHaveCount(0);await expect(deposit).toBeFocused();
  await header.getByRole('button',{name:/^Browse auctions/}).click();await page.getByRole('dialog',{name:'Auctions',exact:true}).getByRole('link',{name:'Browse all auctions',exact:true}).click();await expect(page).toHaveURL(/\/auctions\/all\?status=live$/);
  await expect(header).toHaveCount(0);await page.getByRole('navigation',{name:'Your navigation',exact:true}).getByRole('link',{name:'Profile',exact:true}).click();await expect(page).toHaveURL(/\/profile$/);await expect(header).toHaveCount(0);await expect(page.getByRole('heading',{name:'Profile',exact:true})).toHaveCount(1);
  await page.getByRole('navigation',{name:'Your navigation',exact:true}).getByRole('link',{name:'Home',exact:true}).click();await expect(header).toBeVisible();
  const language=header.getByRole('button',{name:'Language: English',exact:true});await language.focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitemradio',{name:'English',exact:true})).toBeFocused();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.locator('html')).toHaveAttribute('lang','am');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await header.screenshot({path:`${root}/header-${info.project.name}-am.png`});
  await header.getByRole('button',{name:'ቋንቋ: አማርኛ',exact:true}).click();await page.getByRole('menuitemradio',{name:'English',exact:true}).click();
  await page.route('**/api/wallet',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));await page.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));await expect(header.locator('[data-header-balance]')).toHaveText('— ETB');await page.unroute('**/api/wallet');await page.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));await expect(header.locator('[data-header-balance]')).toHaveText('1234.50 ETB');
  failAvatar=true;await page.reload();await expect(header.getByRole('link',{name:`Profile, ${name}`,exact:true}).locator('img')).toHaveCount(0);await expect(header.getByRole('link',{name:`Profile, ${name}`,exact:true})).toContainText('AW');await expect(header.locator('[data-header-balance]')).toHaveText('1234.50 ETB');await header.screenshot({path:`${root}/header-${info.project.name}-fallback.png`});
  expect(await reconcile(db)).toEqual([]);expect(errors).toEqual([]);
 }finally{await db.$disconnect()}
});
