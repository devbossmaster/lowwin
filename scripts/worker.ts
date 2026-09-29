import 'dotenv/config';
import { setTimeout } from 'node:timers/promises';
// The bot consumes one update at a time. Keep it on one database connection so
// the Mini App retains capacity in the Supabase pool for sign-in.
if(process.env.DATABASE_URL){const url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit','1');url.searchParams.set('pool_timeout','20');process.env.DATABASE_URL=url.toString()}
const [{createBot},{processOneUpdate},{db}]=await Promise.all([import('../src/modules/bot/bot'),import('../src/modules/bot/worker'),import('../src/lib/db')]);
// /start is handled while the inbox row is locked. Share the verification
// result from that transaction so the single-connection worker never waits on
// a nested Prisma query.
const contactVerification=new Map<string,boolean>();
const bot = createBot({contactVerified:async telegramId=>{
  const verified=contactVerification.get(telegramId);
  if(verified===undefined)throw new Error('Contact verification context unavailable');
  return verified;
}});
let running = true;
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });
try {
  await bot.init();
  console.log('Lowwin command worker started. Auction settlement runs separately with worker:auctions.');
  while (running) {
    try { if (!await processOneUpdate(db, bot, contactVerification)) await setTimeout(1000); }
    catch (error) { const code=(error as {code?:string}).code??'unknown'; console.error(`Inbox unavailable (${code}); retrying shortly.`); await setTimeout(5000); }
  }
} catch { console.error('Worker could not initialize. Check configuration.'); process.exitCode = 1; }
finally { await db.$disconnect(); }
