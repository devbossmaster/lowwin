import {expect} from 'vitest';
import {TEST_TOKEN} from './helpers';

// Resolve each isolated suite's datasource before importing application modules.
// Several server modules initialize their Prisma pool at import time; changing
// DATABASE_URL in beforeAll is too late for those modules.
const filename = (expect.getState().testPath ?? '').replaceAll('\\', '/').split('/').at(-1) ?? '';
const group: Record<string, string> = {
  'telegram-browser-auth.test.ts':'TELEGRAM_BROWSER_TEST_DATABASE_URL',
  'bids.test.ts': 'BID_TEST_DATABASE_URL', 'submission-fee.test.ts': 'BID_TEST_DATABASE_URL',
  'settlement.test.ts': 'SETTLEMENT_TEST_DATABASE_URL', 'settlement-v2.test.ts': 'SETTLEMENT_TEST_DATABASE_URL',
  'settlement-v5.test.ts':'V5_TEST_DATABASE_URL', 'settlement-v5-transition.test.ts':'V5_TEST_DATABASE_URL',
  'auction-refund-views.test.ts':'V5_TEST_DATABASE_URL',
  'settlement-v3.test.ts': 'SETTLEMENT_TEST_DATABASE_URL', 'personal.test.ts': 'PERSONAL_TEST_DATABASE_URL',
  'admin.test.ts': 'ADMIN_TEST_DATABASE_URL', 'operations.test.ts': 'OPS_TEST_DATABASE_URL',
  'payments.test.ts': 'PAYMENT_TEST_DATABASE_URL', 'payment-session.test.ts': 'PAYMENT_TEST_DATABASE_URL',
  'admin-wallet-credit.test.ts': 'ADMIN_CREDIT_TEST_DATABASE_URL',
  'admin-payment-table-db.test.ts':'ADMIN_PAYMENT_TABLE_TEST_DATABASE_URL',
  'notification-durability.test.ts':'NOTIFICATION_DURABILITY_TEST_DATABASE_URL',
  'own-contact.test.ts':'OWN_CONTACT_TEST_DATABASE_URL',
  'auction-activity.test.ts': 'ACTIVITY_TEST_DATABASE_URL', 'arifpay-checkout.test.ts': 'ARIFPAY_TEST_DATABASE_URL',
  'chapa-checkout.test.ts':'CHAPA_TEST_DATABASE_URL',
  'chapa-direct-batch.test.ts':'CHAPA_DIRECT_TEST_DATABASE_URL',
  'chapa-current-direct-db.test.ts':'CHAPA_CURRENT_DIRECT_TEST_DATABASE_URL',
  'chapa-direct-speed.test.ts':'CHAPA_SPEED_TEST_DATABASE_URL',
  'chapa-inline-checkout.test.ts':'CHAPA_INLINE_TEST_DATABASE_URL',
  'wallet-batch-atomic.test.ts':'WALLET_BATCH_TEST_DATABASE_URL',
  'winner-banner-db.test.ts':'WINNER_BANNER_TEST_DATABASE_URL',
  'catalog-workflow.test.ts': 'CATALOG_WORKFLOW_TEST_DATABASE_URL',
  'catalog.test.ts': 'CATALOG_TEST_DATABASE_URL',
  'referral-rewards.test.ts': 'REFERRAL_TEST_DATABASE_URL',
  'result-breakdown.test.ts': 'RESULT_TEST_DATABASE_URL',
  'result-publication.test.ts': 'RESULT_TEST_DATABASE_URL',
  'result-campaign-delivery.test.ts': 'RESULT_NOTIFICATION_TEST_DATABASE_URL',
};
const database = process.env[group[filename] ?? 'TEST_DATABASE_URL'];
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw Error('Database test setup only accepts disposable loopback _test databases');
  }
  process.env.DATABASE_URL = process.env.DIRECT_URL = database;
  process.env.APP_ENV = 'local';
  if(['settlement-v5.test.ts','settlement-v5-transition.test.ts','auction-refund-views.test.ts'].includes(filename))Object.assign(process.env,{
    NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',
    BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_SECRET:'fixture-v5-secret-at-least-thirty-two-characters',
    TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-contact-webhook-secret-thirty-two',
    PHONE_CONTACT_KEY_ID:'fixture-test',PHONE_CONTACT_KEYS:JSON.stringify({'fixture-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),
    REFERRAL_REWARDS_SCHEMA_READY:'true',REDIS_URL:'',PAYMENTS_LIVE_ENABLED:'false',CHAPA_LIVE_ENABLED:'false',CHAPA_V1_ENABLED:'false',
    CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',
    CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(40),CHAPA_WEBHOOK_SECRET:'c'.repeat(64),CHAPA_INLINE_METHODS:'telebirr',PAYMENT_GATEWAY:'CHAPA',WALLET_BIDS_ENABLED:'true',
  });
  if(['transactions.test.ts','wallet-history.test.ts'].includes(filename))process.env.BETTER_AUTH_SECRET='fixture-history-auth-secret-at-least-thirty-two-characters';
  // These fixtures exercise signed/contact-bound paths without any bot/provider
  // network requests. Do not depend on a developer .env or deployment secrets.
  if(['referral-rewards.test.ts','result-breakdown.test.ts','result-publication.test.ts','chapa-checkout.test.ts'].includes(filename))Object.assign(process.env,{
    NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',
    BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',
    BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',
    TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',
    TELEGRAM_WEBHOOK_SECRET:'fixture-contact-webhook-secret-thirty-two',
    PHONE_CONTACT_KEY_ID:'fixture-test',PHONE_CONTACT_KEYS:JSON.stringify({'fixture-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),
    REFERRAL_REWARDS_SCHEMA_READY:filename==='referral-rewards.test.ts'?'true':'false',
  });
}
