import { db } from '@/lib/db';
import { getEnv, assertLocalDevelopment } from '@/lib/env';
import { createAuth } from './server';
import { miniAppBody, validateTelegramInitData } from './telegram-validation';

export async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname.replace('/api/auth', '');
  if (!((request.method === 'GET' && path === '/get-session') || (request.method === 'POST' && ['/telegram/miniapp/signin','/sign-out','/lowin/dev-identity'].includes(path)))) return new Response(null, { status: 404 });
  let env;
  try { env = getEnv(); } catch { return Response.json({ error: 'Authentication is not configured yet.' }, { status: 503 }); }
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if (path === '/telegram/miniapp/signin' || path === '/lowin/dev-identity') {
    let identity: string;
    try {
      if (path === '/lowin/dev-identity') { assertLocalDevelopment('identity'); identity = 'local-test'; }
      else {
        const body = miniAppBody.parse(await request.clone().json());
        identity = String(validateTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN).id);
      }
    } catch { return Response.json({ error: 'Launch could not be verified. Reopen Lowin from Telegram.' }, { status: 401 }); }
    try {
      // Transaction-scoped locks work with Supavisor transaction pooling. Plugin creation
      // and cookie/session issuance share the transaction, preventing orphan identities.
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${identity}`}, 0))`;
        const response = await createAuth(tx).handler(request);
        if (!response.ok) throw response;
        // Do not return the plugin's session token in a browser-readable JSON body.
        const headers = new Headers(response.headers);
        headers.delete('content-length'); headers.set('cache-control', 'no-store');
        return Response.json({ ok: true }, { headers });
      }, { timeout: 15000 });
    } catch (error) {
      if (error instanceof Response) return Response.json({ error: 'Sign-in could not be completed. Reopen Lowin or retry.' }, { status: error.status });
      return Response.json({ error: 'Sign-in unavailable. Please retry.' }, { status: 503 });
    }
  }
  return createAuth().handler(request);
}
