import {test, expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {mkdirSync, writeFileSync} from 'node:fs';
import {randomInt, randomUUID} from 'node:crypto';
import {ENGLISH_UI_STATE, signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';
import {creditDevelopmentPoints, reconcile} from '../../src/modules/wallet/ledger';

const stage = process.env.REDESIGN_STAGE ?? 'after';
const root = process.env.REDESIGN_CAPTURE_DIR ?? `docs/redesign/screenshots/${stage}`;
const origin = process.env.BETTER_AUTH_URL!;

test('authenticated mobile screens and local timing evidence', async ({page, browser}, info) => {
  const client=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});mkdirSync(root,{recursive:true});
  const errors:string[]=[],financialPosts:string[]=[],quotePosts:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/api\/payments\//.test(path))(path==='/api/payments/chapa/batches/quote'?quotePosts:financialPosts).push(path)});
  const telegramId=randomInt(6000000000,7000000000),launch=signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Redesign fixture'})},process.env.TELEGRAM_BOT_TOKEN);
  const timings:Record<string,unknown>={stage,width:info.project.name,mode:'Optimized loopback UI with synthetic wallet funds; no external payment or Telegram device latency claim'};
  try{
    const auction=await bidAuction(client,{fee:30,ruleVersion:'lowest-unique-v5',isDemo:false,endDelayMs:3600000});
    await client.product.update({where:{id:auction.productId!},data:{title:'DEMO wireless headphones',isDemo:false,images:{create:{path:'/catalog/accessory.svg',alt:'DEMO headphones illustration',sourceType:'ORIGINAL'}}}});
    await verifyFixtureContact(client,telegramId);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
    await page.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{data:launch});
    const began=performance.now();await page.goto('/profile');await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
    await expect.poll(async()=>(await page.request.get('/api/me')).status()).toBe(200);timings.authenticatedLaunchMs=Math.round(performance.now()-began);
    expect(await(await page.request.get('/api/me')).json()).not.toHaveProperty('wallet');
    const user=await client.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});Object.assign(process.env,{DEV_POINTS_ENABLED:'true',NODE_ENV:'test'});
    await creditDevelopmentPoints(client,user.id,'1000','redesign-'+randomUUID());
    for(const [name,path]of [['home','/'],['auctions','/auctions'],['draws','/draws'],['my-bids','/my-bids'],['profile','/profile'],['transactions','/payments'],['auction',`/auctions/${auction.publicCode}`]] as const){
      const started=performance.now(),response=await page.goto(path);await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
      expect(response?.status(),path).toBeLessThan(400);await expect(page.locator('.launch-loader,.page-loading-backdrop')).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow on '+path).toBe(true);timings[name+'RenderMs']=Math.round(performance.now()-started);
      if(name==='home')await expect.poll(()=>page.locator('[data-home-hero] img').evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
      await page.screenshot({path:`${root}/${name}-${info.project.name}-en.png`,fullPage:true});
    }
    await page.goto('/');const learnTrigger=page.locator('[data-home-hero]').getByRole('button',{name:'Learn more',exact:true});await learnTrigger.click();
    const learn=page.getByRole('dialog');await expect(learn.locator('[data-tutorial-video-empty]')).toBeVisible();await expect(learn.locator('iframe,video')).toHaveCount(0);
    await page.screenshot({path:`${root}/learn-more-${info.project.name}-en.png`});await page.keyboard.press('Escape');await expect(learn).toHaveCount(0);await expect(learnTrigger).toBeFocused();
    await page.locator('[data-home-hero]').getByRole('link',{name:'Live auctions',exact:true}).click();await expect(page.locator('#discover-auctions')).toBeFocused();await expect(page.locator('#discover-auctions')).toBeInViewport();
    await page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:'Me',exact:true}).click();await page.getByRole('link',{name:/^Notifications/}).click();
    const notifications=page.getByRole('dialog',{name:'Notifications',exact:true});await expect(notifications).toBeVisible();
    for(const filter of ['All','Winners','Payments'])await expect(notifications.getByRole('button',{name:filter,exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(notifications).toHaveCount(0);
    await page.goto('/auctions/'+auction.publicCode);await page.locator('#bid-review').getByRole('button',{name:'Place a bid',exact:true}).click();
    const sheet=page.getByRole('dialog'),input=sheet.getByRole('textbox',{name:'Your bid number',exact:true});await expect(input).toBeVisible();await input.fill('3.60');
    const original=page.viewportSize()!;await page.setViewportSize({width:original.width,height:450});await input.focus();
    await expect.poll(()=>page.evaluate(()=>{const box=document.activeElement!.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight})).toBe(true);await page.setViewportSize(original);
    expect(await client.bid.count({where:{auctionId:auction.id,userId:user.id}})).toBe(0);expect(financialPosts).toEqual([]);
    await sheet.locator('[data-payment-action]').click();await expect(sheet.locator('[data-bid-step=payment]')).toBeVisible();
    await sheet.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await expect(sheet.locator('[data-bid-total]')).toContainText('ETB 30.00');
    await expect.poll(()=>quotePosts.length).toBe(1);expect(await client.bid.count({where:{auctionId:auction.id,userId:user.id}})).toBe(0);expect((await client.ledgerAccount.findUniqueOrThrow({where:{name:`user:${user.id}:available`}})).balance.toString()).toBe('1000');expect(financialPosts).toEqual([]);const payBegan=performance.now();await sheet.locator('[data-payment-action]').click();
    await expect(sheet.locator('[data-wallet-bid-progress=success]')).toBeVisible();await expect(sheet).toContainText('Paid from wallet');
    timings.walletCommitToReceiptMs=Math.round(performance.now()-payBegan);expect(await client.bid.count({where:{auctionId:auction.id,userId:user.id}})).toBe(1);
    expect((await client.ledgerAccount.findUniqueOrThrow({where:{name:`user:${user.id}:available`}})).balance.toString()).toBe('970');
    expect(financialPosts).toHaveLength(1);expect(financialPosts[0]).toBe('/api/payments/chapa/batches/wallet');
    await page.screenshot({path:`${root}/wallet-bid-receipt-${info.project.name}-en.png`});await sheet.getByRole('button',{name:'Done',exact:true}).click();
    await page.goto('/my-bids');const owned=page.locator(`[data-bid-auction="${auction.publicCode}"]`);await expect(owned).toContainText('3.60');await expect(owned).toContainText('Bid accepted');await expect(owned.getByRole('timer')).toBeVisible();
    await page.goto('/payments');await page.locator('[data-payment-id]').first().click();const receipt=page.getByRole('dialog',{name:'Transaction details',exact:true});
    await expect(receipt).toContainText('ETB 30.00');await expect(receipt.getByText('Chosen number',{exact:true}).locator('..').locator('dd')).toHaveText('3.6');await expect(receipt).toContainText('Lowwin Wallet');await receipt.getByRole('button',{name:'Done',exact:true}).click();
    await page.goto('/profile');await expect(page.getByRole('region',{name:'Your wallet',exact:true})).toContainText('970.00 ETB');await expect(page.getByRole('link',{name:'Top up wallet',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Edit',exact:true}).click();const editor=page.getByRole('dialog',{name:'Edit profile',exact:true});
    await editor.getByLabel('Nickname',{exact:true}).fill('DEMO review player');await editor.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.getByText('Profile saved.',{exact:true})).toBeVisible();
    expect((await client.telegramOwnContact.findUniqueOrThrow({where:{userId:user.id}})).telegramId).toBe(String(telegramId));
    // A zero-balance account can review the same draft but cannot spend or
    // initialize an external payment while merchant creation is disabled.
    const zeroId=randomInt(7000000000,8000000000);await verifyFixtureContact(client,zeroId);
    const zeroContext=await browser.newContext({viewport:original,baseURL:origin,ignoreHTTPSErrors:true,storageState:ENGLISH_UI_STATE,extraHTTPHeaders:{'x-forwarded-for':`198.19.${Math.floor(zeroId%65536/256)}.${zeroId%256}`}});
    try{
      const zero=await zeroContext.newPage(),posts:string[]=[],quotes:string[]=[];zero.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&/\/api\/payments\//.test(path))(path==='/api/payments/chapa/batches/quote'?quotes:posts).push(path)});
      await zero.route('https://telegram.org/**',route=>route.fulfill({body:''}));await zero.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{data:signedLaunch({user:JSON.stringify({id:zeroId,first_name:'Zero balance fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
      await zero.goto('/auctions/'+auction.publicCode);await zero.locator('#bid-review').getByRole('button',{name:'Place a bid',exact:true}).click();const zeroSheet=zero.getByRole('dialog');
      await zeroSheet.getByRole('textbox',{name:'Your bid number',exact:true}).fill('7.31');await zeroSheet.locator('[data-payment-action]').click();await expect(zeroSheet.locator('[data-bid-step=payment]')).toBeVisible();
      await zeroSheet.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await zeroSheet.locator('[data-payment-action]').click();await expect(zeroSheet.locator('[data-bid-step=payment]')).toContainText('Your LowWin Wallet has 0 ETB');
      await expect.poll(()=>quotes.length).toBe(1);expect(posts).toEqual([]);await expect(zeroSheet.locator('[data-bid-payment-summary]')).toContainText('7.31');await zeroSheet.getByRole('button',{name:'Add funds',exact:true}).click();
      await expect(zeroSheet.locator('[data-wallet-top-up]')).toBeVisible();const amount=zeroSheet.getByRole('textbox',{name:'Amount to add',exact:true});await amount.fill('100');await expect(amount).toHaveValue('100');
      await zeroSheet.locator('[data-payment-action]').click();await expect(zeroSheet.locator('[data-top-up-step=payment]')).toBeVisible();await expect(zeroSheet.getByRole('radio')).toHaveCount(0);
      await zeroSheet.locator('[data-payment-action]').click();await expect(zeroSheet).toContainText('Choose a payment method.');expect(posts).toEqual([]);
      await zero.goBack();await expect(zeroSheet.locator('[data-top-up-step=amount]')).toBeVisible();await zero.goBack();await expect(zeroSheet.locator('[data-bid-payment-summary]')).toContainText('7.31');
      const zeroUser=await client.user.findUniqueOrThrow({where:{telegramId:String(zeroId)}});expect(await client.bid.count({where:{userId:zeroUser.id}})).toBe(0);expect(await client.chapaCheckout.count({where:{userId:zeroUser.id}})).toBe(0);
    }finally{await zeroContext.close()}
    await page.goto('/wallet?tab=transactions&type=activity');await expect(page).toHaveURL(/\/profile#wallet$/);await expect(page.getByRole('region',{name:'Your wallet',exact:true})).toContainText('970.00 ETB');
    for(const endpoint of ['/api/me','/api/alerts',`/api/catalog/auctions/${auction.publicCode}`]){const samples:number[]=[];for(let n=0;n<20;n++){const start=performance.now(),response=await page.request.get(endpoint);expect(response.status()).toBe(200);await response.body();samples.push(performance.now()-start)}samples.sort((a,b)=>a-b);timings[endpoint]={n:20,p50Ms:Math.round(samples[9]),p95Ms:Math.round(samples[18])}}
    await page.context().addCookies([{name:'lowwin-language',value:'am',domain:'localhost',path:'/'}]);
    for(const [name,href,label]of [['home','/','መነሻ'],['winners','/winners','አሸናፊዎች'],['my-bids','/my-bids','ጨረታዎቼ'],['profile','/profile','እኔ']] as const){
      await page.goto(href);await expect(page.getByRole('navigation',{name:'Your navigation'}).getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${root}/${name}-${info.project.name}-am.png`,fullPage:true});
    }
    timings.reconciliationDrift=(await reconcile(client)).length;timings.browserErrors=errors;writeFileSync(`${root}/timings-${info.project.name}.json`,JSON.stringify(timings,null,2));
    expect(timings.reconciliationDrift).toBe(0);expect(errors).toEqual([]);
  }finally{await client.$disconnect()}
});

test('a background launch failure preserves public browsing and explicit reconnect restores the account', async ({page}, info) => {
  test.skip(stage !== 'after', 'Final recovery regression');
  const client = new PrismaClient({datasourceUrl: process.env.TEST_DATABASE_URL});
  try {
    const telegramId = randomInt(8000000000, 9000000000);
    await page.setExtraHTTPHeaders({'x-forwarded-for':`198.19.${Math.floor(telegramId%65536/256)}.${telegramId%256}`});
    await verifyFixtureContact(client, telegramId);
    await page.route('https://telegram.org/**', route => route.fulfill({body: ''}));
    await page.addInitScript(({data}) => {localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};}, {data: signedLaunch({user: JSON.stringify({id: telegramId, first_name: 'Recovery fixture'})}, process.env.TELEGRAM_BOT_TOKEN)});
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route('**/api/auth/telegram/miniapp/signin', async route => {await gate; await route.fulfill({status: 503, json: {error: 'Connection interrupted. Please retry.'}});});
    await page.goto('/telegram');
    await expect(page.locator('#home-headline')).toBeVisible();
    await expect(page.locator('.launch-loader')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({path: `${root}/launch-loading-${info.project.name}.png`});
    release();
    const reconnect=page.getByRole('banner',{name:'Mini App header'}).getByRole('button',{name:'Try again',exact:true});
    await expect(reconnect).toBeEnabled();
    await expect(page.getByRole('button',{name:/^(Log in|Continue with Telegram)$/})).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.launch-loader')).toHaveCount(0);
    await page.screenshot({path: `${root}/launch-error-${info.project.name}.png`});
    await page.unroute('**/api/auth/telegram/miniapp/signin');
    await reconnect.click();
    await expect(page.locator('[data-header-balance]')).toBeVisible();
    await expect(page.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
  } finally {await client.$disconnect();}
});
