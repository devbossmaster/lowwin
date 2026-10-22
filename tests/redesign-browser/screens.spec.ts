import {test, expect} from '@playwright/test';
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
  const client = new PrismaClient({datasourceUrl: process.env.TEST_DATABASE_URL});
  mkdirSync(root, {recursive: true});
  const errors: string[] = [];
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
    // Test fixture issuance remains confined to this disposable database.
    Object.assign(process.env, {DEV_POINTS_ENABLED: 'true', NODE_ENV: 'test'});
    await creditDevelopmentPoints(client, user.id, '1000', `redesign-${randomUUID()}`);
    for (const [name, path] of [['home', '/'], ['auctions', '/auctions'], ['draws', '/draws'], ['my-bids', '/my-bids'], ['profile', '/profile'], ['wallet-history', '/wallet'], ['auction', `/auctions/${auction.slug}`]] as const) {
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
      if (stage === 'after' && name === 'home') await expect.poll(() => page.locator('section[aria-label="Lowin"] img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
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
      await expect(page.getByRole('button', {name: 'Learn more'})).toBeVisible();
      await page.getByRole('button', {name: 'Learn more'}).click();
      const learn = page.getByRole('dialog', {name: 'A little different wins'});
      await expect(learn).toBeVisible();
      await expect(learn.locator('ol > li')).toHaveCount(3);
      await expect(learn.locator('iframe')).toHaveCount(0);
      await page.screenshot({path: `${root}/learn-more-${info.project.name}-en.png`});
      await learn.getByRole('button', {name: 'Close', exact: true}).click();
      await expect(page.getByRole('button', {name: 'Learn more'})).toBeFocused();
      await page.getByRole('link', {name: 'Recent winners', exact: true}).click();
      await expect(page.locator('#recent-winners')).toBeFocused();
      await expect(page.locator('#recent-winners')).toBeInViewport();
      await page.getByRole('button', {name: /^Notifications/}).click();
      const notifications = page.getByRole('dialog', {name: 'Notifications'});
      await expect(notifications).toBeVisible();
      for (const filter of ['All', 'Draws', 'Payments']) await expect(notifications.getByRole('button', {name: filter, exact: true})).toBeVisible();
      await page.screenshot({path: `${root}/notifications-${info.project.name}-en.png`});
      await page.keyboard.press('Escape');
      await expect(notifications).toHaveCount(0);
      await page.goto(`/auctions/${auction.slug}`);
      await page.getByRole('button', {name: 'Choose your bid number', exact: true}).click();
      const bidSheet = page.getByRole('dialog', {name: 'Your next bid'});
      await expect(bidSheet.getByLabel('Bid number', {exact: true})).toBeVisible();
      await bidSheet.getByLabel('Bid number', {exact: true}).fill('3.60');
      await page.screenshot({path: `${root}/bid-sheet-${info.project.name}-en.png`});
      const original = page.viewportSize()!;
      await page.setViewportSize({width: original.width, height: 450});
      await bidSheet.getByLabel('Bid number', {exact: true}).focus();
      await page.screenshot({path: `${root}/bid-sheet-short-viewport-${info.project.name}.png`});
      await expect.poll(() => page.evaluate(() => {const el = document.activeElement!.getBoundingClientRect(); return el.top >= 0 && el.bottom <= innerHeight;})).toBe(true);
      await page.setViewportSize(original);
      await bidSheet.getByRole('button', {name: 'Review bid', exact: true}).click();
      const confirmation = page.getByRole('dialog', {name: 'Confirm your bid'});
      await expect(confirmation).toContainText('Your bid number is not money and is never charged.');
      await page.screenshot({path: `${root}/bid-confirm-${info.project.name}-en.png`});
      await confirmation.getByRole('checkbox', {name: 'I agree to continue'}).check();
      const bidBegan = performance.now();
      await confirmation.getByRole('button', {name: 'Confirm & submit bid'}).click();
      await expect(bidSheet.getByRole('heading', {name: '3.60 bid accepted'})).toBeVisible();
      timings.bidConfirmationMs = Math.round(performance.now() - bidBegan);
      await expect(bidSheet).toContainText('ETB 970.00');
      expect((await client.auctionHold.findMany({where: {auctionId: auction.id}}))).toHaveLength(0);
      await page.screenshot({path: `${root}/bid-receipt-${info.project.name}-en.png`});
      await page.keyboard.press('Escape');
      await page.goto('/my-bids');
      await page.getByRole('button', {name: 'DEMO wireless headphones, bid details'}).click();
      await expect(page.getByRole('dialog', {name: 'Bid details'})).toContainText('Only the disclosed submission fee was deducted.');
      await page.screenshot({path: `${root}/my-bid-details-${info.project.name}-en.png`});
      await page.keyboard.press('Escape');
      await page.goto('/profile');
      await page.getByRole('button', {name: 'Edit', exact: true}).click();
      const editor = page.getByRole('dialog', {name: 'Edit profile'});
      await expect(editor.getByLabel('Display name', {exact: true})).toBeVisible();
      await page.screenshot({path: `${root}/profile-edit-${info.project.name}-en.png`});
      await editor.getByLabel('Display name', {exact: true}).fill('DEMO review player');
      await editor.getByRole('button', {name: 'Save profile', exact: true}).click();
      await expect(page.getByText('Profile saved.', {exact: true})).toBeVisible();
      expect((await client.telegramOwnContact.findUniqueOrThrow({where: {userId: user.id}})).telegramId).toBe(String(telegramId));
      // A second real local account has no fixture issuance: insufficient balance
      // must lead to the disabled checkout, without opening a deposit screen.
      const zeroId = randomInt(7000000000, 8000000000);
      await verifyFixtureContact(client, zeroId);
      const zeroContext = await browser.newContext({viewport: original, baseURL: origin, ignoreHTTPSErrors: true, storageState: ENGLISH_UI_STATE});
      try {
        const zero = await zeroContext.newPage();
        await zero.route('https://telegram.org/**', route => route.fulfill({body: ''}));
        await zero.addInitScript(({data}) => {window.Telegram = {WebApp: {initData: data, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}}};}, {data: signedLaunch({user: JSON.stringify({id: zeroId, first_name: 'Zero balance fixture'})}, process.env.TELEGRAM_BOT_TOKEN)});
        await zero.goto(`/auctions/${auction.slug}`);
        await expect(zero.getByRole('navigation', {name: 'Your navigation'})).toBeVisible();
        await expect(zero.getByRole('button', {name: 'Choose your bid number', exact: true})).toBeVisible();
        await zero.getByRole('button', {name: 'Choose your bid number', exact: true}).click();
        await zero.getByLabel('Bid number', {exact: true}).fill('7.31');
        await expect(zero.getByText('Insufficient balance.', {exact: false})).toBeVisible();
        await zero.getByRole('button', {name: 'Pay & bid', exact: true}).click();
        await expect(zero.getByText('Direct checkout is not available yet.', {exact: false})).toBeVisible();
        await expect(zero.getByRole('button', {name: /^Pay ETB/})).toHaveCount(0);
        await zero.screenshot({path: `${root}/checkout-disabled-${info.project.name}-en.png`});
        // Browser fixtures below exercise rendering/retry only. No provider is
        // called and these mocked states are excluded from speed claims.
        await zero.keyboard.press('Escape');
        const orderId = randomUUID(), createBodies: string[] = [];
        let mockStatus = 'PENDING';
        const order = () => ({id: orderId, auctionSlug: auction.slug, amount: '7.32', feeVersion: 1, fee: '30', currency: 'ETB', channel: 'MPESA', status: mockStatus, reason: mockStatus === 'NEEDS_REVIEW' ? 'PROVIDER_CONFIRMATION_REQUIRED' : 'AWAITING_PROVIDER', receipt: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), pollAfterMs: 60000, fundsPreserved: false});
        await zero.route('**/api/payments/arifpay', route => route.fulfill({json: {enabled: true, reason: null}}));
        await zero.route('**/api/payments/arifpay/checkouts', route => {
          if (route.request().method() === 'GET') return route.fulfill({json: {items: []}});
          createBodies.push(route.request().postData()!);
          return createBodies.length === 1 ? route.abort('failed') : route.fulfill({json: order()});
        });
        await zero.route('**/api/payments/arifpay/checkouts/*', route => route.fulfill({json: order()}));
        await zero.getByRole('button', {name: 'Choose your bid number', exact: true}).click();
        await zero.getByLabel('Bid number', {exact: true}).fill('7.32');
        await zero.getByRole('button', {name: 'Pay & bid', exact: true}).click();
        await expect(zero.getByRole('button', {name: 'Telebirr', exact: true})).toBeVisible();
        await zero.getByRole('button', {name: 'M-PESA', exact: true}).click();
        const phone = zero.getByLabel('Payment phone number', {exact: true});
        await phone.fill('0712345678');
        await zero.getByRole('checkbox', {name: /I agree to pay the non-refundable/}).check();
        await zero.screenshot({path: `${root}/checkout-options-fixture-${info.project.name}.png`});
        await zero.getByRole('button', {name: 'Pay ETB 30.00 & bid', exact: true}).click();
        await expect(zero.getByRole('button', {name: 'Retry original request', exact: true})).toBeVisible();
        await expect(phone).toBeDisabled();
        await expect(zero.getByRole('button', {name: 'Telebirr', exact: true})).toBeDisabled();
        await zero.getByRole('button', {name: 'Retry original request', exact: true}).click();
        await expect(zero.getByText('Confirm on your phone', {exact: true})).toBeVisible();
        expect(createBodies).toHaveLength(2);
        expect(createBodies[1]).toBe(createBodies[0]);
        await zero.screenshot({path: `${root}/checkout-pending-fixture-${info.project.name}.png`});
        mockStatus = 'NEEDS_REVIEW';
        await zero.getByRole('button', {name: 'Check status', exact: true}).click();
        await expect(zero.getByText('Needs review', {exact: true})).toBeVisible();
        await expect(zero.getByText('This is not an accepted bid.', {exact: false})).toBeVisible();
        await zero.screenshot({path: `${root}/checkout-review-fixture-${info.project.name}.png`});
        const zeroUser = await client.user.findUniqueOrThrow({where: {telegramId: String(zeroId)}});
        expect(await client.arifPayCheckout.count({where: {userId: zeroUser.id}})).toBe(0);
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
      await expect(page.getByRole('button', {name: 'Learn more'})).toBeVisible();
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
    await page.context().addCookies([{name: 'lowwin-language', value: 'am', domain: 'localhost', path: '/'}]);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({path: `${root}/home-${info.project.name}-am.png`, fullPage: true});
    if (stage === 'after') {
      await page.getByRole('button', {name: 'ተጨማሪ ይወቁ'}).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({path: `${root}/learn-more-${info.project.name}-am.png`});
      await page.keyboard.press('Escape');
      for (const [name, href] of [['draws', '/draws'], ['my-bids', '/my-bids'], ['profile', '/profile'], ['auctions', '/auctions/all']] as const) {
        await page.getByRole('navigation', {name: 'Your navigation'}).locator(`a[href="${href}"]`).click();
        await expect(page).toHaveURL(new RegExp(`${href}(?:\\?|$)`));
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Amharic overflow on ${href}`).toBe(true);
        await page.screenshot({path: `${root}/${name}-${info.project.name}-am.png`, fullPage: true});
        await page.screenshot({path: `${root}/${name}-${info.project.name}-am-viewport.png`});
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
