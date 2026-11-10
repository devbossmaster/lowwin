import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';

test('ordinary Payments separates confirmed money from unresolved attempts and retains details',async({page})=>{
 const database=process.env.TEST_DATABASE_URL??'',target=new URL(database);
 if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable database required');
 const db=new PrismaClient({datasourceUrl:database}),id=randomUUID(),email=`payment-view-${id}@lowwin.test`,password='Isolated-payment-view-password-12345',now=new Date().toISOString();
 await db.user.create({data:{id,email,name:'Synthetic payment reviewer',emailVerified:true,role:'admin'}});
 await db.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:await hashPassword(password)}});
 const base={source:'chapa',provider:'Chapa',amount:'50.00',purpose:'BID',typeLabel:'Bid payment attempt',createdAt:now,user:{name:'Synthetic player'},creditApplied:false};
 const rows=[{...base,id:'preserved',status:'NEEDS_REVIEW',creditApplied:true,fundsPreserved:true,providerStatus:'SUCCESS',verificationState:'VERIFIED'},
  {...base,id:'timeout',status:'EXPIRED',providerStatus:'PENDING',verificationState:'UNVERIFIED'},
  {...base,id:'failed',status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED'},
  {...base,id:'wallet',source:'wallet',provider:'Wallet',status:'BID_ACCEPTED',creditApplied:true}];
 const writes:string[]=[];
 page.on('request',r=>{if(r.method()!=='GET'&&!r.url().includes('/api/auth/'))writes.push(r.url())});
 await page.route(/^https:\/\/(?:api\.telegram\.org|api\.chapa\.global|api\.resend\.com)\//,r=>r.abort());
 await page.route('**/api/admin/workspace/transactions?**',r=>r.fulfill({json:{items:rows,total:4,page:1,totalPages:1,configured:true,chapaConfigured:true,serverNow:now}}));
 try{
  await page.goto('/admin/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Business areas'}).getByRole('link',{name:'Payments',exact:true}).click();
  const table=page.getByRole('region',{name:'Payments',exact:true}),tabs=page.getByRole('navigation',{name:'Payment status'});
  await expect(table.locator('[data-payment-summary="done"]')).toHaveCount(2);
  await expect(table.locator('[data-payment-summary="failed"]')).toHaveText('Failed');
  await expect(table.locator('[data-payment-summary="checking"]')).toHaveText('Checking payment…');
  await expect(table).toContainText('Funds in wallet; bid not accepted');
  await expect(tabs.getByRole('button')).toHaveText(['All','Done','Failed']);await expect(table.getByRole('button',{name:'Details',exact:true})).toHaveCount(4);
  for(const width of [320,430]){
   await page.setViewportSize({width,height:900});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   expect(await table.evaluate(node=>node.scrollWidth>=node.clientWidth)).toBe(true);
   mkdirSync('test-results/admin-speed/screenshots',{recursive:true});await page.screenshot({path:`test-results/admin-speed/screenshots/payments-${width}.png`,fullPage:true});
  }
  expect(writes).toEqual([]);
 }finally{await db.$disconnect()}
});
