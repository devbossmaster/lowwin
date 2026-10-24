import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

for(const entry of ['banner','guide'] as const){
 test(`${entry} Learn More keeps Home visible while its sheet loads`,async({page})=>{
  const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let held=0;
  try{
   const id=randomInt(8000000000,8900000000);await verifyFixtureContact(db,id);
   await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
   await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Sheet loading QA'})},process.env.TELEGRAM_BOT_TOKEN)});
   await page.goto('/telegram');await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
   if(entry==='guide'){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','am')}
   const section=page.locator(entry==='banner'?'section[aria-labelledby="home-headline"]':'#how-lowwin-works');
   const trigger=section.getByRole('button',{name:entry==='banner'?'Learn more':'ተጨማሪ ይወቁ',exact:true});
   await trigger.scrollIntoViewIfNeeded();
   // Hold the actual on-demand JS transport rather than testing a mock loader.
   await page.route('**/_next/static/chunks/**',async route=>{if(route.request().resourceType()==='script'){held++;await pending}await route.continue()});
   await trigger.click();await expect.poll(()=>held).toBeGreaterThan(0);
   // Cover React's delayed route fallback while the requested chunk stays held.
   await page.waitForTimeout(600);
   await expect(page.getByRole('dialog')).toHaveCount(0);
   await expect(trigger).toBeVisible();await expect(section).toBeVisible();
   await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
   await expect(page.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);
   release();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('ol>li')).toHaveCount(3);
   await expect(dialog.locator('iframe,video')).toHaveCount(0);
   await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
   await trigger.click();await expect(dialog).toBeVisible();await page.goBack();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{release();await db.$disconnect()}
 });
}
