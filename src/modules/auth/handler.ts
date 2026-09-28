import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { assertLocalIdentityAccess } from './local-identity';
import { createAuth } from './server';
import { miniAppBody, validateTelegramInitData } from './telegram-validation';
import { staffActions } from './staff-plugin';
import { staffRateLimit } from '../admin/rate-limit';
import {bindOwnContact} from './own-contact';
import {getLaunchSession} from './mini-access';
import {telegramBootstrap} from './mini-account';

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
    const started=performance.now();
    const responseHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};
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
    } catch { return Response.json({ error: 'Launch could not be verified. Reopen Lowwin from Telegram.' }, { status: 401,headers:responseHeaders }); }
    try {
      // A fresh signed launch may reuse only a live, Telegram-bound session for
      // that exact identity. Website, staff, revoked and other-user cookies fail.
      if(path==='/telegram/miniapp/signin'&&request.headers.has('cookie')) {
        const current=await getLaunchSession(request.headers);
        if(current?.telegramId===identity) {
          const result=await telegramBootstrap(db,current.user,identity);
          return Response.json(result,{headers:{...responseHeaders,'Server-Timing':`auth;dur=${Math.round(performance.now()-started)}`}});
        }
      }
      // Transaction-scoped locks work with Supavisor transaction pooling. Plugin creation
      // and cookie/session issuance share the transaction, preventing orphan identities.
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${identity}`}, 0))`;
        const response = await createAuth(tx).handler(request);
        if (!response.ok) throw response;
        let result:Awaited<ReturnType<typeof telegramBootstrap>>|{ok:true}={ok:true};
        if(path==='/telegram/miniapp/signin') {
          // This is the server-side plugin response, never data supplied by the
          // browser. Bind the issued session atomically without reading it back
          // through another Better Auth request.
          const issued=await response.json() as {session:{id:string;userId:string};user:{id:string;name:string;image?:string|null}};
          if(!issued.session?.id||!issued.user?.id||issued.session.userId!==issued.user.id)throw new Error('Missing issued session');
          const bound=await tx.session.updateMany({where:{id:issued.session.id,userId:issued.user.id,user:{telegramId:identity,staffMember:null}},data:{telegramLaunchId:identity}});
          if(bound.count!==1)throw new Error('Launch identity mismatch');
          await bindOwnContact(tx,issued.user.id,identity);
          result=await telegramBootstrap(tx,issued.user,identity);
        }
        // Do not return the plugin's session token in a browser-readable JSON body.
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        for(const [name,value] of Object.entries(responseHeaders))headers.set(name,value);
        headers.set('Server-Timing',`auth;dur=${Math.round(performance.now()-started)}`);
        return Response.json(result, { headers });
      }, { maxWait:10000,timeout:30000 });
    } catch (error) {
      if (error instanceof Response) return Response.json({ error: 'Sign-in could not be completed. Reopen Lowwin or retry.' }, { status: error.status,headers:responseHeaders });
      // Safe diagnostics: no launch data, cookies, user IDs or database URLs.
      console.warn('Telegram sign-in unavailable',{code:(error as {code?:string})?.code??'AUTH_BOOTSTRAP_FAILED',elapsedMs:Math.round(performance.now()-started)});
      return Response.json({ error: 'Connection interrupted. Please retry.' }, { status: 503,headers:responseHeaders });
    }
  }
  return createAuth().handler(request);
}
