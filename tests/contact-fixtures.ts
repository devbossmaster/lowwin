import {randomInt} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {receiveUpdate} from '../src/modules/bot/webhook';
import {acceptOwnContact,contactBotId} from '../src/modules/auth/own-contact';
export async function verifyFixtureContact(db:PrismaClient,telegramId:number){
 const url=new URL(process.env.DATABASE_URL??'');
 if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Contact fixtures require isolated loopback database');
 const updateId=randomInt(100000000000,200000000000),secret=process.env.TELEGRAM_WEBHOOK_SECRET!;
 const payload={update_id:updateId,message:{chat:{id:telegramId,type:'private'},from:{id:telegramId},contact:{user_id:telegramId,phone_number:`+999${String(telegramId).padStart(11,'0')}`}}};
 const response=await receiveUpdate(new Request('http://localhost/api/bot/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(payload)}),db,secret);
 if(!response.ok)throw Error('Fixture webhook rejected');
 await db.$transaction(async tx=>{const row=await tx.botUpdate.findUniqueOrThrow({where:{updateId:BigInt(updateId)}});const outcome=await acceptOwnContact(tx,row.payload,contactBotId(),row.updateId);if(!['VERIFIED','ALREADY_VERIFIED'].includes(outcome??''))throw Error('Fixture contact rejected');await tx.botUpdate.update({where:{updateId:row.updateId},data:{processedAt:new Date(),payload:{}}})});
}
