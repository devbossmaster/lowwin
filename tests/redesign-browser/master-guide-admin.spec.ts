import {test,expect,type Page,type Locator} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from 'better-auth/crypto';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';

// Real Better Auth credentials and sessions; only read-only table data is mocked.
// Nothing in this suite sends email, broadcasts, provider requests or ledger writes.
const password='Master-guide-fixture-password-12345';
const now='2026-10-28T09:00:00.000Z';
const screenshotRoot='docs/redesign/screenshots/master-guide-admin';
test.use({actionTimeout:15000,navigationTimeout:30000});

function fixtureDatabase(){
 const raw=process.env.TEST_DATABASE_URL;
 if(!raw)throw Error('TEST_DATABASE_URL is required');
 const url=new URL(raw);
 if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Admin browser checks require an owned disposable loopback _test database');
 return new PrismaClient({datasourceUrl:raw});
}
async function credential(db:PrismaClient,role:'admin'|'member',tag:string){
 const id=randomUUID(),email=`master-${tag}-${id}@lowwin.test`;
 await db.user.create({data:{id,name:`Master ${role} fixture`,email,emailVerified:true,role}});
 await db.account.create({data:{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password:await hashPassword(password)}});
 return {id,email};
}
async function signIn(page:Page,email:string){
 await page.goto('/admin/login');
 await expect(page.getByRole('heading',{name:'Sign in to Lowwin',exact:true})).toBeVisible();
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function navigate(page:Page,label:string){
 const trigger=page.getByRole('button',{name:'Open navigation',exact:true});
 if(await trigger.isVisible())await trigger.click();
 await page.getByRole('navigation',{name:'Business areas',exact:true}).getByRole('link',{name:label,exact:true}).click();
}
async function containedTable(page:Page,region:Locator){
 await expect(region).toBeVisible();
 await expect(region.locator('table')).toHaveCSS('display','table');
 await expect(region.locator('thead')).toBeVisible();
 const bounds=await region.evaluate(element=>{
  const rect=element.getBoundingClientRect(),css=getComputedStyle(element);
  return {left:rect.left,right:rect.right,width:innerWidth,border:parseFloat(css.borderLeftWidth),overflow:css.overflowX,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};
 });
 expect(bounds.left).toBeGreaterThanOrEqual(0);
 expect(bounds.right).toBeLessThanOrEqual(bounds.width+1);
 expect(bounds.border).toBeGreaterThanOrEqual(1);
 expect(['auto','scroll']).toContain(bounds.overflow);
 if((page.viewportSize()?.width??1440)<=700){
  expect(bounds.scrollWidth).toBeGreaterThan(bounds.clientWidth);
  await region.evaluate(element=>{element.scrollLeft=element.scrollWidth});
  expect(await region.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
  await region.evaluate(element=>{element.scrollLeft=0});
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
async function blockExternalServices(page:Page){
 await page.route(/^https:\/\/(?:api\.resend\.com|api\.telegram\.org|api\.chapa\.global)\//,route=>route.abort('blockedbyclient'));
}

test('Master Guide Admin uses a real verified admin session and compact responsive tables',async({page},info)=>{
 const db=fixtureDatabase(),admin=await credential(db,'admin',info.project.name),mobile=page.viewportSize()!;
 mkdirSync(screenshotRoot,{recursive:true});
 const errors:string[]=[],reads:string[]=[],authPosts:string[]=[],writes:string[]=[],captures:string[]=[];
 const timings:Record<string,number>={};
 const players=Array.from({length:30},(_,index)=>({id:randomUUID(),name:index===0?'Abebe Tesfaye':`Fixture player ${index+1}`,telegramId:String(880000+index),telegramUsername:index===0?'abebe_fixture':`fixture_${index+1}`,phone:`+251911${String(index).padStart(6,'0')}`,phoneUnavailable:false,createdAt:now,bidCount:index+2,winCount:index===0?1:0,suspended:false,available:'125.50',held:'0',referralCount:2,couponCount:1}));
 const payments=players.map((user,index)=>({id:randomUUID(),userId:user.id,provider:'Chapa',channel:'telebirr',purpose:'TOP_UP',mode:'test',status:index===0?'CREDITED':'PENDING',amount:String(125+index),createdAt:now,journalId:index===0?randomUUID():null,reason:null,review:false,reference:`fixture-${index}`,bidId:null,auctionId:null,user:{id:user.id,name:user.name,telegramUsername:user.telegramUsername,phone:user.phone,phoneUnavailable:false}}));
 const winners=players.map((winner,index)=>({auctionId:randomUUID(),publicCode:4000+index,code:String(4000+index),title:index===0?'Studio headphones':`Fixture prize ${index+1}`,completedAt:now,winner:{id:winner.id,name:winner.name,telegramUsername:winner.telegramUsername,phone:winner.phone,phoneUnavailable:false},state:'PENDING',version:1,tracking:null,assignedTo:null,deliveredAt:null}));
 const queue=(items:unknown[],url:URL)=>{const pageNumber=Math.max(1,Number(url.searchParams.get('page'))||1);return {items:items.slice((pageNumber-1)*25,pageNumber*25),total:items.length,page:pageNumber,totalPages:Math.max(1,Math.ceil(items.length/25)),serverNow:now,configured:true}};
 const capturePair=async(name:string,region?:Locator)=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(async()=>{await document.fonts.ready});
  if(region)await containedTable(page,region);
  const desktop=`${screenshotRoot}/${name}-1440-${info.project.name}.png`;
  await page.screenshot({path:desktop,fullPage:true,animations:'disabled'});captures.push(desktop);
  await page.setViewportSize(mobile);
  if(region)await containedTable(page,region);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const narrow=`${screenshotRoot}/${name}-${info.project.name}.png`;
  await page.screenshot({path:narrow,fullPage:true,animations:'disabled'});captures.push(narrow);
 };
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(request.method()==='GET'&&url.pathname.startsWith('/api/admin/'))reads.push(url.pathname+url.search);if(request.method()==='POST'&&url.pathname.startsWith('/api/auth/'))authPosts.push(url.pathname);if(request.method()!=='GET'&&/^\/api\/(?:admin\/(?:command|chapa)|payments|wallet|auctions)/.test(url.pathname))writes.push(url.pathname)});
 await blockExternalServices(page);
 await page.route('**/api/admin/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname,q=(url.searchParams.get('q')??'').toLowerCase();
  if(route.request().method()!=='GET')return route.abort('blockedbyclient');
  let body:unknown;
  if(path==='/api/admin/dashboard')body={serverNow:now,auctions:{state:'ready',live:0,items:[]},players:{state:'ready',total:30},payments:{state:'ready',count:2},deliveries:{state:'ready',count:30}};
  else if(path==='/api/admin/workspace/players')body=queue(players.filter(item=>!q||`${item.name} ${item.telegramUsername} ${item.phone}`.toLowerCase().includes(q)),url);
  else if(path==='/api/admin/workspace/transactions')body=queue(payments.filter(item=>!q||`${item.user.name} ${item.user.telegramUsername} ${item.user.phone}`.toLowerCase().includes(q)).sort((a,b)=>url.searchParams.get('sort')==='amount'?Number(b.amount)-Number(a.amount):0),url);
  else if(path==='/api/admin/workspace/winners')body=queue(winners.filter(item=>!q||`${item.winner.name} ${item.title} ${item.code}`.toLowerCase().includes(q)),url);
  else if(path.startsWith('/api/admin/users/'))body=players.find(item=>item.id===path.split('/').pop());
  else if(path.startsWith('/api/admin/chapa/')){const item=payments.find(row=>row.id===path.split('/').pop());if(item)body={item:{...item,playerName:item.user.name,amountCents:String(Number(item.amount)*100),currency:'ETB',updatedAt:now,credited:item.status==='CREDITED',bidAccepted:false,paymentMethod:'telebirr',canCheck:false,references:{merchant:item.reference,chapa:'CH-fixture-reference',processor:null}},health:{schemaReady:true,configured:true,recoveryEnabled:false,mode:'test',reason:null}}}
  else if(path==='/api/admin/notifications')body={items:[],total:0,page:1,totalPages:1};
  if(body===undefined)return route.continue();
  return route.fulfill({status:200,contentType:'application/json',headers:{'cache-control':'private, no-store'},body:JSON.stringify(body)});
 });
 try{
  const loginStarted=Date.now();await signIn(page,admin.email);
  await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();timings.credentialToOverviewMs=Date.now()-loginStarted;
  // APIRequestContext bypasses browser route fixtures: prove real server access.
  const authorized=await page.request.get('/api/admin/dashboard');expect(authorized.status()).toBe(200);expect(authorized.headers()['cache-control']).toContain('no-store');
  const grant=await db.staffSession.findFirstOrThrow({where:{session:{userId:admin.id}}});
  expect(grant.authMethod).toBe('email-password');expect(grant.mfaAt).toBeNull();
  expect(grant.expiresAt.getTime()-grant.credentialAt.getTime()).toBeLessThanOrEqual(8*3600000);
  await page.setViewportSize({width:1440,height:1000});
  const sidebar=page.getByRole('navigation',{name:'Business areas',exact:true});
  await expect(sidebar.getByRole('link')).toHaveText(['Overview','Auctions and Catalog','Players','Payments','Winners','Broadcast']);
  await expect(sidebar).not.toContainText(/Refund|Reconciliation|Content|Report|Settings|Team|Wallets/);
  await expect(page.locator('body')).not.toContainText(/authenticator|MFA verified|two.factor|bootstrap/i);
  await page.setViewportSize(mobile);await capturePair('overview');

  await navigate(page,'Players');await expect(page.getByRole('heading',{name:'Players',exact:true})).toBeVisible();
  const playerTable=page.getByRole('region',{name:'Players and wallets',exact:true});
  await expect(playerTable.locator('tbody tr')).toHaveCount(25);
  await expect(playerTable.getByRole('columnheader')).toHaveText(['Player','Phone','Available','Held','Bids / wins','Referrals','Status','Joined','Action']);
  await capturePair('players',playerTable);
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(playerTable.locator('tbody tr')).toHaveCount(5);await expect(page.getByRole('navigation',{name:'Results pages'})).toContainText('page 2 of 2');
  await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(playerTable.locator('tbody tr')).toHaveCount(25);
  await playerTable.locator('tbody tr').first().getByRole('button',{name:'Details',exact:true}).click();
  const playerDetail=page.getByRole('dialog',{name:'Player details',exact:true});await expect(playerDetail).toContainText('Abebe Tesfaye');await expect(playerDetail).toContainText(players[0].phone);
  await page.keyboard.press('Escape');await expect(playerDetail).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('Abebe');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(playerTable.locator('tbody tr')).toHaveCount(1);
  await expect(page).toHaveURL(/q=Abebe/);await page.getByRole('button',{name:'Clear',exact:true}).click();await expect(playerTable.locator('tbody tr')).toHaveCount(25);
  const playerReads=reads.filter(path=>path.startsWith('/api/admin/workspace/players')).length;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>reads.filter(path=>path.startsWith('/api/admin/workspace/players')).length).toBeGreaterThan(playerReads);

  await navigate(page,'Payments');await expect(page.getByRole('heading',{name:'Payments',exact:true})).toBeVisible();
  const paymentTable=page.getByRole('region',{name:'Chapa payments',exact:true});await expect(paymentTable.locator('tbody tr')).toHaveCount(25);
  await expect(paymentTable.locator('tbody tr').first()).toContainText('Abebe Tesfaye');await expect(paymentTable.locator('tbody tr').first()).toContainText('@abebe_fixture');await expect(paymentTable.locator('tbody tr').first()).toContainText(players[0].phone);await expect(paymentTable).not.toContainText(/Legacy transfer|Compensation|Reconciliation/);
  await capturePair('payments',paymentTable);
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(paymentTable.locator('tbody tr')).toHaveCount(5);await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(paymentTable.locator('tbody tr')).toHaveCount(25);
  await paymentTable.locator('tbody tr').first().getByRole('button',{name:'Details',exact:true}).click();
  const paymentDetail=page.getByRole('dialog',{name:'Payment details',exact:true});await expect(paymentDetail).toContainText('Abebe Tesfaye');await expect(paymentDetail.getByText('Credited',{exact:true}).first()).toBeVisible();await expect(paymentDetail.getByRole('button',{name:'Check with Chapa',exact:true})).toHaveCount(0);
  await paymentDetail.getByRole('button',{name:'Close details',exact:true}).click();await page.getByRole('combobox',{name:/^Sort/}).selectOption('amount');await expect(paymentTable.locator('tbody tr').first()).toContainText('Fixture player 30');
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('Abebe');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(paymentTable.locator('tbody tr')).toHaveCount(1);

  await navigate(page,'Winners');await expect(page.getByRole('heading',{name:'Winners',exact:true})).toBeVisible();
  const winnerTable=page.getByRole('region',{name:'Winners',exact:true});await expect(winnerTable.locator('tbody tr')).toHaveCount(25);await expect(winnerTable).toContainText('Studio headphones');await capturePair('winners',winnerTable);
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(winnerTable.locator('tbody tr')).toHaveCount(5);await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(winnerTable.locator('tbody tr')).toHaveCount(25);
  await winnerTable.locator('tbody tr').first().getByRole('button',{name:'Details',exact:true}).click();const winnerDetail=page.getByRole('dialog',{name:'Winner details',exact:true});await expect(winnerDetail).toContainText('Studio headphones');await expect(winnerDetail).toContainText('Abebe Tesfaye');await page.keyboard.press('Escape');
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('headphones');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(winnerTable.locator('tbody tr')).toHaveCount(1);

  await navigate(page,'Broadcast');await expect(page.getByRole('heading',{name:'Broadcast',exact:true})).toBeVisible();
  await expect(page.getByLabel('Image',{exact:false})).toHaveAttribute('type','file');await page.getByLabel('Message',{exact:true}).fill('Hello {name}, discover the next Lowwin auction.');await page.getByLabel('Button text',{exact:true}).fill('Open auctions');await page.getByRole('combobox',{name:/^Open page/}).selectOption('/auctions/all');
  const preview=page.getByRole('complementary',{name:'Broadcast preview',exact:true});await expect(preview).toContainText('Hello Abebe,');await expect(preview).toContainText('Open auctions');await expect(preview).toContainText('Telegram bot only.');
  await capturePair('broadcast');await page.getByRole('button',{name:'Review broadcast',exact:true}).click();await expect(page.getByRole('button',{name:'Send broadcast',exact:true})).toBeVisible();await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  expect(writes).toEqual([]);expect(authPosts.filter(path=>path.includes('/lowin/staff/'))).toEqual([]);expect(errors).toEqual([]);
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get('/api/admin/dashboard')).status()).toBe(401);expect(await db.session.count({where:{id:grant.sessionId}})).toBe(0);
  writeFileSync(`${screenshotRoot}/evidence-${info.project.name}.json`,JSON.stringify({measurement:'Optimized local app with real email-password authorization and explicit read-only table fixtures; not a production latency benchmark',timings,mobileViewport:mobile,desktopViewport:{width:1440,height:1000},realVerifiedAdminSession:true,mfaAt:null,sidebarSections:6,serverPaginationFixture:25,externalServicesInvoked:false,adminWrites:writes,errors,captures,reads,authPosts},null,2)+'\n');
 }finally{await db.$disconnect()}
});

