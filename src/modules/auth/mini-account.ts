import {createHash} from 'node:crypto';
import type {Prisma, PrismaClient} from '@prisma/client';
import {contactStatus} from './own-contact';

type Client = PrismaClient | Prisma.TransactionClient;
type Player = {id:string; name:string; image?:string|null};
type ContactSnapshot = Awaited<ReturnType<typeof contactStatus>>;

// Shared by sign-in and account refresh. Never return cookies or session tokens.
export function miniSessionKey(sessionId:string){return createHash('sha256').update('lowwin-ui-session:').update(sessionId).digest('hex')}

export async function readMiniAccount(client:Client, user:Player, sessionId?:string) {
  const profile=await client.playerProfile.findUnique({where:{userId:user.id},select:{displayName:true}});
  return {
    ...(sessionId?{sessionKey:miniSessionKey(sessionId)}:{}),
    user:{id:user.id,name:profile?.displayName??user.name,image:user.image??null},

  };
}

export async function telegramBootstrap(client:Client, user:Player, telegramId:string, sessionId?:string,verifiedPhoto?:string|null,contactSnapshot?:ContactSnapshot) {
  // Reuse only the fresh server-validated launch snapshot for this same identity.
  // First sign-in and callers without that snapshot still recheck contact here.
  const contact = contactSnapshot ?? await contactStatus(client,user.id,telegramId);
  if (!contact.verified) return {ok:true as const,status:'contact-required' as const,me:null};
  if(verifiedPhoto!==undefined){
    if((user.image??null)!==verifiedPhoto){
      const saved=await client.user.updateMany({where:{id:user.id,telegramId,staffMember:null},data:{image:verifiedPhoto}});
      if(saved.count!==1)throw Error('Telegram profile identity mismatch');
    }
    user={...user,image:verifiedPhoto};
  }
  return {ok:true as const,status:'authenticated' as const,me:await readMiniAccount(client,user,sessionId)};
}
