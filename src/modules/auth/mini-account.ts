import {createHash} from 'node:crypto';
import type {Prisma, PrismaClient} from '@prisma/client';
import {contactStatus} from './own-contact';

type Client = PrismaClient | Prisma.TransactionClient;
type Player = {id:string; name:string; image?:string|null};

// Shared by sign-in and account refresh. Never return cookies or session tokens.
export function miniSessionKey(sessionId:string){return createHash('sha256').update('lowwin-ui-session:').update(sessionId).digest('hex')}

export async function readMiniAccount(client:Client, user:Player, sessionId?:string) {
  const profile=await client.playerProfile.findUnique({where:{userId:user.id},select:{displayName:true}});
  return {
    ...(sessionId?{sessionKey:miniSessionKey(sessionId)}:{}),
    user:{id:user.id,name:profile?.displayName??user.name,image:user.image??null},

  };
}

export async function telegramBootstrap(client:Client, user:Player, telegramId:string, sessionId?:string) {
  const contact = await contactStatus(client,user.id,telegramId);
  if (!contact.verified) return {ok:true as const,status:'contact-required' as const,me:null};
  return {ok:true as const,status:'authenticated' as const,me:await readMiniAccount(client,user,sessionId)};
}
