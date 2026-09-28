import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/api/onboarding/contact',route=>route.fulfill({json:{verified:true}}));
  await page.route('**/api/alerts',route=>route.fulfill({json:{unread:0}}));
  await page.route('**/api/favorites/*',route=>route.fulfill({json:{saved:false}}));
});

test('featured auction card has real terms, safe public data and a usable carousel',async({page},info)=>{
  let available='750',posts=0;
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'featured-fixture',name:'Tester'},wallet:{available,held:'10',demo:true}}}));
  await page.route('**/api/auctions/*/bids',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{open:true,terms:{minPoints:'1',maxPoints:'100',stepPoints:'1',entryFeePoints:'0',maxDistinctBids:100},wallet:{available,held:'10'},previousMax:'10',remainingSubmissions:99,ownBids:[]}});
    posts++;
    const body=route.request().postDataJSON() as {amount:string;key:string};
    expect(body.amount).toBe('20');expect(body.key).toMatch(/^[0-9a-f-]{36}$/);
    available='740';
    return route.fulfill({status:201,json:{bid:{amount:'20',acceptedAt:new Date().toISOString()},hold:{newMax:'20',extraReserved:'10'},charge:{feePoints:'0',newlyUnavailable:'10'},wallet:{available,held:'20'},remainingSubmissions:98,ownBids:[{id:'accepted-fixture',amount:'20',acceptedAt:new Date().toISOString()}]}});
  });
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const carousel=page.getByLabel('Featured auctions');
  await expect(carousel).toBeVisible();
  await carousel.scrollIntoViewIfNeeded();
  await expect(carousel.getByText('DEMO',{exact:true})).toBeVisible();
  await expect(carousel.getByText('Entry fee')).toBeVisible();
  await expect(carousel.getByText('Auction code')).toBeVisible();
  await expect(carousel.getByRole('timer')).toBeVisible();
  await expect(carousel.getByRole('timer')).toHaveCSS('font-size','15px');
  await expect(carousel.getByRole('timer')).toHaveCSS('color','rgb(181, 68, 32)');
  await expect(carousel.getByRole('link',{name:'View auction details'})).toHaveAttribute('href',/\/auctions\/[^/]+#bid-review$/);
  await expect(carousel.getByRole('textbox',{name:'Bid amount in ETB'})).toBeVisible();
  await expect(carousel.getByText(/\d+ bids/)).toBeVisible();
  await expect.poll(()=>carousel.locator('img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
  await carousel.getByRole('textbox',{name:'Bid amount in ETB'}).fill('20');
  await carousel.screenshot({path:`docs/screenshots/featured-${info.project.name}.png`});
  await carousel.getByRole('button',{name:'Submit a bid amount'}).click();
  const confirmation=page.getByRole('dialog',{name:'Confirm your bid'});
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText('Extra reserved')).toBeVisible();
  await expect(confirmation.getByText('Total newly unavailable')).toBeVisible();
  await expect(confirmation.getByRole('button',{name:'Confirm & submit bid'})).toBeDisabled();
  await confirmation.getByRole('checkbox',{name:'I understand the hold and fee'}).check();
  await confirmation.screenshot({path:`docs/screenshots/featured-confirm-${info.project.name}.png`});
  await confirmation.getByRole('button',{name:'Confirm & submit bid'}).click();
  await expect(confirmation).not.toBeVisible();
  await expect(carousel.getByText(/Accepted ETB 20\.00/)).toBeVisible();
  expect(posts).toBe(1);
  await expect(page.getByRole('link',{name:'DEMO ETB 740.00 Available, open wallet'})).toBeVisible();
  const before=await carousel.getByText('Auction code').locator('..').locator('strong').innerText();
  await carousel.getByRole('button',{name:'Next featured auction'}).click();
  await expect(carousel.getByText('Auction code').locator('..').locator('strong')).not.toHaveText(before);
  await expect(page.locator('a[href="/auctions?status=live"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('invalid amounts and lost replies never show optimistic success; retries keep their key',async({page},info)=>{
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'featured-fixture',name:'Tester'},wallet:{available:'50',held:'10',demo:true}}}));
  const keys:string[]=[];
  await page.route('**/api/auctions/*/bids',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{open:true,terms:{minPoints:'1',maxPoints:'100',stepPoints:'1',entryFeePoints:'5',maxDistinctBids:100},wallet:{available:'50',held:'10'},previousMax:'10',remainingSubmissions:98,ownBids:[{id:'own',amount:'8',acceptedAt:new Date().toISOString()}]}});
    keys.push(route.request().postDataJSON().key);
    if(keys.length===1)return route.abort('failed');
    await new Promise(resolve=>setTimeout(resolve,500));
    return route.fulfill({status:201,json:{bid:{amount:'20',acceptedAt:new Date().toISOString()},hold:{newMax:'20',extraReserved:'10'},charge:{feePoints:'5',newlyUnavailable:'15'},wallet:{available:'35',held:'20'},remainingSubmissions:97,ownBids:[{id:'accepted',amount:'20',acceptedAt:new Date().toISOString()}]}});
  });
  await page.goto('/');
  const carousel=page.getByLabel('Featured auctions'),input=carousel.getByRole('textbox',{name:'Bid amount in ETB'}),review=carousel.getByRole('button',{name:'Submit a bid amount'});
  await input.fill('8');await expect(carousel.getByText('You already submitted this amount.')).toBeVisible();await expect(review).toBeDisabled();
  await input.fill('99');await expect(carousel.getByText('You need ETB 94.00 available for the hold and fee.')).toBeVisible();await expect(review).toBeDisabled();
  await input.fill('2.5');await expect(review).toBeDisabled();
  await input.fill('20');await review.click();
  const modal=page.getByRole('dialog',{name:'Confirm your bid'});
  await expect(modal.locator('dl>div').filter({has:page.getByText('Total newly unavailable',{exact:true})})).toContainText('ETB 15.00');
  const title=await carousel.locator('h3').innerText();
  await page.waitForTimeout(4300);await expect(carousel.locator('h3')).toHaveText(title);
  await modal.getByRole('checkbox').check();await modal.getByRole('button',{name:'Confirm & submit bid'}).click();
  await expect(modal.getByRole('alert')).toContainText('Connection interrupted');
  await expect(carousel.getByText(/Accepted ETB/)).toHaveCount(0);
  await modal.getByRole('button',{name:'Confirm & submit bid'}).click();
  await expect(modal.getByRole('button',{name:'Submitting…'})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(modal).toBeVisible();
  await expect(modal).not.toBeVisible();
  expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  await expect(carousel.getByText(/Available ETB 35.00/)).toBeVisible();
  await page.getByRole('combobox',{name:'Language'}).selectOption('am');
  await page.locator('.featured-carousel').screenshot({path:`docs/screenshots/featured-am-${info.project.name}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('reduced motion stops automatic slide changes',async({page})=>{
  await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'featured-fixture',name:'Tester'},wallet:{available:'750',held:'10',demo:true}}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  const carousel=page.getByLabel('Featured auctions');
  await carousel.scrollIntoViewIfNeeded();
  const title=await carousel.locator('h3').innerText();
  await page.waitForTimeout(4300);
  await expect(carousel.locator('h3')).toHaveText(title);
});
