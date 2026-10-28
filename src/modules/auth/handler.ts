import { db } from '@/lib/db';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {allowIdentityRequest} from '@/lib/rate-limit';
import { getEnv } from '@/lib/env';
import {databaseErrorSummary} from '@/lib/database-error';
import { assertLocalIdentityAccess } from './local-identity';
import { createAuth } from './server';
import { miniAppBody, validateTelegramInitData } from './telegram-validation';
import {bindOwnContact} from './own-contact';
import {getLaunchSession} from './mini-access';
import {telegramBootstrap} from './mini-account';
import {attributeNewReferralInTransaction,referralSchemaReady} from '../referrals/service';

export async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname.replace('/api/auth', '');
  const emailPosts=['/sign-up/email','/sign-in/email','/send-verification-email','/request-password-reset','/reset-password'];
  const allowedGet=path==='/get-session'||path==='/verify-email'||/^\/reset-password\/[A-Za-z0-9_-]+$/.test(path);
  if (!((request.method==='GET'&&allowedGet)||(request.method==='POST'&&[...emailPosts,'/telegram/miniapp/signin','/sign-out','/lowin/dev-identity'].includes(path))))return new Response(null,{status:404});
  let env;
  try { env = getEnv(); } catch { return Response.json({ error: 'Authentication is not configured yet.' }, { status: 503 }); }
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if(request.method==='POST') {
    try {const body=await readRequestText(request,emailPosts.includes(path)?4096:20000);request=new Request(request.url,{method:request.method,headers:request.headers,body})}
    catch(error){return Response.json({error:error instanceof RequestBodyError?error.message:'Invalid request.'},{status:error instanceof RequestBodyError?error.status:400,headers:{'Cache-Control':'private, no-store'}})}
  }
  if(emailPosts.includes(path)||request.method==='GET'&&path!=='/get-session'){
    const started=performance.now(),headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Robots-Tag':'noindex'};
    try{
      // Better Auth owns credential/token checks and persistent rate limits.
      // Resend HTTP is never wrapped in our interactive database transaction.
      const response=await createAuth().handler(request),output=new Headers(response.headers);
      if(response.status>=500)return Response.json({error:'Authentication is temporarily unavailable. Please retry.'},{status:503,headers});
      for(const [key,value]of Object.entries(headers))output.set(key,value);
      output.set('Server-Timing',`auth;dur=${Math.round(performance.now()-started)}`);
      if(path==='/sign-in/email'&&response.ok){
        const body=await response.json() as {user?:unknown};
        return Response.json({ok:true,user:body.user},{status:response.status,headers:output});
      }
      return new Response(response.body,{status:response.status,headers:output});
    }catch(error){
      const {code,kind}=databaseErrorSummary(error);console.warn('Admin authentication unavailable',{stage:'email-auth',code,kind,elapsedMs:Math.round(performance.now()-started)});
      return Response.json({error:'Authentication is temporarily unavailable. Please retry.'},{status:503,headers});
    }
  }
  if (path === '/telegram/miniapp/signin' || path === '/lowin/dev-identity') {
    const started=performance.now();
    const responseHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'};
    let identity: string;
    let telegramPhoto:string|null|undefined;
    let telegramStartParam:string|undefined;
    try {
      if (path === '/lowin/dev-identity') {
        assertLocalIdentityAccess(request.headers, await request.clone().json(), process.env, request.url);
        identity = 'local-test';
      }
      else {
        const body = miniAppBody.parse(await request.clone().json());
        const launch=validateTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        identity = String(launch.id);telegramPhoto=launch.photo_url;telegramStartParam=launch.start_param;
      }
    } catch { return Response.json({ error: 'Launch could not be verified. Reopen Lowwin from Telegram.' }, { status: 401,headers:responseHeaders }); }
    let stage:'launch-rate-limit'|'session-read'|'account-bootstrap'|'transaction-start'|'identity-lock'|'plugin-sign-in'|'session-bind'|'contact-bind'='launch-rate-limit';
    try {
      // A fresh signed launch may reuse only a live, Telegram-bound session for
      if(!await allowIdentityRequest(db,'launch',identity,20))return Response.json({error:'Too many sign-in attempts. Wait a minute and reopen Lowwin.'},{status:429,headers:{...responseHeaders,'Retry-After':'60'}});
      // that exact identity. Website, staff, revoked and other-user cookies fail.
      if(path==='/telegram/miniapp/signin'&&request.headers.has('cookie')) {
        stage='session-read';
        const current=await getLaunchSession(request.headers);
        if(current?.telegramId===identity) {
          stage='account-bootstrap';
          const result=await telegramBootstrap(db,current.user,identity,current.session.id,telegramPhoto,current.contactStatus);
          return Response.json(result,{headers:{...responseHeaders,'Server-Timing':`auth;dur=${Math.round(performance.now()-started)}`}});
        }
      }
      // Transaction-scoped locks work with Supavisor transaction pooling. Plugin creation
      // and cookie/session issuance share the transaction, preventing orphan identities.
      stage='transaction-start';
      return await db.$transaction(async tx => {
        stage='identity-lock';
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${identity}`}, 0))`;
        const existed=path==='/telegram/miniapp/signin'&&referralSchemaReady()?await tx.user.findUnique({where:{telegramId:identity},select:{id:true}}):null;
        stage='plugin-sign-in';
        const response = await createAuth(tx).handler(request);
        if (!response.ok) throw response;
        let result:Awaited<ReturnType<typeof telegramBootstrap>>|{ok:true}={ok:true};
        if(path==='/telegram/miniapp/signin') {
          // This is the server-side plugin response, never data supplied by the
          // browser. Bind the issued session atomically without reading it back
          // through another Better Auth request.
          stage='session-bind';
          const issued=await response.json() as {session:{id:string;userId:string};user:{id:string;name:string;image?:string|null}};
          if(!issued.session?.id||!issued.user?.id||issued.session.userId!==issued.user.id)throw new Error('Missing issued session');
          const bound=await tx.session.updateMany({where:{id:issued.session.id,userId:issued.user.id,user:{telegramId:identity,staffMember:null}},data:{telegramLaunchId:identity}});
          if(bound.count!==1)throw new Error('Launch identity mismatch');
          await attributeNewReferralInTransaction(tx,issued.user.id,identity,{newAccount:!existed,signedStartParam:telegramStartParam});
          stage='contact-bind';
          await bindOwnContact(tx,issued.user.id,identity);
          stage='account-bootstrap';
          result=await telegramBootstrap(tx,issued.user,identity,issued.session.id,telegramPhoto);
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
      const {code,kind,sqlState,reason}=databaseErrorSummary(error);
      console.warn('Telegram sign-in unavailable',{stage,code,kind,...(sqlState?{sqlState}:{}),...(reason?{reason}:{}),elapsedMs:Math.round(performance.now()-started)});
      return Response.json({ error: 'Connection interrupted. Please retry.' }, { status: 503,headers:responseHeaders });
    }
  }
  return createAuth().handler(request);
}
