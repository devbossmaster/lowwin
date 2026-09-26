import { createAuth } from '@/modules/auth/server';
import { db } from '@/lib/db';
import { ensureWallet } from '@/modules/wallet/ledger';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const session = await createAuth().api.getSession({ headers: request.headers });
    if (!session) return Response.json({ error: 'Sign in through Telegram.' }, { status: 401 });
    const accounts = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${session.user.id}`}, 0))`;
      const wallet = await ensureWallet(tx, session.user.id);
      return tx.ledgerAccount.findMany({ where: { walletId: wallet.id } });
    });
    return Response.json({ user: { id: session.user.id, name: session.user.name }, wallet: { available: accounts.find(a=>a.kind==='AVAILABLE')!.balance.toString(), held: accounts.find(a=>a.kind==='HELD')!.balance.toString() } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'Account is temporarily unavailable.' }, { status: 503 }); }
}
