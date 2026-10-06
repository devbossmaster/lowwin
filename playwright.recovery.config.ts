import {defineConfig} from '@playwright/test';
import {ENGLISH_UI_STATE,TEST_TOKEN} from './tests/helpers';

const database='postgresql://fixture@127.0.0.1:9/recovery_test';
const env={
  APP_ENV:'local',DATABASE_URL:database,DIRECT_URL:database,
  LOWWIN_BROWSER_WEBPACK:'1',LOWIN_UI_TEST_MODE:'local',
  BETTER_AUTH_URL:'http://localhost:3116',MINI_APP_URL:'http://localhost:3116',
  BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',
  TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',
  TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',
  PHONE_CONTACT_KEY_ID:'local-fixture',PHONE_CONTACT_KEYS:JSON.stringify({'local-fixture':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),
  DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',
};

export default defineConfig({
  testDir:'./tests/recovery-browser',outputDir:'test-results/recovery',workers:1,
  timeout:90000,expect:{timeout:20000},reporter:'list',
  use:{storageState:ENGLISH_UI_STATE,baseURL:'http://localhost:3116',browserName:'chromium',channel:process.env.LOWWIN_PLAYWRIGHT_CHANNEL||'chrome',trace:'retain-on-failure'},
  globalSetup:'./tests/browser-server-setup.ts',metadata:{testServers:[{kind:'next',port:3116,env}]},
  projects:[
    {name:'mobile-360',use:{viewport:{width:360,height:800}}},
    {name:'laptop',use:{viewport:{width:1366,height:900}}},
  ],
});
