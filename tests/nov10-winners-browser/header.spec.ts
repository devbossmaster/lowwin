import {expect,test,type Page} from '@playwright/test';
import {signedLaunch} from '../helpers';
import {mkdirSync} from 'node:fs';

const header=(page:Page)=>page.getByRole('banner',{name:'Mini App header'});
async function setup(page:Page,{registered=false,hold=false,am=false,available='123456789.50'}:{registered?:boolean;hold?:boolean;am?:boolean;available?:string}={}){
 await page.context().addCookies([{name:'lowwin-language',value:am?'am':'en',domain:'localhost',path:'/'}]);
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.addInitScript(({launch})=>{
  localStorage.setItem('lowwin:introduction:v1','dismissed');
  window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};
 },{launch:signedLaunch({user:JSON.stringify({id:788000001,first_name:'Header browser fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),walletRequests:string[]=[],alertRequests:string[]=[];
 const account={user:{id:'scoped-header-browser',name:'Header browser fixture'},sessionKey:'fixture-only'};
 await page.route('**/api/auth/telegram/miniapp/signin',async route=>{if(hold)await gate;await route.fulfill({json:registered?{status:'authenticated',me:account}:{status:'contact-required',me:null}})});
 await page.route('**/api/me',route=>route.fulfill({status:registered?200:401,json:registered?account:{}}));
 await page.route('**/api/alerts?*',route=>{alertRequests.push(route.request().url());return route.fulfill({json:new URL(route.request().url()).searchParams.has('summary')?{unread:3}:{items:[],total:0,totalPages:0,unread:3,categories:['all','draws','payments']}})});
 await page.route('**/api/wallet',route=>{walletRequests.push(route.request().url());return route.fulfill({json:{available,held:'0',currency:'ETB',topUp:{enabled:false,reason:'NOT_CONFIGURED'}}})});
 await page.route('**/api/payments/chapa',route=>route.fulfill({json:{enabled:false,configured:false,mode:'test',walletBidsEnabled:false,minTopup:'1.00',maxTopup:'43200.00',reason:'DISABLED'}}));
 await page.route('**/api/payments/chapa/methods*',route=>route.fulfill({json:{methods:[],paymentPhone:null}}));
 await page.route('**/api/payments/chapa/checkouts*',route=>route.fulfill({json:{items:[],total:0,page:1,totalPages:0}}));
 await page.route('**/api/wallet/history?*',route=>route.fulfill({json:{items:[],page:1,pageSize:20,hasNext:false}}));
 await page.route('**/api/profile',route=>route.fulfill({status:503,json:{error:'Header fixture only'}}));
 await page.route('**/api/catalog/auctions?*',route=>{
  const query=new URL(route.request().url()).searchParams;
  return route.fulfill({json:query.get('view')==='summary'?{totalLive:0,totalUpcoming:0}:{items:[],page:1,pageSize:20,total:0,totalPages:0,totalLive:0,totalUpcoming:0,serverNow:new Date().toISOString()}});
 });
 return {release,walletRequests,alertRequests};
}

async function compactGeometry(page:Page){
 const controls=await header(page).locator('a,button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height}}));
 const width=page.viewportSize()!.width;
 for(const box of controls){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width+.5);expect(box.width).toBeGreaterThanOrEqual(43.5);expect(box.height).toBeGreaterThanOrEqual(43.5)}
 for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
  const a=controls[i],b=controls[j],area=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));expect(area).toBeLessThan(1);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const amount=header(page).locator('[data-header-balance]>span').first();
 if(await amount.count())expect(await amount.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 mkdirSync('test-results/nov10-winners/screenshots',{recursive:true});
 const state=await header(page).getByLabel(/Loading balance|ሂሳብ በመጫን ላይ/).count()?'loading':await header(page).locator('[data-header-balance]').count()?'registered':'guest';
 await header(page).screenshot({path:`test-results/nov10-winners/screenshots/header-${width}-${await page.locator('html').getAttribute('lang')}-${state}.png`});
}

for(const width of [320,360,430]){
 test(`Home guest controls, contact sheet and Hammer at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:850});const f=await setup(page);await page.goto('/');
  await expect(header(page).getByRole('button',{name:'Log in',exact:true})).toBeVisible();
  await expect(header(page).locator('[data-header-balance]')).toHaveCount(0);expect(f.walletRequests).toHaveLength(0);
  await expect(header(page).getByRole('button',{name:'Notifications',exact:true})).toBeVisible();expect(f.alertRequests).toHaveLength(0);
  await expect(header(page).getByRole('link',{name:/Wallet|Deposit|Profile|Play|Notifications/})).toHaveCount(0);
  await expect(header(page).locator('[data-lowwin-logo]')).toBeVisible();await compactGeometry(page);
  await header(page).getByRole('button',{name:/Browse auctions/}).click();await expect(page.getByRole('dialog',{name:'Auctions',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Auctions',exact:true})).toHaveCount(0);
  await header(page).getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('dialog',{name:'Log in to Lowwin',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share contact',exact:true})).toBeVisible();expect(f.walletRequests).toHaveLength(0);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 });
 for(const am of [false,true])test(`Registered Home balance, language, top-up and Home-only header at ${width}px ${am?'AM':'EN'}`,async({page})=>{
  await page.setViewportSize({width,height:850});const f=await setup(page,{registered:true,am});await page.goto('/');
  await expect(header(page).getByRole('link',{name:am?'ዋሌት, 123456789.50 ETB':'Wallet, 123456789.50 ETB',exact:true})).toBeVisible();
  await expect(header(page).getByRole('button',{name:/Log in|ይግቡ/})).toHaveCount(0);expect(f.walletRequests).toHaveLength(1);
  const bell=header(page).getByRole('button',{name:am?'ማሳወቂያዎች, 3 ያልተነበቡ':'Notifications, 3 unread',exact:true});await expect(bell).toBeVisible();await bell.click();await expect(page.getByRole('dialog',{name:am?'ማሳወቂያዎች':'Notifications',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(bell).toBeFocused();
  await expect(header(page).getByRole('link',{name:/Profile|Play|Notifications/})).toHaveCount(0);await compactGeometry(page);
  const language=header(page).getByRole('button',{name:am?'ቋንቋ: አማርኛ':'Language: English',exact:true});
  await language.click();await page.getByRole('menuitemradio',{name:am?'English':'አማርኛ',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang',am?'en':'am');
  await header(page).getByRole('button',{name:am?'Language: English':'ቋንቋ: አማርኛ',exact:true}).click();await page.getByRole('menuitemradio',{name:am?'አማርኛ':'English',exact:true}).click();
  const deposit=header(page).getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true});await deposit.click();
  const topUp=page.getByRole('dialog',{name:am?'ገንዘብ ያስገቡ':'Top up wallet',exact:true});await expect(topUp).toBeVisible();
  await expect(topUp.locator('[data-payment-action]')).toBeDisabled();await page.keyboard.press('Escape');await expect(topUp).toHaveCount(0);await expect(deposit).toBeFocused();
  const wallet=header(page).getByRole('link',{name:am?'ዋሌት, 123456789.50 ETB':'Wallet, 123456789.50 ETB',exact:true});await wallet.click();await expect(page.getByRole('dialog',{name:am?'ዋሌት':'Wallet',exact:true})).toBeVisible();await expect(page.locator('[data-wallet-overview-balance]')).toContainText('123456789.50');await page.keyboard.press('Escape');await expect(wallet).toBeFocused();await page.goto('/profile');await expect(header(page)).toHaveCount(0);
 });
}

test('account restoration never flashes a guest Log in button or private balance',async({page})=>{
 const f=await setup(page,{registered:true,hold:true});await page.goto('/',{waitUntil:'domcontentloaded'});
 try{
  await expect(page.getByRole('status',{name:'Restoring account',exact:true})).toBeVisible();
  await expect(header(page).getByRole('button',{name:'Log in',exact:true})).toHaveCount(0);expect(f.walletRequests).toHaveLength(0);
 }finally{f.release()}
 await expect(header(page).getByRole('link',{name:'Wallet, 123456789.50 ETB',exact:true})).toBeVisible();
});

test('confirmed registration waits for the real balance without inventing zero',async({page})=>{
 await setup(page,{registered:true});let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/wallet',async route=>{await gate;await route.fulfill({json:{available:'25.75',held:'0',currency:'ETB',topUp:{enabled:false,reason:'NOT_CONFIGURED'}}})});
 try{await page.goto('/');const wallet=header(page).getByRole('link',{name:'Wallet',exact:true});await expect(wallet).toHaveAttribute('aria-busy','true');await expect(wallet.getByLabel('Loading balance')).toBeVisible();await expect(wallet).not.toContainText('0.00');await expect(header(page).getByRole('button',{name:'Log in',exact:true})).toHaveCount(0);for(const width of [320,360,430]){await page.setViewportSize({width,height:850});await compactGeometry(page)}}finally{release()}
 await expect(header(page).getByRole('link',{name:'Wallet, 25.75 ETB',exact:true})).toBeVisible();
});

test('signed-out Amharic header keeps the same compact layout and contact entry',async({page})=>{
 const f=await setup(page,{am:true});await page.goto('/');
 for(const width of [320,360,430]){await page.setViewportSize({width,height:850});await expect(header(page).getByRole('button',{name:'ይግቡ',exact:true})).toBeVisible();await compactGeometry(page)}
 const login=header(page).getByRole('button',{name:'ይግቡ',exact:true});await login.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(login).toBeFocused();expect(f.walletRequests).toHaveLength(0);
});
