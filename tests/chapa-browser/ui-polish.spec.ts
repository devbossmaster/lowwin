import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,pending} from './fixtures';

test('live Home countdown stays running through initial query hydration and reopening',async({page})=>{
 const f=await fixture(page,false);
 try{
  await page.clock.install();
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  const card=page.locator('.auction-card').filter({hasText:f.title}),timer=card.getByRole('timer');
  await expect(card.locator('.status-live')).toBeVisible();await expect(timer).toBeVisible();
  await page.clock.runFor(2500);
  await expect(timer).not.toContainText('Auction ended');await expect(timer).toContainText(/\d+h.*\d+m/);
  await page.goto('/profile');await expect(page.locator('#main')).toBeVisible();
  await page.goto(f.home);await expect(timer).toBeVisible();await page.clock.runFor(2000);
  await expect(timer).not.toContainText('Auction ended');await expect(card.getByRole('button',{name:/Pay .* & bid/})).toBeEnabled();
 }finally{await f.db.$disconnect()}
});

test('payment launch goes directly to its modal with one owned read and automatic session timeout',async({page},info)=>{
 const id=randomUUID(),am=info.project.name==='430',f=await fixture(page,am,'chapa_'+id);
 let reads=0,checks=0,creates=0,complete=false;
 const order=pending({key:id,purpose:'TOP_UP',amount:'10.00'},id),returnRoutes:string[]=[];
 try{
  await page.clock.install();
  page.on('request',request=>{if(new URL(request.url()).pathname==='/payments/chapa/return')returnRoutes.push(request.url())});
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const request=route.request(),collection=new URL(request.url()).pathname.endsWith('/checkouts');
   if(collection){if(request.method()==='POST')creates++;return route.fulfill({json:{items:[order],page:1,nextPage:null}})}
   if(request.method()==='GET')reads++;else checks++;
   return route.fulfill({json:{...order,...(complete?{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'}:{})}});
  });
  const started=Date.now();await page.goto('/telegram');
  const sheet=page.getByRole('dialog');
  await expect(sheet.locator('[data-payment-state="confirming"]')).toBeVisible();
  const openedMs=Date.now()-started;
  expect(reads).toBe(1);expect(creates).toBe(0);expect(returnRoutes).toEqual([]);
  await page.clock.fastForward(300001);
  await expect(sheet.locator('[data-payment-state="session-ended"]')).toBeVisible();
  await expect(sheet.getByRole('button',{name:/Verify status|Check payment/i})).toHaveCount(0);
  complete=true;const before=checks;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(sheet.locator('[data-payment-state="confirmed"]')).toBeVisible();
  expect(checks-before).toBeLessThanOrEqual(1);expect(creates).toBe(0);
  mkdirSync('test-results/chapa-ui/polish',{recursive:true});
  writeFileSync(`test-results/chapa-ui/polish/return-${info.project.name}.json`,JSON.stringify({openedMs,ownedReads:reads,verificationCalls:checks,intermediateReturnRoutes:returnRoutes.length,checkoutCreations:creates},null,2));
  await page.screenshot({path:`test-results/chapa-ui/polish/return-${info.project.name}.png`,animations:'disabled'});
 }finally{await f.db.$disconnect()}
});

test('customer page layouts preserve the brand and fit mobile and desktop widths',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>route.fulfill({json:{items:[],page:1,nextPage:null}}));
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  mkdirSync('test-results/chapa-ui/polish',{recursive:true});
  for(const [name,path] of [['home',f.home],['auctions','/auctions/all'],['winners','/winners'],['bids','/my-bids'],['transactions','/payments'],['profile','/profile']] as const){
   await page.goto(path);await expect(page.locator('#main')).toBeVisible();
   await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
   await expect(page.locator('[data-route-skeleton]')).toHaveCount(0);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`test-results/chapa-ui/polish/${name}-${info.project.name}.png`,animations:'disabled'});
  }
  expect(errors).toEqual([]);
 }finally{await f.db.$disconnect()}
});

test('a missing launch payment can exit to Transactions without a redirect loop',async({page},info)=>{
 const f=await fixture(page,info.project.name==='430','chapa_'+randomUUID());
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>new URL(route.request().url()).pathname.endsWith('/checkouts')?route.fulfill({json:{items:[],page:1,nextPage:null}}):route.fulfill({status:404,json:{error:'Payment not found.'}}));
  await page.goto('/telegram');
  await expect(page.locator('.payment-resume-error')).toBeVisible();
  await page.getByRole('link',{name:info.project.name==='430'?'ግብይቶች':'View Transactions',exact:true}).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.locator('.payment-resume-error')).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
 }finally{await f.db.$disconnect()}
});
