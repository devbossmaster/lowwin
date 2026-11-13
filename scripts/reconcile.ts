import 'dotenv/config';
import { db } from '../src/lib/db';
import { reconcile } from '../src/modules/wallet/ledger';
import {reconcilePayments} from '../src/modules/payments/service';
import {reconcileChapaReceipts} from '../src/modules/payments/chapa-reconcile';
import {reconcileDepositBonuses} from '../src/modules/wallet/deposit-bonus-reconcile';
try {
  const drift = [...await reconcile(db),...await reconcilePayments(db),...(process.env.CHAPA_SCHEMA_READY==='true'?await reconcileChapaReceipts(db):[]),...await reconcileDepositBonuses(db)];
  console.log(JSON.stringify({ reconciled: drift.length === 0, drift }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  if (drift.length) process.exitCode = 1;
} finally { await db.$disconnect(); }
