import {test,expect,type Locator,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,pending} from './fixtures';

async function modalGeometry(dialog:Locator){
 return dialog.evaluate(node=>{
  const body=node.querySelector('[data-sheet-body]') as HTMLElement,box=node.getBoundingClientRect(),footer=node.querySelector('[data-sheet-footer]')?.getBoundingClientRect();
  return {height:box.height,top:box.top,bottom:box.bottom,viewport:innerHeight,bodyHeight:body?.clientHeight??0,bodyScrollHeight:body?.scrollHeight??0,bodyScrollTop:body?.scrollTop??0,footerTop:footer?.top??null,footerBottom:footer?.bottom??null};
 });
}
async function expectCompactFit(dialog:Locator){
 await expect.poll(async()=>{const g=await modalGeometry(dialog);return g.bodyHeight>0&&g.bodyScrollHeight<=g.bodyHeight+1}).toBe(true);
 const geometry=await modalGeometry(dialog);expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport+1);expect(geometry.bodyScrollTop).toBe(0);expect(geometry.footerBottom).not.toBeNull();expect(geometry.footerBottom!).toBeLessThanOrEqual(geometry.viewport+1);
 return geometry;
}
async function compactEntryScenario(page:Page,name:string){
 const f=await fixture(page,false),marker=randomUUID(),errors:string[]=[],writes:string[]=[];let release=()=>{},quoteReads=0;
 const gate=new Promise<void>(resolve=>release=resolve),description='An administrator supplied this product description.\n'+Array.from({length:30},(_,index)=>`Detail ${index+1}: capacity, materials and useful product information remain readable when expanded.`).join('\n');
 const ownBids=['1.01','1.02','1.03','2.01','2.03'].map(amount=>({id:randomUUID(),amount,acceptedAt:new Date().toISOString()})),couponIds=Array.from({length:3},()=>randomUUID());
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(?:payments\/chapa\/checkouts|auctions\/[^/]+\/bids)/.test(new URL(request.url()).pathname))writes.push(request.url())});
 try{
  await f.db.product.update({where:{id:f.auction.productId!},data:{description}});
  await page.route('**/api/auctions/*/bids',async route=>{if(route.request().method()!=='GET')return route.abort();await gate;const response=await route.fetch(),body=await response.json();return route.fulfill({response,json:{...body,ownBids,remainingSubmissions:95,referralDiscountsAvailable:true,couponAvailableCount:3}})});
  await page.route('**/api/auctions/*/discount-quote?**',route=>{quoteReads++;const now=new Date().toISOString(),coupons=couponIds.map(id=>({id,percent:10,expiresAt:new Date(Date.now()+3600000).toISOString()}));return route.fulfill({json:{serverNow:now,auctionSlug:f.auction.slug,feeVersion:1,ruleVersion:'lowest-unique-v4',grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',coupon:coupons[0],eligible:true,availableCoupons:coupons}})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  await page.locator('.auction-card').filter({hasText:f.title}).getByRole('button').click();
  const dialog=page.getByRole('dialog',{name:'Place your bid',exact:true}),input=dialog.getByRole('textbox',{name:'Your bid amount',exact:true});
  await expect(dialog).toBeVisible();await expect(input).toBeVisible();
  await expect(dialog).not.toContainText('Loading entry details');
  await dialog.evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{})))});
  const initialGeometry=await modalGeometry(dialog);
  await dialog.evaluate((node,value)=>node.setAttribute('data-stable-modal',value),marker);
  const header=dialog.locator(':scope>header');await expect(header.getByText('Live',{exact:true})).toBeVisible();await expect(dialog.getByText('Live',{exact:true})).toHaveCount(1);
  await expect(dialog.getByRole('group',{name:'Select payment method'})).toBeVisible();await expect(dialog.getByRole('radio')).toHaveCount(2);
  await input.fill('4.25');await dialog.getByRole('radio',{name:'Chapa',exact:true}).check();
  await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  release();await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  await expect(dialog).toHaveAttribute('data-stable-modal',marker);await expect(input).toHaveValue('4.25');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const readyGeometry=await expectCompactFit(dialog);expect(Math.abs(readyGeometry.height-initialGeometry.height)).toBeLessThanOrEqual(2);
  const viewport=page.viewportSize()!,photo=dialog.locator('[data-sheet-preview]>div').first(),photoBox=await photo.boundingBox(),expectedPhotoHeight=viewport.height<=700?56:viewport.height>=900?140:116;
  expect(photoBox).not.toBeNull();expect(photoBox!.height).toBeGreaterThanOrEqual(expectedPhotoHeight);if(viewport.height<=700)expect(photoBox!.height).toBeLessThanOrEqual(56);
  await expect(dialog).not.toContainText('Use your wallet for quick bidding');
  await expect(dialog.locator('[data-bid-balance]')).toHaveCount(1);await expect(dialog.locator('[data-bid-balance]')).toContainText('25.00');
  const balanceBox=await dialog.locator('[data-bid-balance]').boundingBox(),labelBox=await dialog.locator('label').filter({hasText:'Your bid amount'}).boundingBox();expect(balanceBox).not.toBeNull();expect(labelBox).not.toBeNull();expect(Math.abs(balanceBox!.y-labelBox!.y)).toBeLessThanOrEqual(24);
  const countStyle=await dialog.locator('[data-bid-count] strong').evaluate(node=>{const style=getComputedStyle(node);return {size:parseFloat(style.fontSize),weight:Number(style.fontWeight)}});expect(countStyle.size).toBeGreaterThanOrEqual(13);expect(countStyle.weight).toBeGreaterThanOrEqual(650);
  await expect(dialog.locator('[data-bid-remaining]')).toContainText('95');expect((await dialog.locator('[data-bid-remaining]').boundingBox())!.height).toBeLessThanOrEqual(32);
  const coupon=dialog.locator('[data-bid-coupons]');await expect(coupon).toContainText(/Coupon/i);await expect(coupon).toContainText('3');await expect(coupon.getByRole('button',{name:/^Apply(?: earned discount| coupon)?$/i})).toBeVisible();expect(quoteReads).toBe(0);
  await input.fill('1.04');await expect(dialog.getByRole('alert')).toHaveText('Only 3 consecutive amounts. Skip at least one step.');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  await input.fill('1.02');await expect(dialog.getByRole('alert')).toHaveText('You already submitted this amount.');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  await input.fill('4.25');await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  await coupon.getByRole('button',{name:/^Apply(?: earned discount| coupon)?$/i}).click();await expect(dialog.locator('[data-payment-action]')).toContainText('9.00');expect(quoteReads).toBe(1);
  await coupon.getByRole('button',{name:/^Remove(?: earned discount| coupon)?$/i}).click();await expect(dialog.locator('[data-payment-action]')).toContainText('10.00');
  const payment=dialog.getByRole('group',{name:'Select payment method'}),topUp=payment.getByRole('link',{name:'Top up wallet',exact:true});await expect(topUp).toHaveCount(1);expect(await topUp.evaluate(node=>node.closest('label')===null)).toBe(true);
  const plusBox=await topUp.boundingBox();expect(plusBox!.width).toBeGreaterThanOrEqual(44);expect(plusBox!.height).toBeGreaterThanOrEqual(44);
  await topUp.click();const topup=page.getByRole('dialog',{name:'Top up wallet',exact:true});await expect(topup).toBeVisible();
  await page.keyboard.press('Escape');await expect(input).toHaveValue('4.25');await expect(dialog.getByRole('radio',{name:'Chapa',exact:true})).toBeChecked();await expect(dialog.getByRole('radio',{name:'Wallet balance',exact:true})).not.toBeChecked();await expect(dialog).toHaveAttribute('data-stable-modal',marker);
  await expectCompactFit(dialog);
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/bid-${name}.png`,animations:'disabled'});await photo.screenshot({path:`test-results/chapa-ui/final-tuning/bid-photo-${name}.png`,animations:'disabled'});
  const modalBox=await dialog.boundingBox(),bottomTop=Math.max(0,labelBox!.y-6);await page.screenshot({path:`test-results/chapa-ui/final-tuning/bid-bottom-${name}.png`,animations:'disabled',clip:{x:modalBox!.x,y:bottomTop,width:modalBox!.width,height:modalBox!.y+modalBox!.height-bottomTop}});
  const product=dialog.getByRole('region',{name:'Product description'});
  await product.getByRole('button',{name:'Show more',exact:true}).click();
  await expect(product).toContainText(description);await expect(product.getByRole('button',{name:'Show less',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect.poll(()=>product.evaluate(node=>[node,...node.querySelectorAll('*')].some(child=>{const element=child as HTMLElement,style=getComputedStyle(element);return ['auto','scroll'].includes(style.overflowY)&&element.scrollHeight>element.clientHeight+1}))).toBe(true);
  await product.evaluate(node=>{for(const child of [node,...node.querySelectorAll('*')]){const element=child as HTMLElement;if(['auto','scroll'].includes(getComputedStyle(element).overflowY))element.scrollTop=element.scrollHeight}});
  await product.getByRole('button',{name:'Show less',exact:true}).scrollIntoViewIfNeeded();await expect(product.getByRole('button',{name:'Show less',exact:true})).toBeInViewport();expect(Math.abs((await modalGeometry(dialog)).height-readyGeometry.height)).toBeLessThanOrEqual(2);
  await product.getByRole('button',{name:'Show less',exact:true}).click();
  await input.fill('10');await input.pressSequentially('.75',{delay:5});await expect(input).toHaveValue('10.75');
  await input.pressSequentially('9e-');await expect(input).toHaveValue('10.75');
  await input.fill('11.999');await expect(input).toHaveValue('10.75');
  await input.fill('');await input.pressSequentially('12.');await expect(input).toHaveValue('12.');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  await input.pressSequentially('50');await expect(input).toHaveValue('12.50');await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  await input.fill('10.75');
  await input.focus();await page.setViewportSize({...viewport,height:Math.min(430,viewport.height-180)});
  await expect(dialog).toHaveAttribute('data-keyboard-open','true');await expect(input).toBeInViewport({ratio:1});await expect(dialog.locator('[data-payment-action]')).toBeInViewport({ratio:1});await expect(input).toHaveValue('10.75');
  await page.setViewportSize(viewport);await input.blur();await expect(dialog).toHaveAttribute('data-keyboard-open','false');await expectCompactFit(dialog);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);expect(writes).toEqual([]);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
  writeFileSync(`test-results/chapa-ui/final-tuning/bid-${name}.json`,JSON.stringify({viewport,initialGeometry,readyGeometry,photoHeight:photoBox!.height,expectedPhotoHeight,oneStableModal:true,noNormalBodyScroll:true,separateTopUpPreservesSelection:true,exactConsecutiveAndDuplicatePreview:true,displayOnlyOwnBidFixture:true,couponCount:3,remainingSubmissions:95,paymentWrites:0,errors},null,2));
 }finally{release();await f.db.$disconnect()}
}

test('compact bid entry is one stable modal with gated data, independent wallet plus and accessible expansion',async({page},info)=>{
 await compactEntryScenario(page,info.project.name);
});

test('short360x640 compact bid entry fits without scrolling and keeps keyboard access',async({page},info)=>{
 test.skip(info.project.name!=='360','The existing360project owns the additional short-phone viewport.');await page.setViewportSize({width:360,height:640});await compactEntryScenario(page,'360-short');
});

test('wallet submission shows a spinner and a single disabled Submitting action until the response',async({page},info)=>{
 const f=await fixture(page,false);let release=()=>{},posts=0;const gate=new Promise<void>(resolve=>release=resolve);
 try{
  await page.route('**/api/auctions/*/bids',async route=>{if(route.request().method()==='GET')return route.continue();posts++;await gate;return route.fulfill({json:{bid:{id:randomUUID(),auctionCode:f.auction.code,auctionSlug:f.auction.slug,amount:'7.25',acceptedAt:new Date().toISOString(),termsVersion:1,feePoints:'10'},hold:{previousMax:'0',newMax:'0',extraReserved:'0'},charge:{feePoints:'10',newlyUnavailable:'10'},wallet:{available:'15',held:'0'},remainingSubmissions:99,ownBids:[]}})});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));await page.locator('.auction-card').filter({hasText:f.title}).getByRole('button').click();
  const dialog=page.getByRole('dialog',{name:'Place your bid',exact:true}),input=dialog.getByRole('textbox',{name:'Your bid amount',exact:true}),pay=dialog.locator('[data-payment-action]');
  await input.fill('7.25');await expect(pay).toBeEnabled();await expect(dialog.getByRole('radio',{name:'Wallet balance',exact:true})).toBeChecked();
  await pay.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()});await expect(pay).toBeDisabled();await expect(pay).toHaveText('Submitting');await expect(input).toBeDisabled();await expect(pay.locator('[data-bid-submitting]')).toHaveCount(1);
  const spinner=await pay.locator('[data-bid-submitting]').evaluate(node=>{const style=getComputedStyle(node);return {animation:style.animationName,duration:style.animationDuration}});expect(spinner.animation).not.toBe('none');expect(spinner.duration).not.toBe('0s');await expect.poll(()=>posts).toBe(1);
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/wallet-submitting-${info.project.name}.png`,animations:'disabled'});
  release();const receipt=page.getByRole('dialog',{name:'Bid receipt',exact:true});await expect(receipt.getByRole('status')).toHaveText('Bid accepted');expect(posts).toBe(1);expect(await f.db.bid.count({where:{userId:f.user.id}})).toBe(0);
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
 const f=await fixture(page,false),orders=['PENDING','FAILED','NEEDS_REVIEW'].map((status,index)=>({...pending({key:randomUUID(),purpose:'BID',auctionSlug:f.auction.slug!,amount:String(index+2),feeVersion:1}),status,auctionTitle:f.title,merchantReference:'LW'+randomUUID().replaceAll('-','').slice(0,18),...(status==='NEEDS_REVIEW'?{verificationState:'MISMATCH'}:{})}));
 try{
  await page.route('**/api/payments/chapa/checkouts**',route=>{
   const url=new URL(route.request().url());
   if(!url.pathname.endsWith('/checkouts'))return route.fulfill({json:orders.find(row=>row.id===url.pathname.split('/').at(-1))});
   const status=url.searchParams.get('status'),items=status==='failed'?orders.filter(row=>row.status==='FAILED'):status==='pending'?orders.filter(row=>row.status!=='FAILED'):orders;
   return route.fulfill({json:{items,page:1,nextPage:null}});
  });
  await page.goto('/telegram?next='+encodeURIComponent('/my-bids'));
  await expect(page.locator('[data-payment-id]')).toHaveCount(3);
  const filters=page.getByRole('group',{name:'Bid status'});
  await filters.getByRole('button',{name:'Failed',exact:true}).click();await expect(page).toHaveURL(/status=failed/);
  await expect(page.locator('[data-payment-id]')).toHaveCount(1);await expect(page.locator('[data-payment-id]')).toContainText('Payment failed');
  await expect(page.locator('[data-my-bids-summary] strong').first()).toHaveText('0');
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/bids-${info.project.name}.png`,animations:'disabled'});
  await page.locator('[data-payment-id]').click();const detail=page.getByRole('dialog',{name:'Transaction details',exact:true});await expect(detail).toBeVisible();await expect(detail).toContainText('Payment failed');
  await page.screenshot({path:`test-results/chapa-ui/final-tuning/bid-detail-${info.project.name}.png`,animations:'disabled'});
  await page.keyboard.press('Escape');
  await filters.getByRole('button',{name:'Pending',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(2);
  await expect(page.locator('[data-payment-id]').filter({hasText:'Payment failed'})).toHaveCount(0);
  await filters.getByRole('button',{name:'Successful',exact:true}).click();await expect(page.locator('[data-payment-id]')).toHaveCount(0);
  await expect(page.locator('[data-my-bids-summary] strong').first()).toHaveText('0');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await f.db.$disconnect()}
});
