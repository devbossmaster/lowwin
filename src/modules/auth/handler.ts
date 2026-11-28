import { db } from '@/lib/db';
import {randomUUID} from 'node:crypto';
import {readRequestText,RequestBodyError} from '@/lib/request-body';
import {allowIdentityRequest} from '@/lib/rate-limit';
import { getEnv } from '@/lib/env';
import {databaseErrorSummary} from '@/lib/database-error';
import { assertLocalIdentityAccess } from './local-identity';
import { createAuth } from './server';
import { miniAppBody, verifyTelegramLaunch } from './telegram-validation';
import {contactStatus} from './own-contact';
import {getLaunchSession} from './mini-access';
import {miniAccountFromSession,telegramBootstrap} from './mini-account';
import {recordSignedMiniReferralStartInTransaction} from '../referrals/service';
import {handleTelegramOIDC} from './telegram-oidc-handler';
import {handleStaffEmailVerification} from './staff-profile';

export async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname.replace('/api/auth', '');
  if(path==='/telegram/config'&&request.method==='GET')return handleTelegramOIDC(request,path);
  const oidc=path==='/sign-in/social'&&request.method==='POST'||path==='/callback/telegram-oidc'&&request.method==='GET';
  const emailPosts=['/sign-up/email','/sign-in/email','/send-verification-email','/request-password-reset','/reset-password'];
  const allowedGet=path==='/get-session'||path==='/verify-email'||/^\/reset-password\/[A-Za-z0-9_-]+$/.test(path);
  if (!oidc&&!((request.method==='GET'&&allowedGet)||(request.method==='POST'&&[...emailPosts,'/telegram/miniapp/signin','/sign-out','/lowin/dev-identity'].includes(path))))return new Response(null,{status:404});
  let env;
  try { env = getEnv(); } catch { return Response.json({ error: 'Authentication is not configured yet.' }, { status: 503 }); }
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if(request.method==='POST') {
    try {const body=await readRequestText(request,emailPosts.includes(path)?4096:20000);request=new Request(request.url,{method:request.method,headers:request.headers,body})}
    catch(error){return Response.json({error:error instanceof RequestBodyError?error.message:'Invalid request.'},{status:error instanceof RequestBodyError?error.status:400,headers:{'Cache-Control':'private, no-store'}})}
  }
  if(oidc)return handleTelegramOIDC(request,path);
  if(emailPosts.includes(path)||request.method==='GET'&&path!=='/get-session'){
    const started=performance.now(),headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'};
    try{
      // Better Auth owns credential/token checks and persistent rate limits.
      // Resend HTTP is never wrapped in our interactive database transaction.
      const response=path==='/verify-email'?await handleStaffEmailVerification(request,env.BETTER_AUTH_SECRET):await createAuth().handler(request),output=new Headers(response.headers);
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
    const authHeaders=()=>({...responseHeaders,'Server-Timing':`auth;dur=${Math.round(performance.now()-started)}`});
    const sharedContactRequired=new Error('Verified Telegram contact required.');
    const contactRequired=()=>Response.json({ok:true,status:'contact-required',me:null},{headers:authHeaders()});
    const invalidLaunch=()=>Response.json({error:'Launch could not be verified. Reopen Lowwin from Telegram.'},{status:401,headers:authHeaders()});
    let identity: string;
    let telegramPhoto:string|null|undefined;
    let telegramStartParam:string|undefined;
    let expiredLaunch=false;
    try {
      if (path === '/lowin/dev-identity') {
        assertLocalIdentityAccess(request.headers, await request.clone().json(), process.env, request.url);
        identity = 'local-test';
      }
      else {
        const body = miniAppBody.parse(await request.clone().json());
        const {launch,expired}=verifyTelegramLaunch(body.initData,env.TELEGRAM_BOT_TOKEN);
        expiredLaunch=expired;
        identity = String(launch.id);telegramPhoto=launch.photo_url;telegramStartParam=launch.start_param;
      }
    } catch { return invalidLaunch(); }
    let stage:'launch-rate-limit'|'session-read'|'account-bootstrap'|'transaction-start'|'identity-lock'|'plugin-sign-in'|'session-bind'|'contact-bind'='launch-rate-limit';
    try {
      // Only fresh launches can start registration or issue a new session. A
      // resumed WebView may retain its signed launch after Telegram's freshness
      // window, but it still needs an active Mini App session for that identity.
      if(!expiredLaunch&&!await allowIdentityRequest(db,'launch',identity,20))return Response.json({error:'Too many sign-in attempts. Wait a minute and reopen Lowwin.'},{status:429,headers:{...responseHeaders,'Retry-After':'60'}});
      if(path==='/telegram/miniapp/signin'&&request.headers.has('cookie')) {
        stage='session-read';
        const current=await getLaunchSession(request.headers);
        if(current?.telegramId===identity&&current.session.telegramAuthSource==='MINI_APP') {
          if(!current.contactStatus.verified)return expiredLaunch?invalidLaunch():contactRequired();
          if(expiredLaunch)return Response.json({ok:true,status:'authenticated',me:miniAccountFromSession(current)},{headers:authHeaders()});
          stage='account-bootstrap';
          const result=await telegramBootstrap(db,current.user,identity,current.session.id,telegramPhoto,current.contactStatus);
          return Response.json(result,{headers:authHeaders()});
        }
      }
      if(expiredLaunch)return invalidLaunch();
      // Transaction-scoped locks work with Supavisor transaction pooling. Plugin creation
      // and cookie/session issuance share the transaction, preventing orphan identities.
      stage='transaction-start';
      return await db.$transaction(async tx => {
        stage='identity-lock';
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${identity}`}, 0))`;
        const existed=path==='/telegram/miniapp/signin'?await tx.user.findUnique({where:{telegramId:identity},select:{id:true,role:true,staffMember:{select:{userId:true}}}}):null;
        if(path==='/telegram/miniapp/signin'){
          const canonical=await tx.account.findUnique({where:{providerId_accountId:{providerId:'telegram',accountId:identity}},select:{userId:true,telegramId:true}});
          if(existed&&(existed.role!=='member'||existed.staffMember)||canonical&&(canonical.userId!==existed?.id||canonical.telegramId!==null&&canonical.telegramId!==identity))throw new Response(null,{status:403});
          stage='contact-bind';
          // A signed launch identifies the customer. The bot's authenticated
          // own-contact transaction is the only Mini App registration path.
          if(!existed){
            if(telegramStartParam)await recordSignedMiniReferralStartInTransaction(tx,identity,telegramStartParam);
            return contactRequired();
          }
          if(!(await contactStatus(tx,existed.id,identity)).verified)return contactRequired();
          // Bot contact registration predates an authentication account. A fresh
          // signed numeric identity can bind only that same existing member,
          // under the shared identity lock; phone/name matching never links it.
          if(!canonical)await tx.account.create({data:{id:randomUUID(),providerId:'telegram',accountId:identity,userId:existed.id,telegramId:identity}});
        }
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
          const bound=await tx.session.updateMany({where:{id:issued.session.id,userId:issued.user.id,user:{telegramId:identity,staffMember:null}},data:{telegramLaunchId:identity,telegramAuthSource:'MINI_APP'}});
          if(bound.count!==1)throw new Error('Launch identity mismatch');
          stage='account-bootstrap';
          const bootstrap=await telegramBootstrap(tx,issued.user,identity,issued.session.id,telegramPhoto);
          if(bootstrap.status==='contact-required')throw sharedContactRequired;
          result=bootstrap;
        }
        // Do not return the plugin's session token in a browser-readable JSON body.
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        for(const [name,value] of Object.entries(responseHeaders))headers.set(name,value);
        headers.set('Server-Timing',`auth;dur=${Math.round(performance.now()-started)}`);
        return Response.json(result, { headers });
      }, { maxWait:10000,timeout:30000 });
    } catch (error) {
      if(error===sharedContactRequired)return contactRequired();
      if (error instanceof Response) return Response.json({ error: 'Sign-in could not be completed. Reopen Lowwin or retry.' }, { status: error.status,headers:responseHeaders });
      // Safe diagnostics: no launch data, cookies, user IDs or database URLs.
      const {code,kind,sqlState,reason}=databaseErrorSummary(error);
      console.warn('Telegram sign-in unavailable',{stage,code,kind,...(sqlState?{sqlState}:{}),...(reason?{reason}:{}),elapsedMs:Math.round(performance.now()-started)});
      return Response.json({ error: 'Connection interrupted. Please retry.' }, { status: 503,headers:responseHeaders });
    }
  }
  return createAuth().handler(request);
}
