import {randomUUID} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {makeSignature} from 'better-auth/crypto';
import {getCookies} from 'better-auth/cookies';
import {db} from '@/lib/db';
import {getEnv} from '@/lib/env';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {miniReturnPath} from '@/lib/mini-return';
import {attributeNewReferralInTransaction} from '../referrals/service';
import {contactBotId,encryptPhone,phoneHash} from './own-contact';
import {createAuth} from './server';
import {browserLoginBinding,browserLoginConfig,browserLoginCookie,browserLoginCookieValue,browserLoginCookieName,browserRateIdentity,exchangeTelegramBrowserCode,newBrowserLoginChallenge,TELEGRAM_BROWSER_TTL_SECONDS,TELEGRAM_OIDC_ISSUER,TelegramBrowserError,telegramBrowserSettings,validBrowserChallenge,type TelegramBrowserChallenge,type TelegramBrowserClaims,type TelegramBrowserSettings} from './telegram-browser-protocol';

const responseHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'};
const challengePrefix='telegram-browser:';
function redirect(location:string,headers:HeadersInit={}){return new Response(null,{status:303,headers:{...responseHeaders,...headers,Location:location}})}
function errorRedirect(settings:TelegramBrowserSettings,code:string,challenge?:Pick<TelegramBrowserChallenge,'next'|'lang'>){const url=new URL('/',settings.origin);url.searchParams.set('telegramLoginError',code);if(challenge?.next&&challenge.next!=='/')url.searchParams.set('next',miniReturnPath(challenge.next));url.searchParams.set('lang',challenge?.lang??'en');return redirect(url.href,{'Set-Cookie':browserLoginCookie(settings,'',0)})}
export async function browserLoginConfiguration(){return Response.json(browserLoginConfig(),{headers:responseHeaders})}

export async function startTelegramBrowserLogin(request:Request,client:PrismaClient=db){
 const settings=telegramBrowserSettings();if(!settings)return Response.json({error:'Telegram browser login is not configured.'},{status:503,headers:responseHeaders});
 const url=new URL(request.url);if(url.origin!==settings.origin||url.searchParams.getAll('next').length>1||url.searchParams.getAll('lang').length>1)return Response.json({error:'Invalid login request.'},{status:400,headers:responseHeaders});
 try{
  // A forwarded address is used only as an abuse limit, never authentication.
  // The deployment proxy must overwrite forwarding headers at the edge.
  if(!await allowIdentityRequest(client,'telegram-browser-start',browserRateIdentity(request),12))return Response.json({error:'Too many login requests. Wait a minute and try again.'},{status:429,headers:{...responseHeaders,'Retry-After':'60'}});
  const {challenge,cookieValue,authorizationUrl}=newBrowserLoginChallenge(settings,url.searchParams.get('next'),url.searchParams.get('lang'));
  await client.verification.create({data:{id:challengePrefix+challenge.state,identifier:'telegram-browser-login',value:JSON.stringify(challenge),expiresAt:new Date(challenge.createdAt+TELEGRAM_BROWSER_TTL_SECONDS*1000)}});
  // Small bounded cleanup; never remove an unexpired challenge or provider state.
  await client.$executeRaw`DELETE FROM "verification" WHERE id IN (SELECT id FROM "verification" WHERE identifier='telegram-browser-login' AND "expiresAt"<(clock_timestamp() AT TIME ZONE 'UTC') ORDER BY "expiresAt" LIMIT 25)`;
  return redirect(authorizationUrl,{'Set-Cookie':browserLoginCookie(settings,cookieValue)});
 }catch{return Response.json({error:'Telegram login is temporarily unavailable. Please retry.'},{status:503,headers:responseHeaders})}
}

async function consumeChallenge(client:PrismaClient,request:Request,settings:TelegramBrowserSettings,state:string){
 const binding=browserLoginBinding(browserLoginCookieValue(request.headers,settings));if(!binding||binding.state!==state)throw new TelegramBrowserError('invalid');
 const row=await client.verification.findUnique({where:{id:challengePrefix+state}});if(!row)throw new TelegramBrowserError('expired');
 if(row.expiresAt.getTime()<=Date.now())throw new TelegramBrowserError('expired');
 let challenge:unknown;try{challenge=JSON.parse(row.value)}catch{throw new TelegramBrowserError('invalid')}
 if(!validBrowserChallenge(challenge,settings,state,binding.secret))throw new TelegramBrowserError('invalid');
 // Compare-and-delete makes a callback single-use across requests/replicas.
 const consumed=await client.verification.deleteMany({where:{id:row.id,value:row.value,expiresAt:{gt:new Date()}}});if(consumed.count!==1)throw new TelegramBrowserError('expired');
 return challenge;
}

