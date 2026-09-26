import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { receiveUpdate } from '@/modules/bot/webhook';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { return await receiveUpdate(request, db, getEnv().TELEGRAM_WEBHOOK_SECRET); }
  catch { return new Response(null, { status: 503 }); }
}
