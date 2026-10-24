import {test,expect,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {hashPassword} from 'better-auth/crypto';
import {newTotpSecret,seal,totp} from '../../src/modules/admin/crypto';
import {bidAuction} from '../bid-fixtures';
import {reconcile} from '../../src/modules/wallet/ledger';

test('direct-payment workspace with real staff login and MFA at mobile and desktop widths',async({page,browser})=>{
 const url=process.env.TEST_DATABASE_URL!,target=new URL(url);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 page.setDefaultTimeout(30000);
 const db=new PrismaClient({datasourceUrl:url}),root=process.env.REDESIGN_CAPTURE_DIR??'docs/redesign/screenshots/admin-direct';mkdirSync(root,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const password='Local-admin-browser-only-2026',origin=process.env.BETTER_AUTH_URL!;
 async function staff(role:string){const id=randomUUID(),email=`${role.toLowerCase()}-${id.slice(0,8)}@lowin.test`,secret=newTotpSecret();await db.user.create({data:{id,name:`DEMO ${role==='OWNER'?'Owner':'Player care'}`,email,emailVerified:true,accounts:{create:{id:randomUUID(),providerId:'credential',accountId:id,password:await hashPassword(password)}},staffMember:{create:{role,active:true,secret:seal(secret),recoveryHashes:[]}}}});return {id,email,secret}}
 async function login(p:Page,actor:Awaited<ReturnType<typeof staff>>){p.setDefaultTimeout(30000);await p.goto('/admin/login');await p.getByLabel('Staff email').fill(actor.email);await p.getByLabel('Password',{exact:true}).fill(password);await p.getByRole('button',{name:'Continue',exact:true}).click();await expect(p.getByRole('heading',{name:'Confirm it’s you'})).toBeVisible();await p.getByLabel('Authenticator or recovery code').fill(totp(actor.secret,BigInt(Math.floor(Date.now()/30000))));await p.getByRole('button',{name:'Verify authenticator'}).click();await expect(p.getByRole('heading',{name:'Overview',exact:true})).toBeVisible()}
 async function capture(name:string){await expect(page.locator('.loading-spinner')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${root}/${name}.png`,fullPage:true,animations:'disabled'})}
 try{
  expect((await page.request.get('/api/admin/arifpay')).status()).toBe(401);
  const owner=await staff('OWNER'),support=await staff('SUPPORT'),auction=await bidAuction(db,{ruleVersion:'lowest-unique-v4',fee:30,isDemo:false});
  await db.product.update({where:{id:auction.productId!},data:{title:'DEMO camera · admin payment fixture'}});
  const player=await db.user.create({data:{id:randomUUID(),name:'DEMO player · local fixture',telegramId:String(Date.now())}}),ids:string[]=[];
  for(const [i,status]of ['PENDING','NEEDS_REVIEW','FAILED'].entries()){const order=await db.arifPayCheckout.create({data:{userId:player.id,auctionId:auction.id,auctionSlug:auction.slug!,key:randomUUID(),requestHash:randomUUID(),bidNumber:String(10+i),feeVersion:1,fee:'30',channel:i===1?'MPESA':'TELEBIRR',phoneCipher:'fixture-not-a-real-payer',phoneHash:randomUUID(),nonce:randomUUID(),status,reason:status==='NEEDS_REVIEW'?'PROVIDER_CONFIRMATION_REQUIRED':status==='PENDING'?'AWAITING_PROVIDER':'PAYMENT_NOT_COMPLETED',sessionId:`fixture-session-${randomUUID()}`,expiresAt:new Date(Date.now()+600000)}});ids.push(order.id)}
  await login(page,owner);
  for(const width of [1440,430,360]){
   await page.setViewportSize({width,height:width>700?1000:932});await page.goto('/admin');await expect(page.getByText('Accepted fees',{exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText(/Total deposits|Available balance/);await capture(`overview-${width}`);
   await page.goto(`/admin/payments?q=${ids[0]}`);await expect(page.getByRole('heading',{name:'Bid payments',exact:true})).toBeVisible();await expect(page.locator('.direct-payment-list tbody tr')).toHaveCount(1);await expect(page.getByLabel('ArifPay availability')).toContainText('disabled');await capture(`payments-${width}`);
   await page.getByLabel('Find payment').fill(player.id);await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.locator('.direct-payment-list tbody tr')).toHaveCount(3);await page.getByLabel('Status',{exact:true}).selectOption('NEEDS_REVIEW');await expect(page.locator('.direct-payment-list tbody tr')).toHaveCount(1);await page.getByLabel('Channel',{exact:true}).selectOption('MPESA');await expect(page.locator('.direct-payment-list')).toContainText('M-PESA');await page.getByRole('link',{name:'Review',exact:true}).click();await expect(page.getByRole('heading',{name:'Payment details',exact:true})).toBeVisible();await expect(page.locator('.direct-receipt')).toContainText('Provider evidence needs review.');await expect(page.locator('.direct-check')).toContainText('Provider checks are disabled');await expect(page.getByRole('button',{name:'Check provider status'})).toHaveCount(0);await capture(`payment-review-${width}`);
   await page.goto(`/admin/users?q=${player.id}`);await expect(page.getByRole('heading',{name:'Players',exact:true})).toBeVisible();await expect(page.locator('.people-table tbody tr')).toHaveCount(1);await expect(page.locator('main')).not.toContainText(/Available balance|Held balance|Balance/);await page.getByRole('button',{name:'Details',exact:true}).click();await expect(page.getByRole('region',{name:'Player details'})).toContainText(player.name);await capture(`players-${width}`);
   if(width===360){const menu=page.getByRole('button',{name:'Menu',exact:true});await menu.click();await expect(page.getByRole('navigation',{name:'Business areas'}).getByRole('link',{name:'Payments'})).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toBeFocused()}
  }
  const detail=await (await page.request.get('/api/admin/arifpay/'+ids[0])).json();expect(JSON.stringify(detail)).not.toMatch(/phoneCipher|phoneHash|nonce|receipt|requestHash/);
  const cross=await page.request.post('/api/admin/arifpay',{headers:{origin:'https://attacker.example'},data:{action:'check',input:{id:ids[0],key:randomUUID(),reason:'Local test only'}}});expect(cross.status()).toBe(403);
  const context=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,viewport:{width:430,height:932}}),care=await context.newPage();await login(care,support);await care.goto('/admin/payments/'+ids[1]);await expect(care.getByRole('heading',{name:'Payment details',exact:true})).toBeVisible();await expect(care.locator('.direct-receipt')).toBeVisible();await expect(care.getByRole('heading',{name:'Check with ArifPay'})).toHaveCount(0);const supportView=await (await care.request.get('/api/admin/arifpay/'+ids[1])).json();expect(supportView.item.providerSession).toBeNull();expect((await care.request.post('/api/admin/arifpay',{data:{action:'check',input:{id:ids[1],key:randomUUID(),reason:'Local role test'}}})).status()).toBe(403);await care.screenshot({path:`${root}/support-readonly-430.png`,fullPage:true});await context.close();
  expect(await reconcile(db)).toEqual([]);expect(errors).toEqual([]);
 }finally{await db.$disconnect()}
});
