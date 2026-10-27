import {test, expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {mkdirSync, writeFileSync} from 'node:fs';
import {randomInt, randomUUID} from 'node:crypto';
import {ENGLISH_UI_STATE, signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';
import {submitBid} from '../../src/modules/auctions/bids';
import {creditDevelopmentPoints, reconcile} from '../../src/modules/wallet/ledger';

const stage = process.env.REDESIGN_STAGE ?? 'after';
const root = process.env.REDESIGN_CAPTURE_DIR ?? `docs/redesign/screenshots/${stage}`;
const origin = process.env.BETTER_AUTH_URL!;

test('authenticated mobile screens and local timing evidence', async ({page, browser}, info) => {
  const client = new PrismaClient({datasourceUrl: process.env.TEST_DATABASE_URL});
  mkdirSync(root, {recursive: true});
  const errors: string[] = [],walletReads:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/wallet'))walletReads.push(request.url())});
  page.on('pageerror', error => errors.push(error.message));
  const telegramId = randomInt(6000000000, 7000000000);
  const launch = signedLaunch({user: JSON.stringify({id: telegramId, first_name: 'Redesign fixture'})}, process.env.TELEGRAM_BOT_TOKEN);
  const timings: Record<string, unknown> = {stage, width: info.project.name, mode: `${process.env.REDESIGN_PRODUCTION === '1' ? 'optimized build' : 'development build'} on loopback; not a production service or Telegram device benchmark`};
  try {
    const auction = await bidAuction(client, {fee: 30, ruleVersion: 'lowest-unique-v4', isDemo: false, endDelayMs: 3600000});
    await client.product.update({where: {id: auction.productId!}, data: {title: 'DEMO wireless headphones', images: {create: {path: '/catalog/accessory.svg', alt: 'DEMO headphones illustration', sourceType: 'ORIGINAL'}}}});
    await verifyFixtureContact(client, telegramId);
    await page.route('https://telegram.org/**', route => route.fulfill({body: ''}));
    await page.addInitScript(({data}) => {window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};}, {data: launch});
    // Compile the authentication handler before the timed browser launch. No session is created here.
    await page.request.post('/api/auth/telegram/miniapp/signin', {headers: {origin}, data: {initData: ''}, timeout: 120000});
    const start = performance.now();
    await page.goto('/profile');
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(200);
    await expect(page.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
    timings.authenticatedLaunchMs = Math.round(performance.now() - start);
    const user = await client.user.findUniqueOrThrow({where: {telegramId: String(telegramId)}});
    expect(await (await page.request.get('/api/me')).json()).not.toHaveProperty('wallet');
    // Test fixture issuance remains confined to this disposable database.
    Object.assign(process.env, {DEV_POINTS_ENABLED: 'true', NODE_ENV: 'test'});
    await creditDevelopmentPoints(client, user.id, '1000', `redesign-${randomUUID()}`);
    for (const [name, path] of [['home', '/'], ['auctions', '/auctions'], ['draws', '/draws'], ['my-bids', '/my-bids'], ['profile', '/profile'], ['bid-payments', '/payments'], ['auction', `/auctions/${auction.slug}`]] as const) {
      if (stage === 'before' && name === 'draws') continue;
      const began = performance.now();
      const response = await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
      await expect(page.locator('.launch-loader')).toHaveCount(0);
      await expect(page.locator('body')).toBeVisible();
      expect(response?.status(), path).toBeLessThan(400);
      timings[`${name}RenderMs`] = Math.round(performance.now() - began);
      await expect(page.locator('.page-loading-backdrop')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow on ${path}`).toBe(true);
      if (stage === 'after' && name === 'home') await expect.poll(() => page.locator('section[aria-labelledby="home-headline"] img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      await page.screenshot({path: `${root}/${name}-${info.project.name}-en.png`, fullPage: true});
      await page.screenshot({path: `${root}/${name}-${info.project.name}-en-viewport.png`});
    }
    if (stage === 'before') {
      await page.getByLabel('Bid number', {exact: true}).fill('3.60');
      await page.getByRole('button', {name: 'Review bid', exact: true}).click();
      const confirmation = page.getByRole('dialog', {name: 'Confirm your bid'});
      await page.screenshot({path: `${root}/bid-confirm-${info.project.name}-en.png`});
      await confirmation.getByRole('checkbox', {name: 'I agree to continue'}).check();
      const began = performance.now();
      await confirmation.getByRole('button', {name: 'Confirm & submit bid'}).click();
      await expect(page.getByRole('heading', {name: '3.60 bid accepted'})).toBeVisible();
      timings.bidConfirmationMs = Math.round(performance.now() - began);
      await page.screenshot({path: `${root}/bid-receipt-${info.project.name}-en.png`});
    }
    if (stage === 'after') {
      await page.goto('/');
      await expect(page.getByRole('button', {name: 'Learn more',exact:true}).first()).toBeVisible();
      await page.getByRole('button', {name: 'Learn more',exact:true}).first().click();
      const learn = page.getByRole('dialog', {name: 'A little different wins'});
      await expect(learn).toBeVisible();
      await expect(learn.locator('ol > li')).toHaveCount(3);
      await expect(learn.locator('iframe')).toHaveCount(0);
      await page.screenshot({path: `${root}/learn-more-${info.project.name}-en.png`});
      await learn.getByRole('button', {name: 'Close', exact: true}).click();
      await expect(page.getByRole('button', {name: 'Learn more',exact:true}).first()).toBeFocused();
      await page.getByRole('link', {name: 'Recent winners', exact: true}).click();
      await expect(page.locator('#recent-winners')).toBeFocused();
      await expect(page.locator('#recent-winners')).toBeInViewport();
      await page.getByRole('button', {name: /^Notifications/}).click();
      const notifications = page.getByRole('dialog', {name: 'Notifications'});
      await expect(notifications).toBeVisible();
      for (const filter of ['All', 'Winners', 'Payments']) await expect(notifications.getByRole('button', {name: filter, exact: true})).toBeVisible();
      await page.screenshot({path: `${root}/notifications-${info.project.name}-en.png`});
      await page.keyboard.press('Escape');
      await expect(notifications).toHaveCount(0);
      await page.goto(`/auctions/${auction.slug}`);
      await page.locator('#bid-review').getByRole('button').click();
      const bidSheet = page.getByRole('dialog', {name: 'Place your bid',exact:true});
      await expect(bidSheet.getByLabel('Your bid number', {exact: true})).toBeVisible();
      await bidSheet.getByLabel('Your bid number', {exact: true}).fill('3.60');
      await page.screenshot({path: `${root}/bid-sheet-${info.project.name}-en.png`});
      const original = page.viewportSize()!;
      await page.setViewportSize({width: original.width, height: 450});
      await bidSheet.getByLabel('Your bid number', {exact: true}).focus();
      await page.screenshot({path: `${root}/bid-sheet-short-viewport-${info.project.name}.png`});
      await expect.poll(() => page.evaluate(() => {const el = document.activeElement!.getBoundingClientRect(); return el.top >= 0 && el.bottom <= innerHeight;})).toBe(true);
      await page.setViewportSize(original);
      await expect(bidSheet.getByRole('radio',{name:'Wallet balance',exact:true})).toBeChecked();await expect(bidSheet).toContainText('1000.00 ETB');await bidSheet.getByRole('radio',{name:'Chapa',exact:true}).check();
      await expect(bidSheet.locator('[data-payment-action]')).toBeDisabled();await expect(bidSheet).toContainText('Payments are not available yet.');
      expect(await client.bid.count({where:{auctionId:auction.id,userId:user.id}})).toBe(0);
      expect((await client.ledgerAccount.findUniqueOrThrow({where:{name:`user:${user.id}:available`}})).balance.toString()).toBe('1000');
      await page.screenshot({path:`${root}/checkout-disabled-funded-${info.project.name}-en.png`});
      await page.keyboard.press('Escape');
      // A historical local fixture exercises receipts, separately from the
      // disabled gateway. Merchant verification is covered in PostgreSQL tests.
      await submitBid(client,{userId:user.id,auctionSlug:auction.slug!,amount:'3.60',feeVersion:1,key:randomUUID()});
      timings.receiptSource='Historical local bid fixture; not an ArifPay browser acceptance';
      await page.goto('/my-bids');
      await page.getByRole('button', {name: 'DEMO wireless headphones, bid details'}).click();
      await expect(page.getByRole('dialog', {name: 'Bid details'})).toContainText('Only the disclosed submission fee was paid.');
      await expect(page.getByRole('dialog', {name: 'Bid details'})).toContainText('Paid at submission');await expect(page.getByRole('dialog', {name: 'Bid details'}).getByRole('link', {name: 'Payment history', exact: true})).toHaveCount(0);
      await page.screenshot({path: `${root}/my-bid-details-${info.project.name}-en.png`});
      await page.getByRole('dialog', {name: 'Bid details'}).getByRole('link', {name: 'Winners', exact: true}).click();
      await expect(page).toHaveURL(/\/winners(?:\?|$)/);
      await expect(page.getByRole('dialog', {name: 'Bid details'})).toHaveCount(0);
      await page.goto('/profile');
      await expect(page.getByText('Existing wallet balance',{exact:true})).toHaveCount(0);
      await expect(page.getByRole('region',{name:'Your wallet',exact:true})).toContainText('970.00 ETB');await expect(page.getByRole('region',{name:'Your wallet',exact:true}).getByRole('link',{name:'Top up wallet',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Bid payments',exact:true})).toHaveCount(0);
      await page.getByRole('button', {name: 'Edit', exact: true}).click();
      const editor = page.getByRole('dialog', {name: 'Edit profile'});
      await expect(editor.getByLabel('Nickname', {exact: true})).toBeVisible();
      await page.screenshot({path: `${root}/profile-edit-${info.project.name}-en.png`});
      await editor.getByLabel('Nickname', {exact: true}).fill('DEMO review player');
      await editor.getByRole('button', {name: 'Save profile', exact: true}).click();
      await expect(page.getByText('Profile saved.', {exact: true})).toBeVisible();
      expect((await client.telegramOwnContact.findUniqueOrThrow({where: {userId: user.id}})).telegramId).toBe(String(telegramId));
      // An account without historical funds takes the exact same direct path.
      const zeroId = randomInt(7000000000, 8000000000);
      await verifyFixtureContact(client, zeroId);
      const zeroContext = await browser.newContext({viewport: original, baseURL: origin, ignoreHTTPSErrors: true, storageState: ENGLISH_UI_STATE});
      try {
        const zero = await zeroContext.newPage();
        await zero.route('https://telegram.org/**', route => route.fulfill({body: ''}));
        await zero.addInitScript(({data}) => {window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};}, {data: signedLaunch({user: JSON.stringify({id: zeroId, first_name: 'Zero balance fixture'})}, process.env.TELEGRAM_BOT_TOKEN)});
        await zero.goto(`/auctions/${auction.slug}`);
        await expect(zero.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
        await expect(zero.locator('#bid-review').getByRole('button')).toBeVisible();
        await zero.locator('#bid-review').getByRole('button').click();
        const zeroSheet=zero.getByRole('dialog',{name:'Place your bid',exact:true});await zeroSheet.getByLabel('Your bid number', {exact: true}).fill('7.31');
        await expect(zeroSheet.getByRole('radio',{name:'Wallet balance',exact:true})).toBeChecked();await expect(zeroSheet).toContainText('Your balance is below this submission fee.');await expect(zeroSheet.locator('[data-payment-action]')).toBeDisabled();
        await zero.screenshot({path: `${root}/checkout-disabled-${info.project.name}-en.png`});
        // Current Wallet/Chapa controls remain read-only until merchant
        // activation. Provider recovery/idempotency stays covered by DB tests;
        // this browser verifies actual visible options and balance recovery.
        const financialPosts:string[]=[];zero.on('request',request=>{if(request.method()==='POST'&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/top-ups)/.test(new URL(request.url()).pathname))financialPosts.push(request.url())});
        await zeroSheet.getByRole('radio',{name:'Chapa',exact:true}).check();await expect(zeroSheet.locator('[data-payment-action]')).toContainText('with Chapa');await expect(zeroSheet.locator('[data-payment-action]')).toBeDisabled();
        await zero.screenshot({path: `${root}/checkout-options-fixture-${info.project.name}.png`});
        await zeroSheet.getByRole('link',{name:'Top up wallet',exact:true}).click();const topUp=zero.getByRole('dialog',{name:'Top up wallet',exact:true});await expect(topUp).toBeVisible();await topUp.getByRole('button',{name:'100.00 ETB',exact:true}).click();await expect(topUp.locator('[data-payment-action]')).toBeDisabled();await zero.keyboard.press('Escape');await expect(topUp).toHaveCount(0);await expect(zeroSheet.getByLabel('Your bid number',{exact:true})).toHaveValue('7.31');
        let balanceRefreshes=0;await zero.route('**/api/wallet',route=>{balanceRefreshes++;return route.fulfill({status:503,json:{error:'Explicit balance transport fixture'}})});await zero.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));await expect(zeroSheet).toContainText('Showing the saved balance. Refresh failed.');expect(balanceRefreshes).toBe(1);await expect(zeroSheet.locator('[data-payment-action]')).toBeDisabled();
        await zero.unroute('**/api/wallet');await zeroSheet.getByRole('button',{name:'Retry',exact:true}).click();await expect(zeroSheet.getByText('Showing the saved balance. Refresh failed.',{exact:false})).toHaveCount(0);await expect(zeroSheet.locator('[data-payment-action]')).toBeDisabled();expect(financialPosts).toEqual([]);
        const zeroUser = await client.user.findUniqueOrThrow({where: {telegramId: String(zeroId)}});
        expect(await client.arifPayCheckout.count({where: {userId: zeroUser.id}})).toBe(0);expect(await client.bid.count({where:{userId:zeroUser.id}})).toBe(0);
      } finally {await zeroContext.close();}
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.goto('/');
      await page.getByRole('link', {name: 'Recent winners', exact: true}).click();
      await expect(page.locator('#recent-winners')).toBeFocused();
      const network = await page.context().newCDPSession(page);
      await network.send('Network.enable');
      await network.send('Network.setCacheDisabled', {cacheDisabled: true});
      await network.send('Network.emulateNetworkConditions', {offline: false, latency: 150, downloadThroughput: 160000, uploadThroughput: 75000});
      const slowBegan = performance.now();
      await page.goto('/');
      await expect(page.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
      await expect(page.getByRole('button', {name: 'Learn more',exact:true}).first()).toBeVisible();
      timings.slowConnectionHomeMs = Math.round(performance.now() - slowBegan);
      timings.slowConnection = 'Chromium simulated 150ms latency, 1.28Mbps down/600kbps up, browser cache disabled; one sample';
      await network.send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
      await network.send('Network.setCacheDisabled', {cacheDisabled: false});
      await network.detach();
    }
    const navigationBegan = performance.now();
    await page.getByRole('navigation', {name: 'Your navigation'}).getByRole('link', {name: 'My Bids', exact: true}).click();
    await expect(page).toHaveURL(/\/my-bids(?:\?|$)/);
    await expect(page.getByRole('heading', {name: 'My Bids', exact: true})).toBeVisible();
    timings.clientNavigationToMyBidsMs = Math.round(performance.now() - navigationBegan);
    if (stage === 'before') {
      const network = await page.context().newCDPSession(page);
      await network.send('Network.enable');
      await network.send('Network.setCacheDisabled', {cacheDisabled: true});
      await network.send('Network.emulateNetworkConditions', {offline: false, latency: 150, downloadThroughput: 160000, uploadThroughput: 75000});
      const slowBegan = performance.now();
      await page.goto('/');
      await expect(page.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
      timings.slowConnectionHomeMs = Math.round(performance.now() - slowBegan);
      timings.slowConnection = 'Chromium simulated 150ms latency, 1.28Mbps down/600kbps up, browser cache disabled; one sample';
      await network.send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
      await network.send('Network.setCacheDisabled', {cacheDisabled: false});
      await network.detach();
    }
    // Same public/private endpoints and sample count before/after. These are loopback observations.
    for (const endpoint of ['/api/me', '/api/alerts', `/api/catalog/auctions/${auction.slug}`]) {
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {const began = performance.now(); const r = await page.request.get(endpoint); expect(r.status()).toBe(200); await r.body(); samples.push(performance.now() - began);}
      samples.sort((a, b) => a - b);
      timings[endpoint] = {n: samples.length, p50Ms: Math.round(samples[9]), p95Ms: Math.round(samples[18]), maxMs: Math.round(samples[19])};
    }
    if(stage==='after'){
      await page.goto('/wallet?tab=transactions&type=activity');
      await expect(page).toHaveURL(/\/profile#wallet$/);
      await expect(page.getByRole('region',{name:'Your wallet',exact:true})).toContainText('970.00 ETB');
      expect((await page.request.get('/api/wallet')).status()).toBe(200);
      const oldBid=await page.request.post(`/api/auctions/${auction.slug}/bids`,{headers:{origin},data:{amount:'9.50',feeVersion:1,key:randomUUID()}});
      expect(oldBid.status()).toBe(410);
      expect(walletReads.length).toBeGreaterThan(0);
    }
    await page.context().addCookies([{name: 'lowwin-language', value: 'am', domain: 'localhost', path: '/'}]);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({path: `${root}/home-${info.project.name}-am.png`, fullPage: true});
    if (stage === 'after') {
      await page.getByRole('button', {name: 'ተጨማሪ ይወቁ',exact:true}).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({path: `${root}/learn-more-${info.project.name}-am.png`});
      await page.keyboard.press('Escape');
      for (const [name, href] of [['winners', '/winners'], ['my-bids', '/my-bids'], ['profile', '/profile'], ['home', '/']] as const) {
        const destination=href==='/'?'መነሻ':href==='/winners'?'አሸናፊዎች':href==='/my-bids'?'ጨረታዎቼ':'መገለጫ';
        await page.getByRole('navigation', {name: 'Your navigation'}).getByRole('link',{name:destination,exact:true}).click();
        await expect(page).toHaveURL(new RegExp(`${href}(?:[?#]|$)`));
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Amharic overflow on ${href}`).toBe(true);
        await page.screenshot({path: `${root}/${name}-${info.project.name}-am.png`, fullPage: true});
        await page.screenshot({path: `${root}/${name}-${info.project.name}-am-viewport.png`});
        if(name==='my-bids'){
          await page.getByRole('button',{name:/^DEMO wireless headphones,/}).click();
          const receipt=page.getByRole('dialog',{name:'የጨረታ ዝርዝር'});
          await expect(receipt).toBeVisible();
          await receipt.getByRole('link',{name:'አሸናፊዎች',exact:true}).scrollIntoViewIfNeeded();
          for(const link of await receipt.getByRole('link').all()){const box=await link.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44)}
          expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await page.screenshot({path:`${root}/my-bid-details-${info.project.name}-am.png`});
          await page.keyboard.press('Escape');
        }
      }
    }
    timings.reconciliationDrift = (await reconcile(client)).length;
    timings.browserErrors = errors;
    writeFileSync(`${root}/timings-${info.project.name}.json`, JSON.stringify(timings, null, 2));
    expect(timings.reconciliationDrift).toBe(0);
    expect(errors).toEqual([]);
  } finally {await client.$disconnect();}
});

test('launch failure exits the spinner and Retry opens the app', async ({page}, info) => {
  test.skip(stage !== 'after', 'Final recovery regression');
  const client = new PrismaClient({datasourceUrl: process.env.TEST_DATABASE_URL});
  try {
    const telegramId = randomInt(8000000000, 9000000000);
    await verifyFixtureContact(client, telegramId);
    await page.route('https://telegram.org/**', route => route.fulfill({body: ''}));
    await page.addInitScript(({data}) => {window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};}, {data: signedLaunch({user: JSON.stringify({id: telegramId, first_name: 'Recovery fixture'})}, process.env.TELEGRAM_BOT_TOKEN)});
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route('**/api/auth/telegram/miniapp/signin', async route => {await gate; await route.fulfill({status: 503, json: {error: 'Connection interrupted. Please retry.'}});});
    await page.goto('/telegram');
    await expect(page.locator('.launch-loader')).toBeVisible();
    await page.screenshot({path: `${root}/launch-loading-${info.project.name}.png`});
    release();
    await expect(page.getByRole('button', {name: 'Retry connection'})).toBeVisible();
    await expect(page.locator('.launch-loader')).toHaveCount(0);
    await page.screenshot({path: `${root}/launch-error-${info.project.name}.png`});
    await page.unroute('**/api/auth/telegram/miniapp/signin');
    await page.getByRole('button', {name: 'Retry connection'}).click();
    await expect(page.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
  } finally {await client.$disconnect();}
});
