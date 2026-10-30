import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {fixture,pending} from './fixtures';

test('one stable bid modal opens immediately, with product-only description and separate top-up',async({page},info)=>{
 const f=await fixture(page,false),marker=randomUUID();let release=()=>{};
 const gate=new Promise<void>(resolve=>release=resolve),description='A real product description supplied by the administrator.\nCapacity and useful product details belong here.\nThis longer third line stays in the product description.';
 try{
  await f.db.product.update({where:{id:f.auction.productId!},data:{description}});
  await page.route('**/api/auctions/*/bids',async route=>{await gate;await route.continue()});
  await page.goto('/telegram?next='+encodeURIComponent(f.home));
  await page.locator('.auction-card').filter({hasText:f.title}).getByRole('button').click();
  const dialog=page.getByRole('dialog',{name:'Place your bid',exact:true}),input=dialog.getByRole('textbox',{name:'Your bid amount',exact:true});
  await expect(dialog).toBeVisible();await expect(input).toBeVisible();
  await expect(dialog).not.toContainText('Loading entry details');
  await dialog.evaluate((node,value)=>node.setAttribute('data-stable-modal',value),marker);
  await input.fill('4.25');await dialog.getByRole('radio',{name:'Chapa',exact:true}).check();
  await expect(dialog.locator('[data-payment-action]')).toBeDisabled();
  release();await expect(dialog.locator('[data-payment-action]')).toBeEnabled();
  await expect(dialog).toHaveAttribute('data-stable-modal',marker);await expect(input).toHaveValue('4.25');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const product=dialog.getByRole('region',{name:'Product description'});
  await product.getByRole('button',{name:'Show more',exact:true}).click();
  await expect(product).toContainText(description);await expect(product.getByRole('button',{name:'Show less',exact:true})).toHaveAttribute('aria-expanded','true');
  await product.getByRole('button',{name:'Show less',exact:true}).click();
  await expect(dialog.locator('fieldset').getByRole('link',{name:'Top up wallet',exact:true})).toHaveCount(0);
  await dialog.getByRole('link',{name:'Top up wallet',exact:true}).click();
  const topup=page.getByRole('dialog',{name:'Top up wallet',exact:true});await expect(topup).toBeVisible();
  await page.keyboard.press('Escape');await expect(input).toHaveValue('4.25');await expect(dialog.getByRole('radio',{name:'Chapa',exact:true})).toBeChecked();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  mkdirSync('test-results/chapa-ui/final-tuning',{recursive:true});await page.screenshot({path:`test-results/chapa-ui/final-tuning/bid-${info.project.name}.png`,animations:'disabled'});
 }finally{release();await f.db.$disconnect()}
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
