import {randomInt} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {expect,test} from '../isolated-browser';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {referralBrowserPolicy} from '../referral-browser-fixtures';

test('Telegram referral opens the native photo card and falls back to the same bot link',async({page})=>{
 const database=new URL(process.env.TEST_DATABASE_URL??'');
 if(!['127.0.0.1','localhost'].includes(database.hostname)||!database.pathname.endsWith('_test'))throw Error('A disposable referral test database is required');
 const db=new PrismaClient({datasourceUrl:database.href});
 try{
  await referralBrowserPolicy(db);
  const telegramId=randomInt(8_000_000_000,8_900_000_000);
  await verifyFixtureContact(db,telegramId);
  await page.setExtraHTTPHeaders({'x-forwarded-for':`198.18.${Math.floor(telegramId%65536/256)}.${telegramId%256}`});
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(launch=>{
   localStorage.setItem('lowwin-language','en');
   localStorage.setItem('lowwin:introduction:v1','dismissed');
   const native:string[]=[],fallback:string[]=[];
   Reflect.set(window,'referralShareCalls',{native,fallback});
   window.Telegram={WebApp:{
    initData:launch,platform:'android',version:'8.0',ready(){},expand(){},isVersionAtLeast(){return true},
    shareMessage(id){native.push(id)},openTelegramLink(url){fallback.push(url)},
   }};
  },signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Referral QA'})},process.env.TELEGRAM_BOT_TOKEN));
  let prepareFails=false;
  const preparations:unknown[]=[];
  await page.route('**/api/referrals/telegram-share',route=>{
   expect(route.request().method()).toBe('POST');
   preparations.push(route.request().postDataJSON());
   return prepareFails?route.fulfill({status:503,json:{error:'Fixture temporary failure'}}):route.fulfill({json:{id:'fixture-prepared-photo'}});
  });
  await page.goto('/telegram?next='+encodeURIComponent('/affiliate'));
  await expect(page).toHaveURL(/\/affiliate$/);
  const referral=page.locator('[data-affiliate-page] [data-referral-channel=telegram]');
  await expect(referral.getByRole('heading',{name:'Invite & earn',exact:true})).toBeVisible();
  const referralResponse=await page.request.get('/api/referrals');
  expect(referralResponse.ok()).toBe(true);
  const links=await referralResponse.json();
  expect(links).toMatchObject({configured:true,enabled:true});
  expect(links.rewardEtb).toBeTruthy();
  await expect(referral.getByRole('textbox',{name:'Your referral link'})).toHaveValue(links.shareUrl);
  const share=referral.getByRole('button',{name:'Share in Telegram'});
  await share.click();
  const calls=()=>page.evaluate(()=>Reflect.get(window,'referralShareCalls') as {native:string[];fallback:string[]});
  await expect.poll(async()=>(await calls()).native).toEqual(['fixture-prepared-photo']);
  expect((await calls()).fallback).toEqual([]);

  prepareFails=true;
  await share.click();
  await expect.poll(async()=>(await calls()).fallback.length).toBe(1);
  const fallback=new URL((await calls()).fallback[0]);
  expect(fallback.origin+fallback.pathname).toBe('https://t.me/share/url');
  expect(fallback.searchParams.get('url')).toBe(links.shareUrl);
  expect(preparations).toEqual([{language:'en'},{language:'en'}]);
 }finally{await db.$disconnect()}
});
