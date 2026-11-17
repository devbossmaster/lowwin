import {getMiniSession} from '@/modules/auth/mini-access';
import { db } from '@/lib/db';
import {readMiniAccount} from '@/modules/auth/mini-account';
import { privateHeaders } from '@/modules/auth/private-api';
import {measureTelegramAuth,timedTelegramAuthResponse} from '@/modules/auth/telegram-timing';
export const runtime = 'nodejs';
export async function GET(request: Request) {
 return timedTelegramAuthResponse(async()=>{
  try {
    const session = await measureTelegramAuth('me_session',()=>getMiniSession(request.headers));
    if (!session) return Response.json({ error: 'Sign in through Telegram.' }, { status: 401,headers:privateHeaders });
    const account=await measureTelegramAuth('me_account',()=>readMiniAccount(db,session.user,session.session.id,{displayName:session.user.name}));
    return Response.json(account, { headers:privateHeaders });
  } catch { return Response.json({ error: 'Account is temporarily unavailable.' }, { status: 503,headers:privateHeaders }); }
 });
}
