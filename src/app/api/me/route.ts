import {getMiniSession} from '@/modules/auth/mini-access';
import { db } from '@/lib/db';
import { ensureWallet } from '@/modules/wallet/ledger';
import { privateHeaders } from '@/modules/auth/private-api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const session = await getMiniSession(request.headers);
    if (!session) return Response.json({ error: 'Sign in through Telegram.' }, { status: 401,headers:privateHeaders });
    const accounts = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${session.user.id}`}, 0))`;
      const wallet = await ensureWallet(tx, session.user.id);
      return tx.ledgerAccount.findMany({ where: { walletId: wallet.id } });
    });
    const profile=await db.playerProfile.findUnique({where:{userId:session.user.id},select:{displayName:true}});
    return Response.json({ user: { id: session.user.id, name: profile?.displayName??session.user.name }, wallet: { available: accounts.find(a=>a.kind==='AVAILABLE')!.balance.toString(), held: accounts.find(a=>a.kind==='HELD')!.balance.toString() } }, { headers:privateHeaders });
  } catch { return Response.json({ error: 'Account is temporarily unavailable.' }, { status: 503,headers:privateHeaders }); }
}
