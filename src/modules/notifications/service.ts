import {withTelegramCommunity} from '@/lib/telegram-community';
import {isSubmissionFeeOnly} from '../auctions/rules';
import {auctionMaintenance} from '../auctions/maintenance';
import {broadcastRoot,broadcastStopped,campaignContent,expandCampaign,scheduleGlobalAlerts,telegramKinds} from './campaigns';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {InputFile,type Bot} from 'grammy';
import {demoBidAllowed} from '../auctions/bids';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
type DB=Prisma.TransactionClient;
const notificationImage=resolve('public/notification.png');
const composedPhotos=new Map<string,Buffer>();

export function telegramCampaignText(kind:string,title:string,body:string,name?:string){
 if(name&&(kind==='AUCTION_UPCOMING'||kind==='AUCTION_STARTING_SOON')){
  const [item,englishTime,amharicTime,englishAction,amharicAction]=body.split('\n');
  if(item&&englishTime&&amharicTime&&englishAction&&amharicAction)
   return withTelegramCommunity(`${name},\n\n${title}\n\n${item}\n\n${englishTime}\n${amharicTime}\n\n${englishAction}\n${amharicAction}`);
 }
 return withTelegramCommunity(kind==='BROADCAST'?body:`${title}\n${body}`);
}

export async function notificationPhoto(tx:DB,imageId:string|undefined,origin:string,imagePath=notificationImage){
 const custom=imageId?new URL(`/api/media/${imageId}`,origin).href:null;
 if(!existsSync(imagePath))return custom;
 if(!imageId)return new InputFile(imagePath);
 const cacheKey=`${imagePath}:${imageId}:${statSync(imagePath).mtimeMs}`;
 let photo=composedPhotos.get(cacheKey);
 if(!photo){
  const media=await tx.managedMedia.findUnique({where:{id:imageId},select:{bytes:true}});
  if(!media)return new InputFile(imagePath);
  const base=await sharp(Buffer.from(media.bytes)).resize(900,900,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const {width=900,height=900}=await sharp(base).metadata();
  const badge=await sharp(imagePath).resize({width:Math.max(72,Math.round(width*0.2)),height:Math.max(72,Math.round(height*0.2)),fit:'inside'}).png().toBuffer();
  const size=await sharp(badge).metadata();
  photo=await sharp(base).composite([{input:badge,left:Math.max(0,width-(size.width??0)-12),top:Math.max(0,height-(size.height??0)-12)}]).png().toBuffer();
  if(composedPhotos.size>=10)composedPhotos.clear();
  composedPhotos.set(cacheKey,photo);
 }
 return new InputFile(photo,'notification.png');
}
const words:Record<string,[string,string]>={AUCTION_MINIMUM_CANCELLED:['Auction cancelled: participant minimum not met','Fewer than two eligible participants entered. All entry fees were refunded and all holds released.'],AUCTION_FALLBACK_WON:['You won: first accepted lowest bid','No amount was unique. Your bid at the lowest amount was accepted first by the database. View your final result and delivery details.'],BID_ACCEPTED:['Bid accepted','Your accepted receipt is ready in My Bids.'],AUCTION_CLOSED:['Auction closed','Your result and released holds are ready to review.'],AUCTION_WON:['You won this auction','Your settled result is ready. Claim instructions are in your wins.'],AUCTION_NO_WINNER:['No unique winner','This auction closed without a winner. Holds were released; disclosed entry fees were retained.'],AUCTION_CANCELLED:['Auction cancelled','Auction holds were released and charged entry fees were refunded.'],FULFILLMENT_UPDATED:['Delivery update','Open your win to review its fulfillment status.'],AUCTION_START:['A saved auction is open','Your saved auction is now open.'],FAVORITE_ENDING:['A saved auction ends soon','Open your saved auction to check its closing time.']};
export async function notificationContent(tx:DB,row:Pick<Outbox,'kind'|'payload'>){
 if(telegramKinds.includes(row.kind))return campaignContent(tx,row);
 const p=row.payload as {auctionId?:string;recipientUserId?:string};if(!p.recipientUserId||!p.auctionId)return null;
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{terms:{select:{ruleVersion:true}},slug:true,code:true,publicCode:true,isDemo:true,isSettlementFixture:true,result:{select:{id:true}},settlement:{select:{decision:true,outcome:true,winnerUserId:true}}}});
 if(!a||a.result||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 // Older cancellation jobs may still be pending when the new code is deployed.
 if(a.settlement?.outcome==='CANCELLED'&&row.kind==='AUCTION_CANCELLED')return null;
 const kind=row.kind==='AUCTION_CANCELLED'&&a.settlement?.decision==='MINIMUM_PARTICIPANTS'?'AUCTION_MINIMUM_CANCELLED':row.kind==='AUCTION_CLOSED'?(a.settlement?.winnerUserId===p.recipientUserId?(a.settlement.decision==='FIRST_ACCEPTED_LOWEST'?'AUCTION_FALLBACK_WON':'AUCTION_WON'):a.settlement?.outcome==='NO_WINNER'?'AUCTION_NO_WINNER':row.kind):row.kind;
 const copy=words[kind];if(!copy)return null;
 const href=kind==='BID_ACCEPTED'?'/my-bids':kind==='FULFILLMENT_UPDATED'||kind==='AUCTION_WON'||kind==='AUCTION_FALLBACK_WON'?'/winning-bids':`/auctions/${a.publicCode}`;
 return {userId:p.recipientUserId,kind,title:`${a.isDemo?'DEMO · ':''}${copy[0]}`,body:isSubmissionFeeOnly(a.terms?.ruleVersion)&&['AUCTION_CANCELLED','AUCTION_MINIMUM_CANCELLED'].includes(kind)?'Auction cancelled. Accepted submission fees are non-refundable.':isSubmissionFeeOnly(a.terms?.ruleVersion)&&kind==='AUCTION_CLOSED'?'Your result is ready. The chosen number is not charged.':copy[1],href};
}
export async function materializeAlert(tx:DB,row:Pick<Outbox,'key'|'kind'|'payload'>&Partial<Pick<Outbox,'testRunId'>>){
 // Admin broadcasts are delivered only by the Telegram worker, including jobs
 // queued by an older release. They never create a Mini App inbox item.
 if(row.kind==='BROADCAST')return;
 const content=await notificationContent(tx,row);if(!content)return;

 await tx.notificationInbox.upsert({where:{key:row.key},create:{key:row.key,userId:content.userId,kind:content.kind,title:content.title,body:content.body,href:content.href,testRunId:row.testRunId},update:{}});
}
export async function enqueueAlert(tx:DB,input:{key:string;kind:string;auctionId:string;userId:string}){
 const auction=await tx.auction.findUnique({where:{id:input.auctionId},select:{testRunId:true}});
 const row=await tx.outbox.create({data:{key:input.key,kind:input.kind,payload:{auctionId:input.auctionId,recipientUserId:input.userId},testRunId:auction?.testRunId}});
 await materializeAlert(tx,row);return row;
}
export const scheduleAlerts=scheduleGlobalAlerts;
/** Row lock is held during a bounded external call. Crash after send but before
 * commit may repeat a message; never repeats a ledger operation. */
