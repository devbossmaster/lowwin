import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { assertLocalIdentityAccess } from './local-identity';
import { createAuth } from './server';
import { miniAppBody, validateTelegramInitData } from './telegram-validation';
import { staffActions } from './staff-plugin';
import { staffRateLimit } from '../admin/rate-limit';
import {bindOwnContact} from './own-contact';

export async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname.replace('/api/auth', '');
  const staffAction=staffActions.find(action=>path===`/lowin/staff/${action}`);
  if (!((request.method === 'GET' && path === '/get-session') || (request.method === 'POST' && (staffAction||['/telegram/miniapp/signin','/sign-out','/lowin/dev-identity'].includes(path))))) return new Response(null, { status: 404 });
  let env;
  try { env = getEnv(); } catch { return Response.json({ error: 'Authentication is not configured yet.' }, { status: 503 }); }
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if(staffAction){
    const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};
    if((await request.clone().text()).length>4096)return Response.json({error:'Request is too large.'},{status:413,headers});
    try{
      if(!await staffRateLimit(db,staffAction,request))return Response.json({error:'Too many attempts. Try again later.'},{status:429,headers});
      return await db.$transaction(async tx=>{const response=await createAuth(tx).handler(request);if(!response.ok)throw response;const h=new Headers(response.headers);for(const [key,value] of Object.entries(headers))h.set(key,value);return new Response(response.body,{status:response.status,headers:h})},{timeout:20000});
    }catch(error){if(error instanceof Response){const body=await error.json().catch(()=>({message:'Staff sign-in failed.'}));return Response.json({error:body.message??'Staff sign-in failed.'},{status:error.status,headers})}return Response.json({error:'Staff authentication is temporarily unavailable.'},{status:503,headers})}
  }
  if (path === '/telegram/miniapp/signin' || path === '/lowin/dev-identity') {
    let identity: string;
    try {
      if (path === '/lowin/dev-identity') {
        assertLocalIdentityAccess(request.headers, await request.clone().json(), process.env, request.url);
        identity = 'local-test';
      }
      else {
        const body = miniAppBody.parse(await request.clone().json());
        identity = String(validateTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN).id);
      }
    } catch { return Response.json({ error: 'Launch could not be verified. Reopen Lowwin from Telegram.' }, { status: 401 }); }
    try {
      // Transaction-scoped locks work with Supavisor transaction pooling. Plugin creation
      // and cookie/session issuance share the transaction, preventing orphan identities.
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${identity}`}, 0))`;
        const response = await createAuth(tx).handler(request);
        if (!response.ok) throw response;
        if(path==='/telegram/miniapp/signin') {
          const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
          const current=await createAuth(tx).api.getSession({headers:new Headers({cookie})});
          if(!current)throw new Error('Missing issued session');
          const linked=await tx.user.findUnique({where:{id:current.user.id},select:{telegramId:true}});
          if(linked?.telegramId!==identity)throw new Error('Launch identity mismatch');
          await tx.session.update({where:{id:current.session.id},data:{telegramLaunchId:identity}});
          await bindOwnContact(tx,current.user.id,identity);
        }
        // Do not return the plugin's session token in a browser-readable JSON body.
        const headers = new Headers(response.headers);
        headers.delete('content-length'); headers.set('cache-control', 'no-store');
        return Response.json({ ok: true }, { headers });
      }, { maxWait:10000,timeout:30000 });
    } catch (error) {
      if (error instanceof Response) return Response.json({ error: 'Sign-in could not be completed. Reopen Lowwin or retry.' }, { status: error.status });
      return Response.json({ error: 'Sign-in unavailable. Please retry.' }, { status: 503 });
    }
  }
  return createAuth().handler(request);
}
