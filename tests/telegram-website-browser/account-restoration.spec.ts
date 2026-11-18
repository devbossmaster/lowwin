import {expect,test,type BrowserContext,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {makeSignature} from 'better-auth/crypto';
import {verifyFixtureContact} from '../contact-fixtures';

async function ownedSession(db:PrismaClient,name:string){
 const telegramId=randomInt(8900000000,9000000000);
 await verifyFixtureContact(db,telegramId);
 const player=await db.user.update({where:{telegramId:String(telegramId)},data:{name}});
 const token=randomUUID();
 await db.session.create({data:{id:randomUUID(),token,userId:player.id,telegramLaunchId:String(telegramId),telegramAuthSource:'TELEGRAM_OIDC',expiresAt:new Date(Date.now()+3600000)}});
 const value=encodeURIComponent(`${token}.${await makeSignature(token,process.env.BETTER_AUTH_SECRET!)}`);
 return {id:player.id,async install(context:BrowserContext,restore:boolean){
  await context.addCookies([
   {name:'__Secure-better-auth.session_token',value,domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'},
   ...(restore?[{name:'lowwin-browser-restore',value:'1',domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax' as const}]:[]),
  ]);
 }};
}

async function isolate(page:Page){
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.route('https://oauth.telegram.org/**',route=>route.abort());
 await page.context().addCookies([{name:'lowwin-language',value:'en',domain:'localhost',path:'/'}]);
 const accountReads:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/me')accountReads.push(request.method())});
 return accountReads;
}

const registered=(page:Page)=>page.locator('.app-frame[data-customer-registered=true]');

test('verified browser return and refresh reuse the account through navigation and cross-tab logout',async({page,context},info)=>{
 test.skip(info.project.name!=='360','One production bundle authentication exercise.');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const player=await ownedSession(db,'First Website Player'),reads=await isolate(page);
  await player.install(context,true);
  const response=await page.goto('/profile');
  expect(response?.headers()['cache-control']).toContain('no-store');
  await expect(registered(page)).toBeVisible();
  await expect(page.locator('[data-profile-ready]')).toBeVisible();
  expect(reads).toEqual([]);
  const duration=await page.evaluate(()=>performance.getEntriesByName('lowwin:auth:browser-restoration','measure').at(-1)?.duration);
  expect(duration).toBeGreaterThanOrEqual(0);
  await page.reload();
  await expect(registered(page)).toBeVisible();
  expect(reads).toEqual([]);
  await page.getByRole('navigation',{name:'Your navigation',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  await expect(page).toHaveURL(/\/$/);await expect(registered(page)).toBeVisible();
  expect(reads).toEqual([]);

  const observer=await context.newPage(),observerReads=await isolate(observer);
  await observer.goto('/');await expect(registered(observer)).toBeVisible();
  await expect(registered(page)).toBeVisible();
  const out=await context.newPage();await isolate(out);await out.goto('/profile');
  await out.getByRole('button',{name:'Log out',exact:true}).click();
  await expect(registered(out)).toHaveCount(0);
  await expect(registered(observer)).toHaveCount(0);
  await expect.poll(()=>observerReads.length).toBeGreaterThan(0);
  expect(await db.session.count({where:{userId:player.id}})).toBe(0);

  const other=await ownedSession(db,'Second Website Player');
  await other.install(context,true);
  await out.goto('/profile');await expect(registered(out)).toBeVisible();
  await expect(registered(observer)).toBeVisible();
  const me=await out.request.get('/api/me');
  expect(me.headers()['cache-control']).toContain('no-store');
  expect((await me.json()).user.id).toBe(other.id);
  await expect(out.getByText('First Website Player',{exact:true})).toHaveCount(0);
 }finally{await db.$disconnect()}
});

test('a slow unavailable browser session retries in place with one authoritative account read',async({page,context},info)=>{
 test.skip(info.project.name!=='360','One slow-network browser restoration path.');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
 const reads=await isolate(page);
 try{
  const player=await ownedSession(db,'Retry Website Player');await player.install(context,false);
  let served=0;
  await page.route('**/api/me',async route=>{
   if(++served!==1)return route.continue();
   await held;await route.fulfill({status:503,json:{error:'Isolated database interruption'}});
  });
  await page.goto('/profile');
  await expect(page.getByRole('status').filter({hasText:'Restoring your account'})).toHaveAttribute('aria-busy','true');
  await expect(registered(page)).toHaveCount(0);release();
  await expect(page.getByRole('alert').filter({hasText:'Your account could not load'})).toBeVisible();
  await page.getByRole('button',{name:'Retry connection'}).click();
  await expect(registered(page)).toBeVisible();
  expect(reads).toEqual(['GET','GET']);
  expect(await db.session.count({where:{userId:player.id}})).toBe(1);
 }finally{release();await db.$disconnect()}
});
