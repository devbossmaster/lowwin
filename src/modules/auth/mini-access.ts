import { Prisma, type PrismaClient } from '@prisma/client';
import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {countIdentityRequest,userMutationLimit} from '@/lib/rate-limit';
import {createAuth} from './server';
import {assertLocalIdentitySurface} from './local-identity';
import {contactBotId} from './own-contact';
import {signedSessionToken} from './signed-session';

// The only preview exception is explicitly enabled, operator-key-protected,
// loopback development. Public/tunnel/hosted configuration always fails closed.
export function localMiniPreview(headers:Headers) {
  try { assertLocalIdentitySurface(headers);return true; } catch { return false; }
}
type BoundRow={id:string;token:string;userId:string;expiresAt:Date;createdAt:Date;updatedAt:Date;telegramLaunchId:string|null;telegramAuthSource:string;name:string;image:string|null;telegramId:string|null;lastFour:string|null;preview:boolean;contactVerified:boolean;needsRenewal:boolean;mutationCount:number|null;directOriginal:boolean;directBidReady:boolean;directTopUpReady:boolean};
type BoundSession={session:Pick<BoundRow,'id'|'token'|'userId'|'expiresAt'|'createdAt'|'updatedAt'|'telegramLaunchId'|'telegramAuthSource'>;user:{id:string;name:string;image:string|null};telegramId:string|null;contactStatus:{verified:boolean;masked:string|null}};
type SessionRead={identity:BoundSession;rateAllowed:boolean;directOriginal:boolean;directBidReady:boolean;directTopUpReady:boolean};
async function readBoundSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient,requireContact:boolean,mutation?:{directKey?:string},refreshed=false):Promise<SessionRead|null> {
  const token=await signedSessionToken(headers);if(!token)return null;
  const preview=localMiniPreview(headers),botId=contactBotId();
  const identity=Prisma.sql`SELECT s.id,s.token,s."userId",s."expiresAt",s."createdAt",s."updatedAt",s."telegramLaunchId",s."telegramAuthSource",COALESCE(p."displayName",u.name) AS name,u.image,u."telegramId",c."lastFour",
    local.preview, contact.verified AS "contactVerified", (${!refreshed} AND s."updatedAt"<=(clock_timestamp() AT TIME ZONE 'UTC')-INTERVAL '24 hours') AS "needsRenewal"
    FROM "session" s JOIN "user" u ON u.id=s."userId"
    LEFT JOIN "StaffMember" m ON m."userId"=u.id LEFT JOIN "TelegramOwnContact" c ON c."userId"=u.id
    LEFT JOIN "PlayerProfile" p ON p."userId"=u.id
    CROSS JOIN LATERAL (SELECT (${preview} AND u.id='lowin-local-test-user') AS preview) local
    CROSS JOIN LATERAL (SELECT COALESCE(c."telegramId"=u."telegramId" AND c."botId"=${botId} AND c."revokedAt" IS NULL,false) AS verified) contact
    WHERE s.token=${token} AND s."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
      AND (local.preview OR (u.role='member' AND s."telegramAuthSource" IN ('MINI_APP','TELEGRAM_OIDC') AND s."telegramLaunchId"=u."telegramId" AND s."telegramLaunchId"<>'' AND m."userId" IS NULL
      AND (${!requireContact} OR contact.verified))) LIMIT 1`;
  // Pay requests count against the same durable quota as other mutations.
  // Only a fresh, bound identity can consume a token, even on a rejected bid.
  const quota=userMutationLimit;
  const sql=mutation?Prisma.sql`
    WITH bound AS MATERIALIZED (${identity}), counted AS (
      ${countIdentityRequest(Prisma.sql`${`app:${quota.scope}:`} || encode(sha256(convert_to(bound."userId",'UTF8')),'hex')`,quota.maximum,quota.windowMs,Prisma.sql`FROM bound WHERE NOT bound."needsRenewal"`)}
    ) SELECT bound.*, counted.count AS "mutationCount",
      ${mutation.directKey?Prisma.sql`CASE WHEN counted.count<=${quota.maximum} THEN EXISTS(SELECT 1 FROM "ChapaCheckout" WHERE "userId"=bound."userId" AND key=${mutation.directKey}) ELSE false END`:Prisma.sql`false`} AS "directOriginal",
      ${mutation.directKey?Prisma.sql`COALESCE(has_function_privilege(to_regprocedure('public.lowwin_prepare_direct_bid(jsonb,jsonb)'), 'EXECUTE'),false)`:Prisma.sql`false`} AS "directBidReady",
      ${mutation.directKey?Prisma.sql`COALESCE(has_function_privilege(to_regprocedure('public.lowwin_prepare_direct_topup(jsonb,jsonb)'), 'EXECUTE'),false)`:Prisma.sql`false`} AS "directTopUpReady"
    FROM bound LEFT JOIN counted ON true`:Prisma.sql`SELECT bound.*, NULL::integer AS "mutationCount", false AS "directOriginal", false AS "directBidReady", false AS "directTopUpReady" FROM (${identity}) AS bound`;
  const rows=await client.$queryRaw<BoundRow[]>(sql);
  const row=rows[0];if(!row)return null;
  const current={session:{id:row.id,token:row.token,userId:row.userId,expiresAt:row.expiresAt,createdAt:row.createdAt,updatedAt:row.updatedAt,telegramLaunchId:row.telegramLaunchId,telegramAuthSource:row.telegramAuthSource},user:{id:row.userId,name:row.name,image:row.image}};
  // Preserve Better Auth's existing daily sliding renewal, outside the normal
  // fast path. Re-read bindings after renewal so a concurrent revoke fails.
  if(row.needsRenewal){if(!await createAuth(client).api.getSession({headers}))return null;return readBoundSession(headers,client,requireContact,mutation,true)}
  const bound=row.preview?{...current,telegramId:null,contactStatus:{verified:true,masked:null}}:
    {...current,telegramId:row.telegramId,contactStatus:{verified:row.contactVerified,masked:row.contactVerified?`•••• ${row.lastFour}`:null}};
  return {identity:bound,rateAllowed:!mutation||row.mutationCount!==null&&row.mutationCount<=quota.maximum,directOriginal:row.directOriginal,directBidReady:row.directBidReady,directTopUpReady:row.directTopUpReady};
}
// Cards load their private state together. Share only an unfinished lookup for
// the same cookie; never retain an authorization result between requests.
const pendingSessions=new Map<string,ReturnType<typeof readBoundSession>>();
function getBoundSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient,requireContact:boolean) {
  const cookie=headers.get('cookie');
  // Transactional reauthorization must read through its own transaction.
  if(client!==db||!cookie)return readBoundSession(headers,client,requireContact);
  const key=createHash('sha256').update(cookie).update(`:${requireContact}:${localMiniPreview(headers)}`).digest('hex');
  const existing=pendingSessions.get(key);
  if(existing)return existing;
  if(pendingSessions.size>=128)return readBoundSession(headers,client,requireContact);
  const pending=readBoundSession(headers,client,requireContact);
  pendingSessions.set(key,pending);
  const release=()=>{if(pendingSessions.get(key)===pending)pendingSessions.delete(key)};
  void pending.then(release,release);
  return pending;
}
export async function getLaunchSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient=db) {
  return (await getBoundSession(headers,client,false))?.identity??null;
}
export async function getMiniSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient=db) {
  return (await getBoundSession(headers,client,true))?.identity??null;
}

// Every mutation counts independently, so these reads skip the in-flight
// session coalescer used by private GET routes.
export function getCountedMiniSession(headers:Headers,options:{directKey?:string},client:PrismaClient=db){
  return readBoundSession(headers,client,true,options);
}
