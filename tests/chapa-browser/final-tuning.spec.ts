import {test,expect,type Locator,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,pending} from './fixtures';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';

async function modalGeometry(dialog:Locator){
 return dialog.evaluate(node=>{
  const body=node.querySelector('[data-sheet-body]') as HTMLElement,box=node.getBoundingClientRect(),footer=node.querySelector('[data-sheet-footer]')?.getBoundingClientRect();
  return {height:box.height,top:box.top,bottom:box.bottom,viewport:innerHeight,bodyHeight:body?.clientHeight??0,bodyScrollHeight:body?.scrollHeight??0,bodyScrollTop:body?.scrollTop??0,footerTop:footer?.top??null,footerBottom:footer?.bottom??null};
 });
}
async function expectCompactFit(dialog:Locator){
 await expect.poll(async()=>{const g=await modalGeometry(dialog);return g.bodyHeight>0&&g.height<=g.viewport+1}).toBe(true);
 const geometry=await modalGeometry(dialog);expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport+1);expect(geometry.footerBottom).not.toBeNull();expect(geometry.footerBottom!).toBeLessThanOrEqual(geometry.viewport+1);
 return geometry;
}
function quoteFixture(auctionSlug:string,numbers:string[],discount=false){
 const totalCents=numbers.length*1000-(discount?100:0);
 return {id:randomUUID(),quoteHash:'a'.repeat(64),auctionSlug,feeVersion:1,ruleVersion:'lowest-unique-v4',entryCount:numbers.length,lines:numbers.map((number,position)=>({position,number,grossFee:'10.00',discount:discount&&position===0?'1.00':'0.00',netFee:discount&&position===0?'9.00':'10.00'})),total:(totalCents/100).toFixed(2),totalCents:String(totalCents),grossTotal:(numbers.length*10).toFixed(2),discountTotal:discount?'1.00':'0.00',status:'QUOTED'};
}
async function compactEntryScenario(page:Page,name:string){
 const f=await fixture(page,false),marker=randomUUID(),errors:string[]=[],writes:string[]=[];let release=()=>{},quoteReads=0;
 const gate=new Promise<void>(resolve=>release=resolve),description='An administrator supplied this product description.\n'+Array.from({length:30},(_,index)=>`Detail ${index+1}: capacity, materials and useful product information remain readable when expanded.`).join('\n');
 const ownBids=['1.01','1.02','1.03','2.01','2.03'].map(amount=>({id:randomUUID(),amount,acceptedAt:new Date().toISOString()})),couponIds=Array.from({length:3},()=>randomUUID()),quoted:string[][]=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&/\/api\/payments\/chapa\/(?:checkouts|batches\/[^/]+\/wallet)/.test(new URL(request.url()).pathname))writes.push(request.url())});
 try{
  await f.db.product.update({where:{id:f.auction.productId!},data:{description}});
  await page.route('**/api/auctions/*/bids',async route=>{if(route.request().method()!=='GET')return route.abort();await gate;const response=await route.fetch(),body=await response.json();return route.fulfill({response,json:{...body,ownBids,remainingSubmissions:95,referralDiscountsAvailable:true,couponAvailableCount:3}})});
  await page.route('**/api/auctions/*/discount-quote?**',route=>{quoteReads++;const coupons=couponIds.map(id=>({id,percent:10,expiresAt:new Date(Date.now()+3600000).toISOString()}));return route.fulfill({json:{serverNow:new Date().toISOString(),auctionSlug:f.auction.slug,feeVersion:1,ruleVersion:'lowest-unique-v4',grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',coupon:coupons[0],eligible:true,availableCoupons:coupons}})});
  await page.route('**/api/payments/chapa/batches/quote',route=>{const body=route.request().postDataJSON() as {numbers:string[];couponId?:string};quoted.push(body.numbers);return route.fulfill({json:quoteFixture(f.auction.slug!,body.numbers,!!body.couponId)})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await page.locator('.auction-card').filter({hasText:f.title}).getByRole('button').click();
  const dialog=page.getByRole('dialog',{name:'Place your bid',exact:true}),input=dialog.getByRole('textbox',{name:'Your bid amount',exact:true});await expect(dialog).toBeVisible();await expect(input).toBeVisible();await expect(dialog).not.toContainText('Loading entry details');
  await dialog.evaluate((node,value)=>node.setAttribute('data-stable-modal',value),marker);await expect(dialog.locator(':scope>header').getByText('Live',{exact:true})).toBeVisible();await expect(dialog.getByRole('radio')).toHaveCount(2);
  await input.fill('4.25');await dialog.getByRole('radio',{name:'Online payment',exact:true}).check();await expect(dialog.locator('[data-payment-action]')).toBeDisabled();release();await expect(dialog.locator('[data-payment-action]')).toBeEnabled();await expect(dialog).toHaveAttribute('data-stable-modal',marker);await expect(page.getByRole('dialog')).toHaveCount(1);const readyGeometry=await expectCompactFit(dialog);
  await expect(dialog.locator('[data-bid-balance]')).toContainText('25.00');await expect(dialog.locator('[data-bid-remaining]')).toContainText('95');const coupon=dialog.locator('[data-bid-coupons]');await expect(coupon).toContainText('3');expect(quoteReads).toBe(0);
  await input.fill('1.04');await expect(dialog.getByRole('alert')).toHaveText('Only 3 consecutive amounts. Skip at least one step.');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await input.fill('1.02');await expect(dialog.getByRole('alert')).toHaveText('This amount is already selected or submitted.');
  await input.fill('4.25');await coupon.getByRole('button',{name:'Apply',exact:true}).click();await expect(dialog).toContainText('10% discount on one entry');expect(quoteReads).toBe(1);
  await dialog.getByRole('button',{name:'Add bid amount',exact:true}).click();await input.fill('4.27');await dialog.getByRole('button',{name:'Add bid amount',exact:true}).click();await input.fill('4.29');await dialog.locator('[data-payment-action]').click();
  const review=page.getByRole('dialog',{name:'Review bids',exact:true});await expect(review.locator('[data-bid-review]')).toBeVisible();expect(quoted).toEqual([['4.25','4.27','4.29']]);await expect(review).toContainText('ETB 29.00');await expect(review.locator('li').filter({hasText:'Coupon applied'})).toHaveCount(1);await expect(review).toHaveAttribute('data-stable-modal',marker);expect(writes).toEqual([]);
  await review.getByRole('button',{name:'Edit bid amounts',exact:true}).click();await expect(dialog.getByRole('button',{name:'Edit 4.25',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Remove 4.27',exact:true}).click();await dialog.getByRole('button',{name:'Edit 4.25',exact:true}).click();await input.fill('4.26');await dialog.getByRole('button',{name:'Save bid amount',exact:true}).click();await expect(dialog.getByRole('button',{name:'Edit 4.26',exact:true})).toBeVisible();await expect(dialog.locator('[data-bid-remaining]')).toContainText('93');await coupon.getByRole('button',{name:'Remove',exact:true}).click();
  await input.fill('4.50');const payment=dialog.getByRole('group',{name:'Select payment method'}),topUp=payment.getByRole('link',{name:'Top up wallet',exact:true});await expect(topUp).toHaveCount(1);expect(await topUp.evaluate(node=>node.closest('label')===null)).toBe(true);const plusBox=await topUp.boundingBox();expect(plusBox!.width).toBeGreaterThanOrEqual(44);expect(plusBox!.height).toBeGreaterThanOrEqual(44);await topUp.click();await expect(page.getByRole('dialog',{name:'Top up wallet',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(input).toHaveValue('4.50');await expect(dialog.getByRole('radio',{name:'Online payment',exact:true})).toBeChecked();
  const product=dialog.getByRole('region',{name:'Product description'});await product.getByRole('button',{name:'Show more',exact:true}).click();await expect(product).toContainText(description);await product.getByRole('button',{name:'Show less',exact:true}).click();
  await input.fill('10');await input.pressSequentially('.75',{delay:5});await expect(input).toHaveValue('10.75');await input.pressSequentially('9e-');await expect(input).toHaveValue('10.75');await input.fill('11.999');await expect(input).toHaveValue('10.75');await input.fill('');await input.pressSequentially('12.');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await input.pressSequentially('50');await expect(input).toHaveValue('12.50');await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  const viewport=page.viewportSize()!;await input.focus();await page.setViewportSize({...viewport,height:Math.min(430,viewport.height-180)});await expect(dialog).toHaveAttribute('data-keyboard-open','true');await expect(input).toBeInViewport({ratio:1});await expect(dialog.locator('[data-payment-action]')).toBeInViewport({ratio:1});await page.setViewportSize(viewport);await input.blur();await expectCompactFit(dialog);
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/bid-${name}.png`,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);expect(writes).toEqual([]);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
  writeFileSync(`test-results/chapa-ui/final-tuning/bid-${name}.json`,JSON.stringify({viewport,readyGeometry,oneStableModal:true,boundedScroll:true,threeNumbersOneReview:true,uncommittedInputIncluded:true,separateTopUpPreservesSelection:true,couponDiscountsOneEntry:true,paymentWrites:0,errors},null,2));
 }finally{release();await f.db.$disconnect()}
}

test('compact bid entry is one stable modal with gated data, independent wallet plus and accessible expansion',async({page},info)=>{
 await compactEntryScenario(page,info.project.name);
});

test('short360x640 batch entry scrolls within its bounds and keeps keyboard access',async({page},info)=>{
 test.skip(info.project.name!=='360','The existing360project owns the additional short-phone viewport.');await page.setViewportSize({width:360,height:640});await compactEntryScenario(page,'360-short');
});

test('wallet batch submission shows a spinner and sends one disabled action until the response',async({page},info)=>{
 const f=await fixture(page,false);let release=()=>{},posts=0;const gate=new Promise<void>(resolve=>release=resolve),quote=quoteFixture(f.auction.slug!,['7.25']);
 try{
  await page.route('**/api/payments/chapa/batches/quote',route=>route.fulfill({json:quote}));
  await page.route(`**/api/payments/chapa/batches/${quote.id}/wallet`,async route=>{posts++;await gate;return route.fulfill({json:{batch:{...quote,status:'ACCEPTED'},receipts:[{bid:{id:randomUUID(),auctionCode:f.auction.code,auctionSlug:f.auction.slug,amount:'7.25',acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:'10',newlyUnavailable:'10'},wallet:{available:'15',held:'0'},remainingSubmissions:99,ownBids:[]}]}})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await page.locator('.auction-card').filter({hasText:f.title}).getByRole('button').click();const entry=page.getByRole('dialog',{name:'Place your bid',exact:true});await entry.getByRole('textbox',{name:'Your bid amount',exact:true}).fill('7.25');await expect(entry.locator('[data-payment-action]')).toBeEnabled();await entry.locator('[data-payment-action]').click();
  const review=page.getByRole('dialog',{name:'Review bids',exact:true}),pay=review.locator('[data-payment-action]');await expect(pay).toBeEnabled();await pay.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});await expect(pay).toBeDisabled();await expect.poll(()=>posts).toBe(1);const spinner=pay.locator('svg');await expect(spinner).toHaveCount(1);expect(await spinner.evaluate(node=>getComputedStyle(node).animationName)).not.toBe('none');
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/wallet-submitting-${info.project.name}.png`,animations:'disabled'});release();await expect(page.getByRole('dialog',{name:'Bid receipt',exact:true}).getByRole('status')).toHaveText('Bid accepted');expect(posts).toBe(1);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
 }finally{release();await f.db.$disconnect()}
});

test('administrator password visibility toggles preserve the value in sign-in and create-account modes',async({page})=>{
 const writes:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/auth/'))writes.push(request.url())});
 await page.goto('/admin/login');await expect(page.getByRole('heading',{name:'Sign in to Lowwin',exact:true})).toBeVisible();
 const password=page.locator('input[name="password"]'),value='Fixture-only-visible-password-12345';
 for(const mode of ['login','signup'] as const){
  if(mode==='signup'){await page.getByRole('button',{name:'Create an account',exact:true}).click();await expect(page.getByRole('heading',{name:'Create your account',exact:true})).toBeVisible();await expect(password).toHaveAttribute('autocomplete','new-password')}
  await expect(password).toHaveAttribute('type','password');await password.fill(value);const show=page.getByRole('button',{name:'Show password',exact:true});await expect(show).toBeVisible();
  const box=await show.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  await show.click();await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue(value);
  const hide=page.getByRole('button',{name:'Hide password',exact:true});await expect(hide).toBeVisible();await hide.click();await expect(password).toHaveAttribute('type','password');await expect(password).toHaveValue(value);
 }
 expect(writes).toEqual([]);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a long pending bid stays honest, checks automatically and accepts a later server receipt',async({page},info)=>{
 const id=randomUUID(),f=await fixture(page,false,'chapa_'+id);
 const order={...pending({key:id,purpose:'BID',auctionSlug:f.auction.slug!,amount:'4.25',feeVersion:1},id),auctionTitle:f.title,auctionCode:String(f.auction.publicCode)};
 let complete=false,checks=0,creates=0;
 try{
  await page.clock.install();
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const req=route.request(),collection=new URL(req.url()).pathname.endsWith('/checkouts');
   if(collection){if(req.method()==='POST')creates++;return route.fulfill({json:{items:[order],page:1,nextPage:null}})}
   if(req.method()==='POST')checks++;
   return route.fulfill({json:{...order,...(complete?{status:'BID_ACCEPTED',providerStatus:'SUCCESS',verificationState:'VERIFIED',receipt:{bid:{id:randomUUID(),amount:'4.25'}}}:{})}});
  });
  await page.goto('/telegram');const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-payment-state="confirming"]')).toBeVisible();
  await page.clock.fastForward(90001);
  await expect(dialog.getByRole('heading',{name:'This is taking a bit longer'})).toBeVisible();
  await expect(dialog).toContainText('4.25');await expect(dialog).toContainText('Submission fee');
  await expect(dialog.getByRole('link',{name:'Go to My Bids',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/Verify|Check payment/i})).toHaveCount(0);
  const previous=checks;await page.clock.fastForward(15001);await expect.poll(()=>checks).toBeGreaterThan(previous);
  expect(creates).toBe(0);await expect(dialog).not.toContainText('Bid accepted');
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/waiting-${info.project.name}.png`,animations:'disabled'});
  complete=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(dialog.locator('[data-payment-state="confirmed"]')).toBeVisible();expect(creates).toBe(0);
 }finally{await f.db.$disconnect()}
});

test('My Bids filters payment attempts without counting them as accepted bids',async({page},info)=>{
 const f=await fixture(page,false),orders=['PENDING','FAILED','NEEDS_REVIEW','CANCELLED'].map((status,index)=>({...pending({key:randomUUID(),purpose:'BID',auctionSlug:f.auction.slug!,amount:String(index+2),feeVersion:1}),status,auctionTitle:f.title,merchantReference:'LW'+randomUUID().replaceAll('-','').slice(0,18),...(status==='NEEDS_REVIEW'?{verificationState:'MISMATCH'}:{})}));
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const url=new URL(route.request().url());
   if(!url.pathname.endsWith('/checkouts'))return route.fulfill({json:orders.find(row=>row.id===url.pathname.split('/').at(-1))});
   const status=url.searchParams.get('status'),match={failed:'FAILED',pending:'PENDING',cancelled:'CANCELLED',review:'NEEDS_REVIEW'}[status??''],items=match?orders.filter(row=>row.status===match):orders;
   return route.fulfill({json:{items,page:1,nextPage:null}});
  });
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));
  const sections=page.getByRole('group',{name:'Bid records'});
  await expect(sections.getByRole('button',{name:'Accepted bids',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-payment-id]')).toHaveCount(0);
  await sections.getByRole('button',{name:'Payment attempts',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(4);
  const filters=page.getByRole('group',{name:'Bid status'});
  for(const label of ['All','Pending','Failed','Cancelled','Needs review'])await expect(filters.getByRole('button',{name:label,exact:true})).toBeInViewport({ratio:1});
  await filters.getByRole('button',{name:'Failed',exact:true}).click();await expect(page).toHaveURL(/status=failed/);
  await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-payment-id]')).toContainText('Payment failed');
  await expect(page.locator('[data-my-bids-summary] strong').first()).toHaveText('0');
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/bids-${info.project.name}.png`,animations:'disabled'});
  await page.locator('[data-payment-id]').click();const detail=page.getByRole('dialog',{name:'Transaction details',exact:true});await expect(detail).toBeVisible();await expect(detail).toContainText('Payment failed');
  await page.screenshot({path:`test-results/chapa-ui/final-tuning/bid-detail-${info.project.name}.png`,animations:'disabled'});
  await page.keyboard.press('Escape');
  await filters.getByRole('button',{name:'Pending',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);
  await expect(page.locator('[data-payment-id]').filter({hasText:'Payment failed'})).toHaveCount(0);
  await filters.getByRole('button',{name:'Cancelled',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-payment-id]')).toContainText('Cancelled');
  await filters.getByRole('button',{name:'Needs review',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-payment-id]')).toContainText('Needs verification');
  await page.reload();await expect(filters.getByRole('button',{name:'Needs review',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-payment-id]')).toHaveCount(1);
  await sections.getByRole('button',{name:'Accepted bids',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(0);await expect(page).not.toHaveURL(/section=attempts/);
  await filters.getByRole('button',{name:'Completed',exact:true}).click();await expect(page).toHaveURL(/status=completed/);await expect(page.locator('[data-payment-id]')).toHaveCount(0);
  await page.goBack();await expect(filters.getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-my-bids-summary] strong').first()).toHaveText('0');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.$disconnect()}
});

test('Transactions signs and colors follow committed money movement and preserve payment details',async({page},info)=>{
 const am=info.project.name==='430',f=await fixture(page,am),credit={...pending({key:randomUUID(),purpose:'TOP_UP',amount:'250.00'}),status:'CREDITED',providerStatus:'SUCCESS'},debit={...pending({key:randomUUID(),purpose:'BID',auctionSlug:f.auction.slug!,amount:'4.25',feeVersion:1}),status:'BID_ACCEPTED',providerStatus:'SUCCESS',auctionTitle:'Rugga’s 45W 20,000mAh Power Bank',auctionTitleAm:'የ20,000mAh ፓወር ባንክ',receipt:{bid:{id:randomUUID(),amount:'4.25'}} as ChapaCheckoutView['receipt']};
 const orders=[credit,debit,pending({key:randomUUID(),purpose:'TOP_UP',amount:'100.00'}),{...pending({key:randomUUID(),purpose:'TOP_UP',amount:'50.00'}),status:'FAILED',providerStatus:'FAILED'},{...pending({key:randomUUID(),purpose:'TOP_UP',amount:'50.00'}),status:'CANCELLED',providerStatus:'CANCELLED'},{...pending({key:randomUUID(),purpose:'BID',auctionSlug:f.auction.slug!,amount:'7.25',feeVersion:1}),status:'NEEDS_REVIEW',fundsPreserved:true,auctionTitle:'Headphones',auctionTitleAm:'የጆሮ ማዳመጫ'}];
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const url=new URL(route.request().url());if(url.pathname.endsWith('/checkouts'))return route.fulfill({json:{items:orders,page:1,nextPage:null}});
   const order=orders.find(order=>order.id===url.pathname.split('/').at(-1));return route.fulfill({status:order?200:404,json:order??{error:'Not found'}});
  });
  await page.goto('/telegram?next='+encodeURIComponent('/payments'));
  const rows=page.locator('[data-payment-history] [data-payment-id]');await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toHaveAttribute('data-direction','incoming');await expect(rows.nth(0)).toContainText('+ETB 250.00');
  await expect(rows.nth(1)).toHaveAttribute('data-direction','outgoing');await expect(rows.nth(1)).toContainText('−ETB 10.00');
  for(const index of [2,3,4]){await expect(rows.nth(index)).toHaveAttribute('data-direction','none');await expect(rows.nth(index)).not.toContainText('+ETB');await expect(rows.nth(index)).not.toContainText('−ETB')}
  await expect(rows.nth(5)).toHaveAttribute('data-direction','incoming');await expect(rows.nth(5)).toContainText(am?'ክፍያው በዋሌትዎ ገብቷል':'Payment saved to wallet');
  expect(await rows.nth(0).locator('strong').last().evaluate(node=>getComputedStyle(node).color)).toBe('rgb(23, 107, 69)');expect(await rows.nth(1).locator('strong').last().evaluate(node=>getComputedStyle(node).color)).toBe('rgb(162, 56, 46)');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const row of await rows.all())expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  mkdirSync('test-results/chapa-ui/transactions',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/transactions/polished-${info.project.name}.png`,fullPage:true,animations:'disabled'});
  await rows.first().click();const detail=page.getByRole('dialog',{name:am?'የግብይት ዝርዝር':'Transaction details',exact:true});await expect(detail).toBeVisible();await expect(detail).toContainText(am?'ዋሌት ገብቷል':'Wallet credited');await page.keyboard.press('Escape');await expect(rows.first()).toBeFocused();
  expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
 }finally{await f.db.$disconnect()}
});