export async function registerBrowserTelegramIdentity(tx:Prisma.TransactionClient,claims:TelegramBrowserClaims,settings:TelegramBrowserSettings){
 if(contactBotId()!==settings.clientId)throw new TelegramBrowserError('invalid');
 const tid=claims.telegramId,botId=settings.clientId,oidcAccountId=`${settings.clientId}:${claims.subject}`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${tid}`},0))`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`own-contact:${botId}:${tid}`},0))`;
 const [existing,canonical,oidcAccount,contact]=await Promise.all([
  tx.user.findUnique({where:{telegramId:tid},select:{id:true,role:true,staffMember:{select:{userId:true}}}}),
  tx.account.findUnique({where:{providerId_accountId:{providerId:'telegram',accountId:tid}},select:{id:true,userId:true}}),
  tx.account.findUnique({where:{providerId_accountId:{providerId:'telegram-oidc',accountId:oidcAccountId}},select:{id:true,userId:true,telegramId:true}}),
  tx.telegramOwnContact.findUnique({where:{botId_telegramId:{botId,telegramId:tid}}}),
 ]);
 if(existing&&(existing.role!=='member'||existing.staffMember)||canonical&&canonical.userId!==existing?.id||oidcAccount&&(oidcAccount.userId!==existing?.id||oidcAccount.telegramId!==tid)||contact&&(contact.revokedAt||contact.userId&&contact.userId!==existing?.id))throw new TelegramBrowserError('conflict');
 // Active original contact proof wins: web consent may never rebind a phone,
 // revive a revoked contact or merge another account by phone/name/email.
 let protectedPhone:{phoneHash:string;phoneCipher:string;lastFour:string}|null=null;
 if(!contact){
  if(!claims.phone)throw new TelegramBrowserError('contact_required');
  const hash=phoneHash(claims.phone);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${hash}`},0))`;
  const owner=await tx.telegramOwnContact.findUnique({where:{phoneHash:hash},select:{telegramId:true,botId:true}});if(owner&&(owner.telegramId!==tid||owner.botId!==botId))throw new TelegramBrowserError('conflict');
  protectedPhone={phoneHash:hash,phoneCipher:encryptPhone(claims.phone,botId),lastFour:claims.phone.slice(-4)};
 }
 const user=existing??await tx.user.create({data:{id:randomUUID(),name:claims.name,image:claims.image,telegramId:tid,telegramUsername:claims.username,role:'member'},select:{id:true,role:true,staffMember:{select:{userId:true}}}});
 if(!contact&&protectedPhone)await tx.telegramOwnContact.create({data:{telegramId:tid,botId,userId:user.id,...protectedPhone,verifiedAt:new Date(),sourceUpdateId:null,verificationSource:'TELEGRAM_OIDC',oidcIssuer:TELEGRAM_OIDC_ISSUER,oidcSubject:claims.subject}});
 else if(contact&&!contact.userId)await tx.telegramOwnContact.update({where:{id:contact.id},data:{userId:user.id}});
 if(!canonical)await tx.account.create({data:{id:randomUUID(),providerId:'telegram',accountId:tid,userId:user.id,telegramId:tid,telegramUsername:claims.username}});
 if(!oidcAccount)await tx.account.create({data:{id:randomUUID(),providerId:'telegram-oidc',accountId:oidcAccountId,userId:user.id,telegramId:tid}});
 await attributeNewReferralInTransaction(tx,user.id,tid,{newAccount:!existing});
 // Better Auth owns token/session generation and hooks; this is not a separate
 // browser credential store. Only the verified OIDC path can issue this source.
 const context=await createAuth(tx).$context,session=await context.internalAdapter.createSession(user.id);
 if(!session)throw new TelegramBrowserError('unavailable');
 const bound=await tx.session.updateMany({where:{id:session.id,userId:user.id,user:{telegramId:tid,staffMember:null}},data:{telegramLaunchId:tid,telegramAuthSource:'TELEGRAM_OIDC'}});if(bound.count!==1)throw new TelegramBrowserError('conflict');
 return {session,telegramId:tid};
}

async function sessionCookie(token:string){
 const env=getEnv(),cookie=getCookies({baseURL:env.BETTER_AUTH_URL,session:{expiresIn:604800},advanced:{useSecureCookies:env.BETTER_AUTH_URL.startsWith('https:'),defaultCookieAttributes:{httpOnly:true,sameSite:'lax'}}}).sessionToken;
 // Use the installed Better Auth signature protocol; no token enters JSON or URL.
 return `${cookie.name}=${encodeURIComponent(`${token}.${await makeSignature(token,env.BETTER_AUTH_SECRET)}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${env.BETTER_AUTH_URL.startsWith('https:')?'; Secure':''}`;
}
export async function finishTelegramBrowserLogin(request:Request,client:PrismaClient=db,transport:typeof fetch=fetch){
 const settings=telegramBrowserSettings();if(!settings)return Response.json({error:'Telegram browser login is not configured.'},{status:503,headers:responseHeaders});
 let challenge:TelegramBrowserChallenge|undefined;
 try{
  const url=new URL(request.url);if(url.origin!==settings.origin||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length>1||url.searchParams.getAll('error').length>1)throw new TelegramBrowserError('invalid');
  const state=url.searchParams.get('state');if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state))throw new TelegramBrowserError('invalid');
  challenge=await consumeChallenge(client,request,settings,state);
  if(url.searchParams.has('error'))throw new TelegramBrowserError(url.searchParams.get('error')==='access_denied'?'cancelled':'invalid');
  // Authorization codes are opaque provider data. Preserve their decoded value;
  // URLSearchParams handles transport encoding during the token exchange.
  const code=url.searchParams.get('code');if(!code||code.length>2048||/[\u0000-\u001f\u007f]/.test(code))throw new TelegramBrowserError('invalid');
  const claims=await exchangeTelegramBrowserCode(code,settings,challenge,transport);
  if(!await allowIdentityRequest(client,'telegram-browser-finish',claims.telegramId,10))throw new TelegramBrowserError('unavailable');
  // Provider HTTP is complete before this short identity/contact/session commit.
  const issued=await client.$transaction(tx=>registerBrowserTelegramIdentity(tx,claims,settings),{maxWait:10000,timeout:20000});
  const headers=new Headers(responseHeaders);headers.set('Location',new URL(challenge.next,settings.origin).href);headers.append('Set-Cookie',await sessionCookie(issued.session.token));headers.append('Set-Cookie',browserLoginCookie(settings,'',0));
  return new Response(null,{status:303,headers});
 }catch(error){return errorRedirect(settings,error instanceof TelegramBrowserError?error.code:'unavailable',challenge)}
}