test('verified members cannot sign in as admin and signup/reset forms stay simple',async({page},info)=>{
 const db=fixtureDatabase(),member=await credential(db,'member',info.project.name),authRequests:string[]=[];
 await blockExternalServices(page);
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&path.startsWith('/api/auth/'))authRequests.push(path)});
 try{
  await page.goto('/admin/login');await page.getByRole('button',{name:'Create an account',exact:true}).click();await expect(page.getByRole('heading',{name:'Create your account',exact:true})).toBeVisible();await expect(page.getByLabel('Name',{exact:true})).toBeVisible();await expect(page.getByLabel('Email',{exact:true})).toBeVisible();await expect(page.getByLabel('Password',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to sign in',exact:true}).click();await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await expect(page.getByRole('heading',{name:'Reset your password',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Send reset link',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to sign in',exact:true}).click();await page.getByRole('button',{name:'Verify your email',exact:true}).click();await expect(page.getByRole('heading',{name:'Check your email',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resend verification email',exact:true})).toBeVisible();
  await signIn(page,member.email);await expect(page.getByRole('alert')).toBeVisible();await expect(page).toHaveURL(/\/admin\/login$/);await expect(page.locator('body')).not.toContainText(/authenticator|2FA|MFA|bootstrap/i);
  expect((await page.request.get('/api/admin/dashboard')).status()).toBe(401);expect(await db.session.count({where:{userId:member.id}})).toBe(0);expect(await db.staffSession.count({where:{session:{userId:member.id}}})).toBe(0);expect(await db.staffMember.count({where:{userId:member.id}})).toBe(0);
  expect(authRequests).toEqual(['/api/auth/sign-in/email']);
 }finally{await db.$disconnect()}
});
