import {test,expect,type Page,type TestInfo} from '@playwright/test';

const botUrl='https://t.me/lowin_fixture_bot?start=lowin';
const signInPath='**/api/auth/telegram/miniapp/signin';

async function fixture(page:Page,{native=true,throwPresentation=false}={}){
  const errors:string[]=[];
  const accountFallbacks:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://telegram.org/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/api/me',route=>{accountFallbacks.push(route.request().url());return route.fulfill({status:401,json:{error:'No account fallback expected'}})});
  if(native)await page.addInitScript(({throwPresentation})=>{
    const calls:string[]=[];
    (window as unknown as {telegramCalls:string[]}).telegramCalls=calls;
    const presentation=()=>{if(throwPresentation)throw new Error('Fixture SDK presentation unsupported')};
    window.Telegram={WebApp:{
      initData:'fixture-signed-launch',platform:'android',ready:presentation,
      setHeaderColor:presentation,setBackgroundColor:presentation,
      openTelegramLink(url:string){calls.push(`open:${url}`)},close(){calls.push('close')},
    }};
  },{throwPresentation});
  return {errors,accountFallbacks};
}

async function noProtectedContent(page:Page){
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Wallet',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/place bid/i})).toHaveCount(0);
}

async function capture(page:Page,info:TestInfo,name:string){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${name}-${info.project.name}.png`),fullPage:true});
}

for(const status of [401,403])test(`${status} requires reopening and dispatches open before close`,async({page},info)=>{
  const {errors,accountFallbacks}=await fixture(page);
  let attempts=0;
  await page.route(signInPath,route=>{attempts++;return route.fulfill({status,json:{error:'Rejected launch'}})});
  await page.goto('/telegram');
  await expect(page.getByRole('heading',{name:'Reopen Lowwin',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry connection'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reload app'})).toHaveCount(0);
  await noProtectedContent(page);
  await expect(page.getByRole('link',{name:'Reopen from the bot'})).toHaveAttribute('href',botUrl);
  await page.getByRole('link',{name:'Reopen from the bot'}).click();
  expect(await page.evaluate(()=>(window as unknown as {telegramCalls:string[]}).telegramCalls)).toEqual([`open:${botUrl}`,'close']);
  await expect(page.getByRole('status')).toContainText('If this screen stays open, close it');
  await expect(page).toHaveURL('http://localhost:3116/telegram');
  await capture(page,info,`rejected-${status}`);
  expect(attempts).toBe(1);expect(accountFallbacks).toEqual([]);expect(errors).toEqual([]);
});

for(const failure of ['503','network'] as const)test(`${failure} retries once on demand and reaches Home after success`,async({page},info)=>{
  const {errors,accountFallbacks}=await fixture(page);
  let attempts=0;
  await page.route(signInPath,route=>{
    attempts++;
    if(attempts===1)return failure==='network'?route.abort('failed'):route.fulfill({status:503,json:{error:'Temporary interruption'}});
    return route.fulfill({json:{status:'authenticated',me:{user:{id:'fixture',name:'Test player'},wallet:{available:'0',held:'0'}}}});
  });
  await page.route('http://localhost:3116/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><h1>Authenticated Home fixture</h1></body></html>'}));
  await page.goto('/telegram#fixture-launch-fragment');
  await expect(page.getByRole('button',{name:'Retry connection'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reload app'})).toBeVisible();
  await noProtectedContent(page);
  expect(attempts).toBe(1);
  await capture(page,info,`retry-${failure}`);
  await page.getByRole('button',{name:'Retry connection'}).click();
  await expect(page.getByRole('heading',{name:'Authenticated Home fixture'})).toBeVisible();
  await expect(page).toHaveURL('http://localhost:3116/#fixture-launch-fragment');
  expect(attempts).toBe(2);expect(accountFallbacks).toEqual([]);expect(errors).toEqual([]);
});

test('Reload app reloads the same query and launch hash before a rejected launch',async({page},info)=>{
  const {errors,accountFallbacks}=await fixture(page);
  let attempts=0;
  const launches:unknown[]=[];
  await page.route(signInPath,route=>{
    attempts++;launches.push(route.request().postDataJSON());
    return route.fulfill({status:attempts===1?503:401,json:{error:'Fixture failure'}});
  });
  const path='/telegram?recovery=fixture#tgWebAppData=fixture-launch&tgWebAppPlatform=android';
  await page.goto(path);
  await expect(page.getByRole('button',{name:'Retry connection'})).toBeVisible();
  await page.getByRole('button',{name:'Reload app'}).click();
  await expect(page.getByRole('heading',{name:'Reopen Lowwin',exact:true})).toBeVisible();
  await expect(page).toHaveURL(`http://localhost:3116${path}`);
  expect(await page.evaluate(()=>(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('reload');
  expect(launches).toEqual([{initData:'fixture-signed-launch'},{initData:'fixture-signed-launch'}]);
  await expect(page.getByRole('button',{name:'Reload app'})).toHaveCount(0);
  await noProtectedContent(page);await capture(page,info,'reload-rejected');
  expect(attempts).toBe(2);expect(accountFallbacks).toEqual([]);expect(errors).toEqual([]);
});

test('SDK ready and theme exceptions leave authentication and manual retry usable',async({page})=>{
  const {errors,accountFallbacks}=await fixture(page,{throwPresentation:true});
  let attempts=0;
  await page.route(signInPath,route=>{attempts++;return route.fulfill({status:attempts===1?503:403,json:{error:'Fixture failure'}})});
  await page.goto('/telegram');
  await expect(page.getByRole('button',{name:'Retry connection'})).toBeVisible();
  expect(attempts).toBe(1);
  await page.getByRole('button',{name:'Retry connection'}).click();
  await expect(page.getByRole('heading',{name:'Reopen Lowwin',exact:true})).toBeVisible();
  await noProtectedContent(page);
  expect(attempts).toBe(2);expect(accountFallbacks).toEqual([]);expect(errors).toEqual([]);
});

test('outside Telegram the configured bot link remains normal browser navigation',async({page},info)=>{
  const {errors,accountFallbacks}=await fixture(page,{native:false});
  let attempts=0;
  await page.route(signInPath,route=>{attempts++;return route.fulfill({status:401,json:{error:'Sign-in was not expected'}})});
  await page.route('https://t.me/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><h1>Bot navigation fixture</h1></body></html>'}));
  await page.goto('/telegram');
  await expect(page.getByRole('heading',{name:'Open Lowwin',exact:true})).toBeVisible();
  const link=page.getByRole('link',{name:'Continue with the bot'});
  await expect(link).toHaveAttribute('href',botUrl);
  await noProtectedContent(page);await capture(page,info,'outside-telegram');
  await link.click();
  await expect(page.getByRole('heading',{name:'Bot navigation fixture'})).toBeVisible();
  await expect(page).toHaveURL(botUrl);
  expect(attempts).toBe(0);expect(accountFallbacks).toEqual([]);expect(errors).toEqual([]);
});
