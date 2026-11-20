import type {Prisma,PrismaClient} from '@prisma/client';
import {contactBotId,decryptPhone} from '../auth/own-contact';
import {maskPhoneDisplay,maskPhoneSuffix} from '@/lib/phone-mask';

export const ownProfileContactSelect={telegramId:true,botId:true,revokedAt:true,lastFour:true,phoneCipher:true} satisfies Prisma.TelegramOwnContactSelect;
type ContactRow=Prisma.TelegramOwnContactGetPayload<{select:typeof ownProfileContactSelect}>&{user:{telegramId:string|null}|null};

/** Owner-only Profile display. Never use this projection in public results. */
export async function ownProfileContact(client:PrismaClient|Prisma.TransactionClient,userId:string){
  const row=await client.telegramOwnContact.findUnique({where:{userId},select:{...ownProfileContactSelect,user:{select:{telegramId:true}}}});
  return profileContactDisplay(row);
}
/** Reuse the same verification rules when the owner and contact were read together. */
export function profileContactDisplay(row:ContactRow|null){
  let currentBot:string;try{currentBot=contactBotId()}catch{return {contactVerified:false,phoneDisplay:null}}
  if(!row||row.revokedAt||row.telegramId!==row.user?.telegramId||row.botId!==currentBot)return {contactVerified:false,phoneDisplay:null};
  let phoneDisplay=maskPhoneSuffix(row.lastFour);
  try{phoneDisplay=maskPhoneDisplay(decryptPhone(row.phoneCipher,row.botId))??phoneDisplay}catch{/* Preserve the known suffix when the protected key is unavailable. */}
  return {contactVerified:true,phoneDisplay};
}
