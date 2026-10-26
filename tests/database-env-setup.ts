import {expect} from 'vitest';
import {TEST_TOKEN} from './helpers';

// Resolve each isolated suite's datasource before importing application modules.
// Several server modules initialize their Prisma pool at import time; changing
// DATABASE_URL in beforeAll is too late for those modules.
const filename = (expect.getState().testPath ?? '').replaceAll('\\', '/').split('/').at(-1) ?? '';
const group: Record<string, string> = {
  'bids.test.ts': 'BID_TEST_DATABASE_URL', 'submission-fee.test.ts': 'BID_TEST_DATABASE_URL',
  'settlement.test.ts': 'SETTLEMENT_TEST_DATABASE_URL', 'settlement-v2.test.ts': 'SETTLEMENT_TEST_DATABASE_URL',
  'settlement-v3.test.ts': 'SETTLEMENT_TEST_DATABASE_URL', 'personal.test.ts': 'PERSONAL_TEST_DATABASE_URL',
  'admin.test.ts': 'ADMIN_TEST_DATABASE_URL', 'operations.test.ts': 'OPS_TEST_DATABASE_URL',
  'payments.test.ts': 'PAYMENT_TEST_DATABASE_URL', 'payment-session.test.ts': 'PAYMENT_TEST_DATABASE_URL',
  'admin-wallet-credit.test.ts': 'ADMIN_CREDIT_TEST_DATABASE_URL',
  'auction-activity.test.ts': 'ACTIVITY_TEST_DATABASE_URL', 'arifpay-checkout.test.ts': 'ARIFPAY_TEST_DATABASE_URL',
  'chapa-checkout.test.ts':'CHAPA_TEST_DATABASE_URL',
  'catalog-workflow.test.ts': 'CATALOG_WORKFLOW_TEST_DATABASE_URL',
  'catalog.test.ts': 'CATALOG_TEST_DATABASE_URL',
  'referral-rewards.test.ts': 'REFERRAL_TEST_DATABASE_URL',
  'result-breakdown.test.ts': 'RESULT_TEST_DATABASE_URL',
};
const database = process.env[group[filename] ?? 'TEST_DATABASE_URL'];
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw Error('Database test setup only accepts disposable loopback _test databases');
  }
  process.env.DATABASE_URL = process.env.DIRECT_URL = database;
  process.env.APP_ENV = 'local';
  // These fixtures exercise signed/contact-bound paths without any bot/provider
  // network requests. Do not depend on a developer .env or deployment secrets.
  if(['referral-rewards.test.ts','result-breakdown.test.ts','chapa-checkout.test.ts'].includes(filename))Object.assign(process.env,{
    NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',
    BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',
    BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',
    TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',
    TELEGRAM_WEBHOOK_SECRET:'fixture-contact-webhook-secret-thirty-two',
    PHONE_CONTACT_KEY_ID:'fixture-test',PHONE_CONTACT_KEYS:JSON.stringify({'fixture-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),
    REFERRAL_REWARDS_SCHEMA_READY:filename==='referral-rewards.test.ts'?'true':'false',
  });
}
