import 'dotenv/config';
import { db } from '../src/lib/db';
import { assertLocalDevelopment } from '../src/lib/env';
import { creditDevelopmentPoints } from '../src/modules/wallet/ledger';
try {
  assertLocalDevelopment('points');
  const user = await db.user.findUnique({ where: { email: 'local-test@lowin.invalid' } });
  if (!user) throw new Error('First use the explicit local test identity button.');
  const result = await creditDevelopmentPoints(db, user.id, '1000', 'foundation-demo-seed-v1');
  console.log('Local demo seed complete:', result);
} finally { await db.$disconnect(); }
