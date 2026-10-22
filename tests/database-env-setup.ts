import {expect} from 'vitest';

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
};
const database = process.env[group[filename] ?? 'TEST_DATABASE_URL'];
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw Error('Database test setup only accepts disposable loopback _test databases');
  }
  process.env.DATABASE_URL = process.env.DIRECT_URL = database;
  process.env.APP_ENV = 'local';
}
