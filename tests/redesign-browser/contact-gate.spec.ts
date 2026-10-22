import {test, expect, type Page, type TestInfo} from '@playwright/test';

const timeoutCopy = 'Telegram contact confirmation took too long. Check the bot, then try again.';
type ContactFixture = {callbacks: Array<(shared: boolean) => void>; closes: number; opened: string[]};
type FixtureWindow = Window & {__contactGateFixture: ContactFixture};

async function fixture(page: Page) {
  const calls = {signIn: 0, contactChecks: 0, botPrompts: 0, accounts: 0};
  const unexpected: string[] = [], errors: string[] = [];
  let releaseAuthentication!: () => void;
  const authenticationReady = new Promise<void>(resolve => { releaseAuthentication = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://telegram.org/**', route => route.fulfill({contentType: 'application/javascript', body: ''}));
  // These are explicit browser fixtures. No API request is allowed to reach a
  // real account, contact record, bot, or database-backed application endpoint.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/telegram/miniapp/signin') {
      calls.signIn++;
      await authenticationReady;
      return route.fulfill({json: {status: 'contact-required', me: null}});
    }
    if (path === '/api/onboarding/contact') {
      if (route.request().method() === 'GET') {
        calls.contactChecks++;
        return route.fulfill({json: {verified: false, masked: null}});
      }
      calls.botPrompts++;
      return route.fulfill({json: {sent: true}});
    }
    if (path === '/api/me') {
      calls.accounts++;
      return route.fulfill({status: 401, json: {error: 'Fixture contact is not verified'}});
    }
    unexpected.push(`${route.request().method()} ${path}`);
    return route.fulfill({status: 503, json: {error: 'Unexpected API request blocked by browser fixture'}});
  });
  await page.addInitScript(() => {
    const state: ContactFixture = {callbacks: [], closes: 0, opened: []};
    (window as unknown as FixtureWindow).__contactGateFixture = state;
    window.Telegram = {WebApp: {
      initData: 'contact-required-browser-fixture', platform: 'android',
      ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
      isVersionAtLeast() { return true; },
      requestContact(callback) { state.callbacks.push(callback); },
      close() { state.closes++; },
      openTelegramLink(url) { state.opened.push(url); },
    }};
  });
  await page.goto('/telegram');
  await expect.poll(() => calls.signIn).toBeGreaterThan(0);
  // Hydrate with the browser's real clock. Holding the fixture sign-in response
  // lets us install virtual time before ContactGate creates its SDK watchdog.
  await page.clock.install();
  releaseAuthentication();
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__contactGateFixture.callbacks.length)).toBe(1);
  // Let hydration run normally, then pause before advancing the SDK watchdog.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  return {calls, unexpected, errors};
}

async function respond(page: Page, index: number, shared: boolean) {
  await page.evaluate(({index, shared}) => (window as unknown as FixtureWindow).__contactGateFixture.callbacks[index](shared), {index, shared});
}
async function timedOut(page: Page) {
  await page.clock.fastForward(30_100);
  await expect(page.locator('main').getByRole('alert')).toHaveText(timeoutCopy);
  await expect(page.locator('.launch-loader')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeEnabled();
}
async function capture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const label of ['Try again', 'Cancel & close']) {
    const bounds = await page.getByRole('button', {name: label, exact: true}).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  const path = info.outputPath(`${name}-${info.project.name}.png`);
  await page.screenshot({path, fullPage: true});
  await info.attach(name, {path, contentType: 'image/png'});
}

test('missing native contact callback times out with usable recovery controls', async ({page}, info) => {
  const state = await fixture(page);
  await page.clock.fastForward(29_000);
  await expect(page.locator('.launch-loader')).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await page.clock.fastForward(1_100);
  await expect(page.locator('main').getByRole('alert')).toHaveText(timeoutCopy);
  await expect(page.locator('.launch-loader')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeEnabled();
  await expect(page.getByRole('link', {name: 'Open the bot', exact: true})).toHaveAttribute('href', 'https://t.me/lowin_fixture_bot?start=lowin');
  await expect(page.getByRole('button', {name: 'Cancel & close', exact: true})).toBeEnabled();
  await expect(page.getByRole('navigation', {name: 'Your navigation'})).toHaveCount(0);
  await capture(page, info, 'contact-native-timeout');
  expect(state.calls.accounts).toBe(0);
  expect(state.calls.botPrompts).toBe(0);
  expect(state.calls.signIn).toBeGreaterThan(0);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('retired callbacks cannot affect a retry or cancel-and-close recovery', async ({page}, info) => {
  const state = await fixture(page);
  await timedOut(page);
  const checksAtTimeout = state.calls.contactChecks;
  await respond(page, 0, true);
  await respond(page, 0, false);
  await expect(page.locator('main').getByRole('alert')).toHaveText(timeoutCopy);
  expect(state.calls.contactChecks).toBe(checksAtTimeout);

  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__contactGateFixture.callbacks.length)).toBe(2);
  await expect(page.locator('.launch-loader')).toBeVisible();
  const checksAtRetry = state.calls.contactChecks;
  await respond(page, 0, true);
  await respond(page, 0, false);
  await expect(page.locator('.launch-loader')).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  expect(state.calls.contactChecks).toBe(checksAtRetry);
  expect(state.calls.botPrompts).toBe(0);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__contactGateFixture.closes)).toBe(0);

  await timedOut(page);
  await page.getByRole('button', {name: 'Cancel & close', exact: true}).click();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__contactGateFixture.closes)).toBe(1);
  await respond(page, 1, true);
  await respond(page, 1, false);
  await respond(page, 0, true);
  await page.clock.fastForward(60_000);
  await expect(page.locator('main').getByRole('alert')).toHaveText(timeoutCopy);
  expect(state.calls.contactChecks).toBe(checksAtRetry);
  expect(state.calls.botPrompts).toBe(0);
  expect(state.calls.accounts).toBe(0);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__contactGateFixture.closes)).toBe(1);
  await capture(page, info, 'contact-canceled-retry');
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('native approval still requires server contact verification and ignores duplicate callback delivery', async ({page}) => {
  const state = await fixture(page);
  const before = state.calls.contactChecks;
  await respond(page, 0, true);
  await expect.poll(() => state.calls.contactChecks).toBe(before + 1);
  await respond(page, 0, false);
  await respond(page, 0, true);
  await expect(page.locator('.launch-loader')).toBeVisible();
  await expect(page.getByRole('navigation', {name: 'Your navigation'})).toHaveCount(0);
  expect(state.calls.accounts).toBe(0);
  expect(state.calls.botPrompts).toBe(0);
  expect(state.calls.contactChecks).toBe(before + 1);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__contactGateFixture.closes)).toBe(0);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});
