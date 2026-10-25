import type {Prisma,PrismaClient} from '@prisma/client';
import {contactBotId,decryptPhone,normalizePhone} from '../auth/own-contact';

/** Owner-only Profile display. Never use this projection in public results. */
export async function ownProfileContact(client:PrismaClient|Prisma.TransactionClient,userId:string){
  const row=await client.telegramOwnContact.findUnique({where:{userId},select:{telegramId:true,botId:true,revokedAt:true,lastFour:true,phoneCipher:true,user:{select:{telegramId:true}}}});
  let currentBot:string;try{currentBot=contactBotId()}catch{return {contactVerified:false,phoneDisplay:null}}
  if(!row||row.revokedAt||row.telegramId!==row.user?.telegramId||row.botId!==currentBot)return {contactVerified:false,phoneDisplay:null};
  let phoneDisplay:string|null=/^\d{4}$/.test(row.lastFour)?`•••• ${row.lastFour}`:null;
  try{phoneDisplay=normalizePhone(decryptPhone(row.phoneCipher,row.botId))}catch{/* Preserve the verified masked display when its protected key is unavailable. */}
  return {contactVerified:true,phoneDisplay};
}
