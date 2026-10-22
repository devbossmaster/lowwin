import {defineConfig} from '@playwright/test';
import {ENGLISH_UI_STATE, TEST_TOKEN} from './tests/helpers';

const database = process.env.TEST_DATABASE_URL ?? '';
const url = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
  throw Error('Redesign browser checks require an explicit disposable loopback _test database');
}
const port = 3137;
const production = process.env.REDESIGN_PRODUCTION === '1';
const origin = `${production ? 'https' : 'http'}://localhost:${port}`;
const env = {
  DATABASE_URL: database, DIRECT_URL: database, APP_ENV: 'local', LOWIN_UI_TEST_MODE: 'local',
  BETTER_AUTH_URL: origin, MINI_APP_URL: origin,
  BETTER_AUTH_SECRET: 'local-redesign-auth-secret-at-least-thirty-two-characters',
  TELEGRAM_BOT_TOKEN: '123456789:local_redesign_test_token_20261022', TELEGRAM_BOT_USERNAME: 'lowin_fixture_bot',
  TELEGRAM_WEBHOOK_SECRET: 'redesign-local-webhook-secret-20261022',
  DEV_IDENTITY_ENABLED: 'false', DEV_POINTS_ENABLED: 'false',
  PHONE_CONTACT_KEY_ID: 'local-fixture', PHONE_CONTACT_KEYS: JSON.stringify({'local-fixture': 'e'.repeat(64)}),
  PHONE_CONTACT_HASH_KEY: 'f'.repeat(64), PAYMENTS_LIVE_ENABLED: 'false', ARIFPAY_ENABLED: 'false',
};
Object.assign(process.env, env);
const directory = process.env.REDESIGN_SOURCE_DIR ?? '.';
const nextCli = process.env.REDESIGN_NEXT_CLI ?? 'node_modules/next/dist/bin/next';
export default defineConfig({
  testDir: './tests/redesign-browser', outputDir: 'test-results/redesign', workers: 1,
  timeout: 480000, expect: {timeout: 60000},
  reporter: [['list'], ['json', {outputFile: `test-results/redesign/${process.env.REDESIGN_STAGE ?? 'after'}.json`}]],
  use: {storageState: ENGLISH_UI_STATE, baseURL: origin, ignoreHTTPSErrors: true, browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}), trace: 'retain-on-failure'},
  webServer: {
    command: production ? 'node scripts/redesign-https-server.mjs' : `node "${nextCli}" dev "${directory}" --webpack --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/api/health/live`, ignoreHTTPSErrors: true, env: {...env, REDESIGN_SOURCE_DIR: directory}, timeout: 120000, reuseExistingServer: false,
  },
  projects: [{name: '360', use: {viewport: {width: 360, height: 800}}}, {name: '430', use: {viewport: {width: 430, height: 932}}}],
});
