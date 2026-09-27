import 'dotenv/config';
import { setTimeout } from 'node:timers/promises';
import { createBot } from '../src/modules/bot/bot';
import { processOneUpdate } from '../src/modules/bot/worker';
import { db } from '../src/lib/db';
const bot = createBot();
let running = true;
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });
try {
  await bot.init();
  console.log('Lowin command worker started. Auction settlement runs separately with worker:auctions.');
  while (running) {
    try { if (!await processOneUpdate(db, bot)) await setTimeout(1000); }
    catch { console.error('Inbox unavailable; retrying shortly.'); await setTimeout(5000); }
  }
} catch { console.error('Worker could not initialize. Check configuration.'); process.exitCode = 1; }
finally { await db.$disconnect(); }
