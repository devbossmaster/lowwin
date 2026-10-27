import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {richFinalResult} from '../result-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';

test('result previews open immediately and keep content during slow pagination',async({page},info)=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const gate=()=>{let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});return {pending,release}};
 const scripts=gate(),initial=gate(),sorting=gate(),participants=gate(),paging=gate();
 let scriptRequests=0,initialRequests=0,sortRequests=0,participantRequests=0,pageRequests=0,failNext=false;
 try{
  const fixture=await richFinalResult(db),id=randomInt(8000000000,8900000000),am=info.project.name==='430';
  await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Result loading QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram');await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  if(am){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
  const winner=page.locator('#recent-winners').getByRole('button',{name:`${am?'ውጤት':'Result'}: ${am?'የሙከራ ዕቃ · የተጠናቀቀ ጨረታ':fixture.title}`,exact:true}).filter({has:page.locator(`time[datetime="${fixture.settlement.completedAt!.toISOString()}"]`)});await winner.scrollIntoViewIfNeeded();
  await page.route('**/_next/static/chunks/**',async route=>{if(route.request().resourceType()==='script'){scriptRequests++;await scripts.pending}await route.continue()});
  await page.route(`**/api/results/${fixture.code}/breakdown?*`,async route=>{
   const params=new URL(route.request().url()).searchParams;
   if(failNext){failNext=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Result unavailable. Please retry.'})});return}
   if(params.has('amount')){if(params.get('page')==='2'){pageRequests++;await paging.pending}else{participantRequests++;await participants.pending}}
   else if(params.get('sort')==='picked'){sortRequests++;await sorting.pending}
   else{initialRequests++;await initial.pending}
   await route.continue();
  });
  await winner.click();const result=page.getByRole('dialog',{name:am?'የመጨረሻ ውጤት':'Final result',exact:true});await expect(result).toBeVisible();await expect(result.locator('img')).toBeVisible();await expect(result).toContainText(am?'የሙከራ ዕቃ · የተጠናቀቀ ጨረታ':fixture.title);expect(participantRequests).toBe(0);await result.locator('[data-result-breakdown]').scrollIntoViewIfNeeded();await expect.poll(()=>scriptRequests).toBeGreaterThan(0);await page.waitForTimeout(600);
  await expect(result).toBeVisible();await expect(page.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);
  scripts.release();await expect.poll(()=>initialRequests).toBeGreaterThan(0);await page.waitForTimeout(600);
  await expect(result).toBeVisible();await expect(page.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);await page.screenshot({path:info.outputPath('waiting.png')});
  initial.release();await expect(result.locator('[data-result-amount]')).toHaveCount(20);await result.evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})))});await page.screenshot({path:info.outputPath('ready.png')});
  const oldAmounts=await result.locator('[data-result-amount]').allTextContents();await result.getByRole('button',{name:am?'በብዛት የተመረጡ':'Most picked',exact:true}).click();await expect.poll(()=>sortRequests).toBeGreaterThan(0);
  await expect(result).toBeVisible();expect(await result.locator('[data-result-amount]').allTextContents()).toEqual(oldAmounts);await expect(result.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);await expect(result.locator('[data-result-amount]').first()).toBeDisabled();sorting.release();
  const amount=result.locator('[data-result-amount="50"]');await expect(amount).toBeEnabled();await amount.click();await expect.poll(()=>participantRequests).toBeGreaterThan(0);await page.waitForTimeout(600);
  await expect(page.getByRole('dialog')).toHaveCount(2);await expect(result).toBeVisible();await expect(page.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);participants.release();
  const people=page.getByRole('dialog',{name:am?'የጨረታ ዝርዝር':'Bid details',exact:true});await expect(people.locator('li')).toHaveCount(20);
  await people.getByRole('button',{name:am?'ቀጣይ':'Next',exact:true}).click();await expect.poll(()=>pageRequests).toBeGreaterThan(0);await expect(people).toBeVisible();await expect(people.locator('li')).toHaveCount(20);await expect(people.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);paging.release();await expect(people.locator('li')).toHaveCount(1);
  expect(await people.textContent()).not.toContain(fixture.phone);await page.keyboard.press('Escape');await expect(people).toHaveCount(0);await expect(amount).toBeFocused();await page.goBack();await expect(result).toHaveCount(0);await expect(winner).toBeFocused();
  // The selected sort and participant page survive a close/reopen within this session.
  const resultReads=initialRequests+sortRequests,peopleReads=participantRequests+pageRequests;await winner.click();await result.locator('[data-result-breakdown]').scrollIntoViewIfNeeded();await expect(result.getByRole('button',{name:am?'በብዛት የተመረጡ':'Most picked',exact:true})).toHaveAttribute('aria-pressed','true');await result.locator('[data-result-amount="50"]').click();await expect(people.locator('li')).toHaveCount(1);expect(initialRequests+sortRequests).toBe(resultReads);expect(participantRequests+pageRequests).toBe(peopleReads);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  // A failed initial request gets a small recoverable sheet, never the full-page loader.
  failNext=true;await page.reload();await winner.click();await result.locator('[data-result-breakdown]').scrollIntoViewIfNeeded();await expect(result.getByRole('alert')).toBeVisible();await expect(result.locator('.loading-spinner-ring,.customer-loading')).toHaveCount(0);expect((await result.boundingBox())!.height).toBeLessThanOrEqual(info.project.use.viewport!.height);
  await result.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Retry',exact:true}).click();await expect(result.locator('[data-result-amount]')).toHaveCount(20);await page.keyboard.press('Escape');await expect(result).toHaveCount(0);await expect(winner).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{for(const value of [scripts,initial,sorting,participants,paging])value.release();await db.$disconnect()}
});
