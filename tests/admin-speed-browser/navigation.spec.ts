import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';

const stage=process.env.ADMIN_SPEED_STAGE??'after';
test('admin cached navigation, progressive Overview and contained cards',async({page})=>{
 const database=process.env.TEST_DATABASE_URL??'',target=new URL(database);if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database}),id=randomUUID(),password='Admin-speed-fixture-password-12345',email=`admin-speed-${id}@lowwin.test`,reads:string[]=[],errors:string[]=[];
 const now=new Date().toISOString(),player={id:randomUUID(),name:'Synthetic admin player',telegramId:'888888888',telegramUsername:'admin_speed_fixture',phone:'+251911000000',phoneUnavailable:false,createdAt:now,bidCount:31,winCount:0,suspended:false,available:'250.00',held:'0',referralCount:1,rewardCount:0};
 const summary={serverNow:now,auctions:{state:'ready',count:2,live:2,items:[]},players:{state:'ready',count:1683,total:1683},payments:{state:'ready',count:11},deliveries:{state:'ready',count:0},daily:{newMembers:{state:'ready',count:12},money:{state:'ready',depositEtb:'0.00',successfulPayments:42,paymentEtb:'6321099.95'}}};
 let release!:()=>void,holding=stage==='after';const held=new Promise<void>(resolve=>release=resolve);
 await db.user.create({data:{id,email,name:'Synthetic admin speed',emailVerified:true,role:'admin'}});await db.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:await hashPassword(password)}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https:\/\/(?:api\.resend\.com|api\.telegram\.org|api\.chapa\.global)\//,route=>route.abort());
 await page.route('**/api/admin/**',async route=>{
  const url=new URL(route.request().url());if(route.request().method()!=='GET')return route.continue();reads.push(url.pathname+url.search);
  if(url.pathname==='/api/admin/dashboard'||url.pathname==='/api/admin/dashboard/summary')return route.fulfill({json:summary});
  if(url.pathname==='/api/admin/dashboard/auctions'){if(stage==='after'&&holding)await held;return route.fulfill({json:{serverNow:now,items:[]}})}
  if(url.pathname==='/api/admin/workspace/players')return route.fulfill({json:{items:[player],page:1,total:1,totalPages:1}});
  if(url.pathname==='/api/admin/notifications')return route.fulfill({json:{items:[],page:1,total:0,totalPages:0}});
  return route.continue();
 });
 const navigate=async(label:string)=>page.getByRole('navigation',{name:'Business areas'}).getByRole('link',{name:label,exact:true}).click();
 try{
  await page.goto('/admin/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);const start=performance.now();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  if(stage==='before')await expect(page.getByRole('region',{name:'Workspace summary'})).toBeVisible();else{
   await expect(page.locator('[data-overview-card]')).toHaveCount(8);
   await expect(page.locator('[data-overview-card="players"]')).toContainText('1,683');
   await expect(page.locator('[data-overview-card="new-members"]')).toContainText('12');
   await expect(page.locator('[data-overview-card="deposits-today"]')).toContainText('ETB 0.00');
   await expect(page.locator('[data-overview-card="deposits-today"]')).toHaveAttribute('href','/admin/payments?view=completed&purpose=TOP_UP');
   await expect(page.locator('[data-overview-card="successful-payments"]')).toContainText('42');
   await expect(page.locator('[data-overview-card="payments-today"]')).toContainText('ETB 6,321,099.95');
   await expect(page.getByText('Daily totals use Addis Ababa.',{exact:true})).toBeVisible();
   await expect(page.getByText('Loading active auctions…')).toBeVisible();holding=false;release();
  }
  const coldOverviewMs=performance.now()-start,firstReads=[...reads];const tableStart=performance.now();await navigate('Players');await expect(page.getByRole('region',{name:'Players and wallets'})).toContainText(player.name);const coldTableMs=performance.now()-tableStart;
  await navigate('Overview');await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();const before=reads.length,warmStart=performance.now();await navigate('Players');await expect(page.getByRole('region',{name:'Players and wallets'})).toContainText(player.name);const warmTableMs=performance.now()-warmStart,warmReads=reads.length-before;
  const frames=[];for(const width of [360,430,1440]){await page.setViewportSize({width,height:1000});await page.goto('/admin');if(stage==='after'){await expect(page.locator('[data-overview-card]')).toHaveCount(8);await expect(page.locator('[data-overview-card="payments-today"]')).toContainText('ETB 6,321,099.95');const cards=await page.locator('[data-overview-card]').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {x:box.x,right:box.right,width:box.width,height:box.height,overflow:node.scrollWidth>node.clientWidth+1}}));for(const card of cards){expect(card.width).toBeGreaterThan(100);expect(card.height).toBeGreaterThan(100);expect(card.x).toBeGreaterThanOrEqual(0);expect(card.right).toBeLessThanOrEqual(width+1);expect(card.overflow).toBe(false)}frames.push({width,cards});mkdirSync('test-results/admin-speed/screenshots',{recursive:true});await page.screenshot({path:`test-results/admin-speed/screenshots/overview-${width}.png`,fullPage:true})}}
  expect(errors).toEqual([]);expect(warmReads).toBe(0);mkdirSync('test-results/admin-speed',{recursive:true});writeFileSync(`test-results/admin-speed/${stage}.json`,JSON.stringify({stage,coldOverviewMs,coldTableMs,warmTableMs,warmReads,firstReads,reads,frames},null,2));
 }finally{release();await db.$disconnect()}
});
