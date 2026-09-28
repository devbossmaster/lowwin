import {getMiniSession} from '@/modules/auth/mini-access';
import { db } from '@/lib/db';
import {readMiniAccount} from '@/modules/auth/mini-account';
import { privateHeaders } from '@/modules/auth/private-api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const session = await getMiniSession(request.headers);
    if (!session) return Response.json({ error: 'Sign in through Telegram.' }, { status: 401,headers:privateHeaders });
    return Response.json(await readMiniAccount(db,session.user), { headers:privateHeaders });
  } catch { return Response.json({ error: 'Account is temporarily unavailable.' }, { status: 503,headers:privateHeaders }); }
}
