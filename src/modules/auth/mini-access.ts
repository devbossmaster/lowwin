import type { Prisma, PrismaClient } from '@prisma/client';
import {createHash} from 'node:crypto';
import {db} from '@/lib/db';
import {createAuth} from './server';
import {assertLocalIdentitySurface} from './local-identity';
import {contactBotId} from './own-contact';

// The only preview exception is explicitly enabled, operator-key-protected,
// loopback development. Public/tunnel/hosted configuration always fails closed.
export function localMiniPreview(headers:Headers) {
  try { assertLocalIdentitySurface(headers);return true; } catch { return false; }
}
async function readBoundSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient,requireContact:boolean) {
  const current=await createAuth(client).api.getSession({headers});
  if(!current)return null;
  if(current.user.id==='lowin-local-test-user'&&localMiniPreview(headers))return {...current,telegramId:null,contactStatus:{verified:true,masked:null}};
  const session=await client.session.findUnique({where:{id:current.session.id},select:{telegramLaunchId:true,user:{select:{telegramId:true,staffMember:{select:{userId:true}},ownContact:{select:{telegramId:true,botId:true,revokedAt:true,lastFour:true}}}}}});
  if(!session?.telegramLaunchId||session.telegramLaunchId!==session.user.telegramId||session.user.staffMember)return null;
  const contact=session.user.ownContact;
  const verified=!!contact&&!contact.revokedAt&&contact.telegramId===session.user.telegramId&&contact.botId===contactBotId();
  if(requireContact&&!verified)return null;
  // The contact endpoint can reuse this same server-validated snapshot. It is
  // shared only while a lookup is pending; later requests recheck revocation.
  return {...current,telegramId:session.user.telegramId,contactStatus:{verified,masked:verified?`•••• ${contact!.lastFour}`:null}};
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
