import 'dotenv/config';
import { db } from '../src/lib/db';
import { reconcile } from '../src/modules/wallet/ledger';
import {reconcilePayments} from '../src/modules/payments/service';
try {
  const drift = [...await reconcile(db),...await reconcilePayments(db)];
  console.log(JSON.stringify({ reconciled: drift.length === 0, drift }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  if (drift.length) process.exitCode = 1;
} finally { await db.$disconnect(); }
