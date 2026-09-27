import type { Prisma, PrismaClient } from '@prisma/client';
import {db} from '@/lib/db';
import {createAuth} from './server';
import {assertLocalIdentitySurface} from './local-identity';

// The only preview exception is explicitly enabled, operator-key-protected,
// loopback development. Public/tunnel/hosted configuration always fails closed.
export function localMiniPreview(headers:Headers) {
  try { assertLocalIdentitySurface(headers);return true; } catch { return false; }
}
export async function getMiniSession(headers:Headers,client:PrismaClient|Prisma.TransactionClient=db) {
  const current=await createAuth(client).api.getSession({headers});
  if(!current)return null;
  if(current.user.id==='lowin-local-test-user'&&localMiniPreview(headers))return current;
  const session=await client.session.findUnique({where:{id:current.session.id},select:{telegramLaunchId:true,user:{select:{telegramId:true,staffMember:{select:{userId:true}}}}}});
  if(!session?.telegramLaunchId||session.telegramLaunchId!==session.user.telegramId||session.user.staffMember)return null;
  return current;
}
