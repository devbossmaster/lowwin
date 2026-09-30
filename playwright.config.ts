import { defineConfig } from '@playwright/test';
import { LOCAL_ACCESS_KEY, TEST_TOKEN } from './tests/helpers';
const database = process.env.TEST_DATABASE_URL ?? 'postgresql://fixture@127.0.0.1:9/absent_test';
if (process.env.TEST_DATABASE_URL) {
  const url = new URL(database);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Browser identity tests require a disposable loopback _test database');
}
Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,APP_ENV:'local',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'local-fixture',PHONE_CONTACT_KEYS:JSON.stringify({'local-fixture':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64)});
const env = { APP_ENV:'local', DATABASE_URL:database, DIRECT_URL:database,
  BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters', TELEGRAM_BOT_TOKEN:TEST_TOKEN,
  TELEGRAM_BOT_USERNAME:'lowin_fixture_bot', TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',
  DEV_IDENTITY_ENABLED:'true', DEV_IDENTITY_ACCESS_KEY:LOCAL_ACCESS_KEY, DEV_POINTS_ENABLED:'false',
  WALLET_TEST_PREVIEW:'true',ADMIN_MFA_KEY:'b'.repeat(64),EMAIL_TRANSPORT:'local-sink',EMAIL_SINK_URL:'http://127.0.0.1:8027',
};
export default defineConfig({outputDir:'test-results/full-browser',
  testDir:'./tests/browser', workers:1, expect:{timeout:20000}, timeout:120000, use:{baseURL:'http://localhost:3107',browserName:'chromium',channel:process.env.LOWWIN_PLAYWRIGHT_CHANNEL||undefined},
  globalSetup:'./tests/browser-server-setup.ts',
  metadata:{testServers:[
    {kind:'email',port:8027,env},
    {kind:'next',port:3107,env:{...env,LOWIN_UI_TEST_MODE:'local',BETTER_AUTH_URL:'http://localhost:3107',MINI_APP_URL:'http://localhost:3107'}},
    {kind:'next',port:3108,env:{...env,LOWIN_UI_TEST_MODE:'tunnel',BETTER_AUTH_URL:'https://lowin.ngrok-free.app',MINI_APP_URL:'https://lowin.ngrok-free.app'}},
  ]},
  projects:[{name:'mobile-360',testIgnore:'**/admin.spec.ts',use:{viewport:{width:360,height:800}}},{name:'mobile-430',testIgnore:'**/admin.spec.ts',use:{viewport:{width:430,height:932}}},{name:'admin-laptop',testMatch:'**/admin.spec.ts',use:{viewport:{width:1366,height:900}}},{name:'admin-tablet',testMatch:'**/admin.spec.ts',use:{viewport:{width:834,height:1112}}}],
});
