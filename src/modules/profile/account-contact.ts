import type {Prisma,PrismaClient} from '@prisma/client';
import {contactBotId,decryptPhone,normalizePhone} from '../auth/own-contact';

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
  let phoneDisplay:string|null=/^\d{4}$/.test(row.lastFour)?`•••• ${row.lastFour}`:null;
  try{phoneDisplay=normalizePhone(decryptPhone(row.phoneCipher,row.botId))}catch{/* Preserve the verified masked display when its protected key is unavailable. */}
  return {contactVerified:true,phoneDisplay};
}