export async function dispatchOne(client:PrismaClient,bot:Pick<Bot,'api'>){
 return client.$transaction(async tx=>{
  // The shared barrier is held until this bounded delivery finishes. A reset
  // halt waits for current deliveries, then prevents new claims or fan-out.
  if(await auctionMaintenance(tx))return false;
  const rows=await tx.$queryRaw<Outbox[]>`SELECT * FROM "Outbox" WHERE state='PENDING' AND "nextAttemptAt"<=clock_timestamp() ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1`;
  const row=rows[0];if(!row)return false;
  const root=broadcastRoot(row);
  if(root){
   // Nonblocking after taking the outbox row lock: Stop can safely acquire the
   // campaign lock first and then wait for rows, without a lock-order deadlock.
   const [{locked}]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`broadcast:${root}`},0)) AS locked`;
   if(!locked)return false;
   if(await broadcastStopped(tx,root)){await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'CAMPAIGN_STOPPED'}});return true}
  }
  const skip=()=>tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:null}});
  if(row.kind==='TELEGRAM_DELETE'){
   const payload=row.payload as {telegramMessageId?:string};const record=payload.telegramMessageId?await tx.telegramMessage.findUnique({where:{id:payload.telegramMessageId}}):null;
   if(!record||!['QUEUED','FAILED'].includes(record.deletionState)){await skip();return true}
   try{
    await bot.api.deleteMessage(record.chatId,Number(record.messageId));
    await tx.telegramMessage.update({where:{id:record.id},data:{deletionState:'DELETED',deletionAttemptedAt:new Date(),deletionError:null}});
    await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:new Date(),attempts:{increment:1},lastError:null}});
   }catch(error){const code=(error as {error_code?:number}).error_code,attempts=row.attempts+1,terminal=code===400||code===403||attempts>=4;await tx.telegramMessage.update({where:{id:record.id},data:{deletionState:terminal?'UNAVAILABLE':'FAILED',deletionAttemptedAt:new Date(),deletionError:code===400?'DELETE_WINDOW_OR_MESSAGE_UNAVAILABLE':code===403?'CHAT_BLOCKED':'DELETE_RETRY'}});await tx.outbox.update({where:{id:row.id},data:{state:terminal?'FAILED':'PENDING',attempts,lastError:'TELEGRAM_DELETE_FAILED',nextAttemptAt:new Date(Date.now()+Math.min(3600,2**attempts*5)*1000)}})}
   return true;
  }
  if(row.kind==='GLOBAL_CAMPAIGN'||row.kind==='AUCTION_FINALIZED'){await expandCampaign(tx,row);return true}
  const content=await notificationContent(tx,row);
  if(!content){await skip();return true}
  await materializeAlert(tx,row);
  if(row.testRunId){await skip();return true}
  // These are the only automatic Telegram categories. Legacy private inbox
  // receipts remain readable, but their jobs no longer send Telegram messages.
  if(!telegramKinds.includes(row.kind)){await skip();return true}
  const user=await tx.user.findUnique({where:{id:content.userId},select:{telegramId:true,name:true}}),chat=user?.telegramId?await tx.botChat.findUnique({where:{telegramId:user.telegramId}}):null;
  if(!chat||chat.blocked){await skip();return true}
  const link=new URL(content.href,process.env.MINI_APP_URL);
  if(link.protocol!=='https:'){await skip();return true}
  try{
   const name=(user?.name??'Lowwin player').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,80);
   const startReminder=row.kind==='AUCTION_UPCOMING'||row.kind==='AUCTION_STARTING_SOON';
   const body=content.body.includes('{name}')?content.body.replaceAll('{name}',name):`${name},\n${content.body}`;
   const text=telegramCampaignText(row.kind,content.title,startReminder?content.body:body,startReminder?name:undefined);
   const button=row.kind==='BROADCAST'&&'buttonLabel' in content?String(content.buttonLabel):row.kind==='DEPOSIT_CREDITED'?'View wallet':startReminder?'View auction':'Bid';
   const options={reply_markup:{inline_keyboard:[[{text:button,web_app:{url:link.href}}]]}};
   let sent:{message_id:number};
   const photo=await notificationPhoto(tx,'imageId' in content?content.imageId:undefined,link.origin);
   sent=photo?await bot.api.sendPhoto(chat.chatId,photo,{...options,caption:text}):await bot.api.sendMessage(chat.chatId,text,options);
   const payload=row.payload as {auctionId?:string};
   await tx.telegramMessage.create({data:{outboxId:row.id,auctionId:payload.auctionId,testRunId:row.testRunId,chatId:chat.chatId,messageId:BigInt(sent.message_id)}});
   await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:new Date(),attempts:{increment:1},lastError:null}});
  }catch(error){
   const e=error as {error_code?:number;parameters?:{retry_after?:number}},attempts=row.attempts+1;
   if(e.error_code===403)await tx.botChat.update({where:{telegramId:chat.telegramId},data:{blocked:true}});
   const terminal=e.error_code===403||attempts>=8||e.error_code===400;
   const retry=e.error_code===429?Math.max(1,Math.min(86400,Number(e.parameters?.retry_after)||60)):Math.min(3600,2**attempts*5);
   await tx.outbox.update({where:{id:row.id},data:{attempts,state:terminal?'FAILED':'PENDING',lastError:e.error_code===429?'RATE_LIMIT':e.error_code===403?'CHAT_BLOCKED':e.error_code===400?'BAD_REQUEST':'DELIVERY_RETRY',nextAttemptAt:new Date(Date.now()+retry*1000)}});
  }
  return true;
 },{timeout:30000,maxWait:5000});
}

export async function retireAuctionPromotions(tx:DB,auctionId:string,now:Date){
 const promotional=['AUCTION_PUBLISHED','AUCTION_UPCOMING','AUCTION_STARTING_SOON','AUCTION_ENDING','GLOBAL_CAMPAIGN'];
 const jobs=await tx.outbox.findMany({where:{kind:{in:promotional},payload:{path:['auctionId'],equals:auctionId}},select:{id:true,key:true,state:true}});
 if(jobs.length)await tx.notificationInbox.deleteMany({where:{key:{in:jobs.map(job=>job.key)}}});
 const pending=jobs.filter(job=>job.state==='PENDING');
 if(pending.length)await tx.outbox.updateMany({where:{id:{in:pending.map(job=>job.id)}},data:{state:'SKIPPED',lastError:'AUCTION_RETIRED'}});
 const messages=await tx.telegramMessage.findMany({where:{auctionId,deletionState:'DELIVERED'}});let queued=0,unavailable=0;
 for(const message of messages){
  if(now.getTime()-message.sentAt.getTime()>=47*3600000){await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});unavailable++;continue}
  await tx.outbox.create({data:{key:`telegram-delete:${message.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:message.id},testRunId:message.testRunId}});
  await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'QUEUED',deletionRequestedAt:now}});queued++;
 }
 return {pendingSkipped:pending.length,telegramDeletesQueued:queued,telegramDeletesUnavailable:unavailable};
}

