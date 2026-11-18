import type {PrismaClient,Session} from '@prisma/client';
import {defineRequestState,tryGetCurrentAuthEndpointContext} from '@better-auth/core/context';
import {APIError} from 'better-auth/api';
import {measureTelegramAuth} from './telegram-timing';
import {TELEGRAM_LOGIN_PROVIDER} from './telegram-login';

export const oidcProof=defineRequestState<{telegramId:string;subject:string;sessionId?:string}|null>(()=>null);

export function telegramOIDCCallback(context:{path?:string;params?:Record<string,unknown>}|null|undefined){
 return context?.path==='/callback/:id'&&context.params?.id===TELEGRAM_LOGIN_PROVIDER;
}

export function telegramSessionConflict(){
 return new APIError('FORBIDDEN',{code:'conflict',message:'Telegram account could not be connected safely.'});
}

/** Better Auth generates the session ID, token and expiry and still issues the
 * cookie. The OIDC callback inserts a fully bound row in one database statement
 * after rechecking the current verified account and contact. */
export function telegramSessionClient(client:PrismaClient,botId:string){
 return client.$extends({query:{session:{async create({args,query}){
  if(!telegramOIDCCallback(tryGetCurrentAuthEndpointContext()))return query(args);
  const proof=await oidcProof.get(),{data}=args;
  if(!proof||proof.sessionId||!('userId' in data)||!data.createdAt||!data.updatedAt||args.select||args.include||args.omit)throw telegramSessionConflict();
  const [session]=await measureTelegramAuth('oidc_session',()=>client.$queryRaw<Session[]>`
   INSERT INTO "session" (id,token,"expiresAt","createdAt","updatedAt","ipAddress","userAgent","userId","telegramLaunchId","telegramAuthSource")
   SELECT ${data.id},${data.token},${data.expiresAt}::timestamptz AT TIME ZONE 'UTC',
    ${data.createdAt}::timestamptz AT TIME ZONE 'UTC',${data.updatedAt}::timestamptz AT TIME ZONE 'UTC',
    ${data.ipAddress??null},${data.userAgent??null},u.id,u."telegramId",'TELEGRAM_OIDC'
   FROM "user" u
   JOIN "account" a ON a."userId"=u.id AND a."providerId"=${TELEGRAM_LOGIN_PROVIDER}
    AND a."accountId"=${proof.subject} AND a."telegramId"=u."telegramId"
   JOIN "TelegramOwnContact" c ON c."userId"=u.id AND c."telegramId"=u."telegramId"
    AND c."botId"=${botId} AND c."revokedAt" IS NULL
   WHERE u.id=${data.userId} AND u."telegramId"=${proof.telegramId} AND u.role='member'
    AND NOT EXISTS(SELECT 1 FROM "StaffMember" staff WHERE staff."userId"=u.id)
   FOR SHARE OF u,a,c
   RETURNING *`);
  if(!session)throw telegramSessionConflict();
  await oidcProof.set({...proof,sessionId:session.id});
  return session;
 }}}});
}
