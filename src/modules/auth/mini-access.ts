import type { Prisma, PrismaClient } from '@prisma/client';
import {createHash} from 'node:crypto';
import {parseCookies} from 'better-auth/cookies';
import {constantTimeEqual,makeSignature} from 'better-auth/crypto';
import {db} from '@/lib/db';
import {getEnv} from '@/lib/env';
import {createAuth} from './server';
import {assertLocalIdentitySurface} from './local-identity';
import {contactBotId} from './own-contact';

// The only preview exception is explicitly enabled, operator-key-protected,
// loopback development. Public/tunnel/hosted configuration always fails closed.
export function localMiniPreview(headers:Headers) {
  try { assertLocalIdentitySurface(headers);return true; } catch { return false; }
}
type BoundRow={id:string;token:string;userId:string;expiresAt:Date;createdAt:Date;updatedAt:Date;telegramLaunchId:string|null;name:string;image:string|null;telegramId:string|null;staffId:string|null;contactTelegramId:string|null;contactBotId:string|null;revokedAt:Date|null;lastFour:string|null};
async function signedSessionToken(headers:Headers){
  const env=getEnv(),name=(env.BETTER_AUTH_URL.startsWith('https:')?'__Secure-':'')+'better-auth.session_token';
  const value=parseCookies(headers.get('cookie')??'').get(name);if(!value||value.length>512)return null;
  const dot=value.lastIndexOf('.');if(dot<1)return null;
  const token=value.slice(0,dot),signature=value.slice(dot+1);
  // Match the installed Better Auth cookie protocol, using its own signer and
  // constant-time comparison. A database token alone is never accepted.
  if(signature.length!==44||!signature.endsWith('=')||!constantTimeEqual(signature,await makeSignature(token,env.BETTER_AUTH_SECRET)))return null;
  return token;
}
async function readBoundSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient,requireContact:boolean,refreshed=false):Promise<{session:{id:string;token:string;userId:string;expiresAt:Date;createdAt:Date;updatedAt:Date;telegramLaunchId:string|null};user:{id:string;name:string;image:string|null};telegramId:string|null;contactStatus:{verified:boolean;masked:string|null}}|null> {
  const token=await signedSessionToken(headers);if(!token)return null;
  // One indexed lookup and joins replace the adapter's sequential session,
  // user, staff and contact reads. Revocation is checked on every request.
  const rows=await client.$queryRaw<BoundRow[]>`SELECT s.id,s.token,s."userId",s."expiresAt",s."createdAt",s."updatedAt",s."telegramLaunchId",u.name,u.image,u."telegramId",m."userId" AS "staffId",c."telegramId" AS "contactTelegramId",c."botId" AS "contactBotId",c."revokedAt",c."lastFour"
    FROM "session" s JOIN "user" u ON u.id=s."userId"
    LEFT JOIN "StaffMember" m ON m."userId"=u.id LEFT JOIN "TelegramOwnContact" c ON c."userId"=u.id
    WHERE s.token=${token} AND s."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') LIMIT 1`;
  const row=rows[0];if(!row)return null;
  const current={session:{id:row.id,token:row.token,userId:row.userId,expiresAt:row.expiresAt,createdAt:row.createdAt,updatedAt:row.updatedAt,telegramLaunchId:row.telegramLaunchId},user:{id:row.userId,name:row.name,image:row.image}};
  const preview=row.userId==='lowin-local-test-user'&&localMiniPreview(headers);
  if(!preview&&(!row.telegramLaunchId||row.telegramLaunchId!==row.telegramId||row.staffId))return null;
  const verified=!!row.contactTelegramId&&!row.revokedAt&&row.contactTelegramId===row.telegramId&&row.contactBotId===contactBotId();
  if(!preview&&requireContact&&!verified)return null;
  // Preserve Better Auth's existing daily sliding renewal, outside the normal
  // fast path. Re-read bindings after renewal so a concurrent revoke fails.
  if(!refreshed&&Date.now()-row.updatedAt.getTime()>=86400000){if(!await createAuth(client).api.getSession({headers}))return null;return readBoundSession(headers,client,requireContact,true)}
  if(preview)return {...current,telegramId:null,contactStatus:{verified:true,masked:null}};
  // The contact endpoint can reuse this same server-validated snapshot. It is
  // shared only while a lookup is pending; later requests recheck revocation.
  return {...current,telegramId:row.telegramId,contactStatus:{verified,masked:verified?`•••• ${row.lastFour}`:null}};
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
  return getBoundSession(headers,client,false);
}
export async function getMiniSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient=db) {
  return getBoundSession(headers,client,true);
}
