import type {Bot} from 'grammy';
import type {Update} from 'grammy/types';
import type {PrismaClient} from '@prisma/client';
import {acceptOwnContact} from '../auth/own-contact';

/** Contact proof is committed before any optional bot delivery. Ordinary bot
 * commands run after the inbox claim commits, avoiding nested DB queries and
 * Telegram HTTP while the contact transaction owns locks/connections. */
export async function processOneUpdate(client:PrismaClient,bot:Bot,_contactVerification?:Map<string,boolean>){
 const claim=await client.$transaction(async tx=>{
  const rows=await tx.$queryRaw<Array<{updateId:bigint;payload:unknown;attempts:number;botId:string|null}>>`
   SELECT "updateId",payload,attempts,"botId" FROM "BotUpdate"
   WHERE "processedAt" IS NULL AND "nextAttemptAt"<=now() AND attempts<8
   ORDER BY "updateId" FOR UPDATE SKIP LOCKED LIMIT 1`;
  const row=rows[0];if(!row)return null;
  const update=row.payload as Update,m='message' in update?update.message:undefined;
  if(m?.chat.type==='private'&&m.from&&!m.from.is_bot&&m.from.id===m.chat.id&&!m.forward_origin&&(m.contact||m.text?.match(/^\/start(?:@[a-zA-Z0-9_]+)?(?:\s|$)/)&&m.entities?.some(e=>e.type==='bot_command'&&e.offset===0)))await tx.botChat.upsert({where:{telegramId:String(m.from.id)},create:{telegramId:String(m.from.id),chatId:String(m.chat.id)},update:{blocked:false}});
  const contact=await acceptOwnContact(tx,row.payload,row.botId,row.updateId);
  if(contact){
   if(contact==='VERIFIED')await tx.outbox.upsert({where:{key:`contact-confirmed:${row.botId}:${m!.from!.id}`},create:{key:`contact-confirmed:${row.botId}:${m!.from!.id}`,kind:'CONTACT_CONFIRMED',payload:{telegramId:String(m!.from!.id),botId:row.botId}},update:{}});
   await tx.botUpdate.update({where:{updateId:row.updateId},data:{processedAt:new Date(),payload:{},lastError:null}});
   return {handled:true as const};
  }
  // This lease is durable across worker restarts. A crashed delivery retries
  // after two minutes; no contact or financial action is replayed by it.
  const lease=new Date(Date.now()+120000);
  await tx.botUpdate.update({where:{updateId:row.updateId},data:{attempts:{increment:1},nextAttemptAt:lease,lastError:null}});
  return {handled:false as const,row,lease};
 },{maxWait:15000,timeout:15000});
 if(!claim)return false;if(claim.handled)return true;
 const {row,lease}=claim;
 try{
  await bot.handleUpdate(row.payload as Update);
  await client.botUpdate.updateMany({where:{updateId:row.updateId,processedAt:null,nextAttemptAt:lease},data:{processedAt:new Date(),payload:{},lastError:null}});
 }catch{
  await client.botUpdate.updateMany({where:{updateId:row.updateId,processedAt:null,nextAttemptAt:lease},data:{nextAttemptAt:new Date(Date.now()+Math.min(3600,2**(row.attempts+1))*1000),lastError:'Telegram command delivery failed'}});
 }
 return true;
}