export async function retireAuctionEndingAlerts(tx:DB,auctionId:string,now:Date){
 const candidates=await tx.outbox.findMany({where:{kind:{in:['GLOBAL_CAMPAIGN','AUCTION_ENDING']},payload:{path:['auctionId'],equals:auctionId}},select:{id:true,key:true,kind:true,state:true,payload:true}});
 const jobs=candidates.filter(row=>row.kind==='AUCTION_ENDING'||(row.payload as {deliveryKind?:string}).deliveryKind==='AUCTION_ENDING');if(!jobs.length)return {endingAlertsRetired:0,telegramDeletesQueued:0,telegramDeletesUnavailable:0};
 await tx.notificationInbox.deleteMany({where:{key:{in:jobs.map(row=>row.key)}}});const pending=jobs.filter(row=>row.state==='PENDING');if(pending.length)await tx.outbox.updateMany({where:{id:{in:pending.map(row=>row.id)}},data:{state:'SKIPPED',lastError:'SUPERSEDED_BY_DEADLINE_CHANGE'}});
 const messages=await tx.telegramMessage.findMany({where:{outboxId:{in:jobs.map(row=>row.id)},deletionState:'DELIVERED'}});let queued=0,unavailable=0;
 for(const message of messages){if(now.getTime()-message.sentAt.getTime()>=47*3600000){await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});unavailable++;continue}await tx.outbox.create({data:{key:`telegram-delete:${message.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:message.id},testRunId:message.testRunId}});await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'QUEUED',deletionRequestedAt:now}});queued++}
 return {endingAlertsRetired:jobs.length,telegramDeletesQueued:queued,telegramDeletesUnavailable:unavailable};
}
