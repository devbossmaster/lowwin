import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { PrismaClient } from '@prisma/client';
import {acceptOwnContact,contactBotId,isRegisteredTelegramUser} from '../auth/own-contact';
import {InlineKeyboard} from 'grammy';
import {getEnv} from '@/lib/env';
import {CONTACT_ALREADY_VERIFIED_MESSAGE,CONTACT_VERIFIED_MESSAGE,START_BIDDING_ACTION} from './onboarding-copy';
export async function processOneUpdate(client: PrismaClient, bot: Bot, contactVerification?:Map<string,boolean>) {
  return client.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ updateId: bigint; payload: unknown; attempts: number;botId:string|null }>>`
      SELECT "updateId", payload, attempts,"botId" FROM "BotUpdate"
      WHERE "processedAt" IS NULL AND "nextAttemptAt" <= now() AND attempts < 8
      ORDER BY "updateId" FOR UPDATE SKIP LOCKED LIMIT 1`;
    const row = rows[0]; if (!row) return false;
    try {
      const update=row.payload as Update;
      const m='message' in update?update.message:undefined;
      if(m?.chat.type==='private'&&m.from&&m.from.id===m.chat.id&&m.text?.match(/^\/start(?:@[a-zA-Z0-9_]+)?(?:\s|$)/)&&m.entities?.some(e=>e.type==='bot_command'&&e.offset===0))await tx.botChat.upsert({where:{telegramId:String(m.from.id)},create:{telegramId:String(m.from.id),chatId:String(m.chat.id)},update:{blocked:false}});
      const contact=await acceptOwnContact(tx,row.payload,row.botId,row.updateId);
      if(contact==='VERIFIED'||contact==='ALREADY_VERIFIED'){
        const recipient=String(m?.from?.id);
        await bot.api.sendMessage(recipient,contact==='VERIFIED'?CONTACT_VERIFIED_MESSAGE:CONTACT_ALREADY_VERIFIED_MESSAGE,{reply_markup:new InlineKeyboard().webApp(START_BIDDING_ACTION,getEnv().MINI_APP_URL)});
      }
      if(!contact){
        const telegramId=m?.from&&Number.isSafeInteger(m.from.id)?String(m.from.id):null;
        if(contactVerification&&telegramId)contactVerification.set(telegramId,await isRegisteredTelegramUser(tx,telegramId,row.botId??contactBotId()));
        try{await bot.handleUpdate(row.payload as Update)}finally{if(telegramId)contactVerification?.delete(telegramId)}
      }
      await tx.botUpdate.update({ where: { updateId: row.updateId }, data: { processedAt: new Date(), payload: {}, lastError: null } });
    } catch {
      await tx.botUpdate.update({ where: { updateId: row.updateId }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** (row.attempts + 1)) * 1000), lastError: 'Telegram command delivery failed' } });
    }
    return true;
  // Remote staging round trips and Telegram photo uploads can exceed Prisma's
  // interactive transaction default. Keep the existing single-update claim.
  }, { maxWait: 15000, timeout: 120000 });
}
