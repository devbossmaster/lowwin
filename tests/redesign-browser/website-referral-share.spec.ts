import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {makeSignature} from 'better-auth/crypto';
import {expect,test} from '../isolated-browser';
import {verifyFixtureContact} from '../contact-fixtures';
import {referralBrowserPolicy} from '../referral-browser-fixtures';

test('browser profile copies and shares the website link for the same invite',async({page,browser},info)=>{
 const database=new URL(process.env.TEST_DATABASE_URL??'');
 if(!['127.0.0.1','localhost'].includes(database.hostname)||!database.pathname.endsWith('_test'))throw Error('A disposable referral test database is required');
 const origin=new URL(info.project.use.baseURL!);
 const db=new PrismaClient({datasourceUrl:database.href});
 try{
  await referralBrowserPolicy(db);
  const telegramId=randomInt(8_000_000_000,8_900_000_000);
  await verifyFixtureContact(db,telegramId);
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
  const token=randomBytes(32).toString('hex');
  await db.session.create({data:{id:randomUUID(),token,userId:user.id,expiresAt:new Date(Date.now()+3600_000),telegramLaunchId:String(telegramId),telegramAuthSource:'TELEGRAM_OIDC'}});
  const secure=origin.protocol==='https:';
  await page.context().addCookies([{name:`${secure?'__Secure-':''}better-auth.session_token`,value:encodeURIComponent(token+'.'+await makeSignature(token,process.env.BETTER_AUTH_SECRET!)),domain:origin.hostname,path:'/',secure,httpOnly:true,sameSite:'Lax'}]);
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(()=>{
   localStorage.setItem('lowwin-language','en');
   const copied:string[]=[],shared:string[]=[];
   Reflect.set(window,'fixtureReferralActions',{copied,shared});
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{copied.push(value)}}});
   Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{shared.push(data.url??'')}});
  });
  await page.goto('/profile');
  const referral=page.locator('[data-referral-channel=website]');
  await expect(referral).toBeVisible();
  const {referral:links}=await (await page.request.get('/api/profile')).json();
  const website=new URL(links.webShareUrl),bot=new URL(links.shareUrl);
  const code=website.searchParams.get('ref');
  expect(website.origin).toBe(origin.origin);
  expect(website.pathname).toBe('/');
  expect(code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(bot.searchParams.get('start')).toBe(`ref_${code}`);
  await expect(referral.getByRole('textbox',{name:'Your referral link'})).toHaveValue(website.href);
  await referral.getByRole('button',{name:'Copy referral link'}).click();
  await referral.getByRole('button',{name:'Share my link'}).click();
  expect(await page.evaluate(()=>Reflect.get(window,'fixtureReferralActions'))).toEqual({copied:[website.href],shared:[website.href]});

  const guest=await browser.newContext({baseURL:origin.origin,ignoreHTTPSErrors:true});
  try{
   const landing=await guest.request.get(website.href);
   expect(landing.ok()).toBe(true);
   expect(landing.headers()['cache-control']).toContain('no-store');
   const capture=(await guest.cookies()).find(cookie=>cookie.name==='lowwin-website-referral');
   expect(capture).toMatchObject({httpOnly:true,sameSite:'Lax',secure});
   expect(capture?.value.split('.')[0]).toBe(code);
  }finally{await guest.close()}
 }finally{await db.$disconnect()}
});
