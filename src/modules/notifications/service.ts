import {withTelegramCommunity} from '@/lib/telegram-community';
import {isSubmissionFeeOnly} from '../auctions/rules';
import {campaignContent,scheduleGlobalAlerts,telegramKinds} from './campaigns';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import type {Prisma,Outbox} from '@prisma/client';
import {InputFile} from 'grammy';
import {demoBidAllowed} from '../auctions/bids';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {chapaReceiptContent,chapaReceiptKind} from './chapa-receipt';
import {notificationRetired} from './policy';
type DB=Prisma.TransactionClient;
const notificationImage=resolve('public/notification.png');
const composedPhotos=new Map<string,Promise<Buffer|null>>();

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
 let pending=composedPhotos.get(cacheKey);
 if(!pending){
  pending=(async()=>{
  const media=await tx.managedMedia.findUnique({where:{id:imageId},select:{bytes:true}});
  if(!media)return null;
  const base=await sharp(Buffer.from(media.bytes)).resize(900,900,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const {width=900,height=900}=await sharp(base).metadata();
  const badge=await sharp(imagePath).resize({width:Math.max(72,Math.round(width*0.2)),height:Math.max(72,Math.round(height*0.2)),fit:'inside'}).png().toBuffer();
  const size=await sharp(badge).metadata();
  return sharp(base).composite([{input:badge,left:Math.max(0,width-(size.width??0)-12),top:Math.max(0,height-(size.height??0)-12)}]).png().toBuffer();
  })();
  if(composedPhotos.size>=10)composedPhotos.clear();
  composedPhotos.set(cacheKey,pending);
 }
 let photo:Buffer|null;try{photo=await pending}catch(error){composedPhotos.delete(cacheKey);throw error}
 if(!photo){composedPhotos.delete(cacheKey);return new InputFile(imagePath)}
 return new InputFile(photo,'notification.png');
}
const words:Record<string,[string,string]>={AUCTION_MINIMUM_CANCELLED:['Auction cancelled: participant minimum not met','Fewer than two eligible participants entered. All entry fees were refunded and all holds released.'],AUCTION_FALLBACK_WON:['You won: first accepted lowest bid','No amount was unique. Your bid at the lowest amount was accepted first by the database. View your final result and delivery details.'],BID_ACCEPTED:['Bid accepted','Your accepted receipt is ready in My Bids.'],AUCTION_CLOSED:['Auction closed','Your result and released holds are ready to review.'],AUCTION_WON:['You won this auction','Your settled result is ready. Claim instructions are in your wins.'],AUCTION_NO_WINNER:['No unique winner','This auction closed without a winner. Holds were released; disclosed entry fees were retained.'],AUCTION_CANCELLED:['Auction cancelled','Auction holds were released and charged entry fees were refunded.'],FULFILLMENT_UPDATED:['Delivery update','Open your win to review its fulfillment status.'],AUCTION_START:['A saved auction is open','Your saved auction is now open.'],FAVORITE_ENDING:['A saved auction ends soon','Open your saved auction to check its closing time.']};
export async function notificationContent(tx:DB,row:Pick<Outbox,'kind'|'payload'>){
 if(notificationRetired(row.kind))return null;
 if(row.kind===chapaReceiptKind)return chapaReceiptContent(tx,row);
 if(telegramKinds.includes(row.kind))return campaignContent(tx,row);
 const p=row.payload as {auctionId?:string;recipientUserId?:string};if(!p.recipientUserId||!p.auctionId)return null;
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{terms:{select:{ruleVersion:true}},slug:true,code:true,publicCode:true,isDemo:true,isSettlementFixture:true,result:{select:{id:true}},settlement:{select:{publication:{select:{publishedAt:true}},decision:true,outcome:true,winnerUserId:true}}}});
 if(!a||a.result||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 if(a.settlement&&!a.settlement.publication&&row.kind!=='BID_ACCEPTED')return null;
 // Older cancellation jobs may still be pending when the new code is deployed.
 if(a.settlement?.outcome==='CANCELLED'&&row.kind==='AUCTION_CANCELLED')return null;
 const kind=row.kind==='AUCTION_CANCELLED'&&a.settlement?.decision==='MINIMUM_PARTICIPANTS'?'AUCTION_MINIMUM_CANCELLED':row.kind==='AUCTION_CLOSED'?(a.settlement?.winnerUserId===p.recipientUserId?(a.settlement.decision==='FIRST_ACCEPTED_LOWEST'?'AUCTION_FALLBACK_WON':'AUCTION_WON'):a.settlement?.outcome==='NO_WINNER'?'AUCTION_NO_WINNER':row.kind):row.kind;
 const copy=words[kind];if(!copy)return null;
 const href=kind==='BID_ACCEPTED'?'/my-bids':kind==='FULFILLMENT_UPDATED'||kind==='AUCTION_WON'||kind==='AUCTION_FALLBACK_WON'?'/winning-bids':`/auctions/${a.publicCode}`;
 return {userId:p.recipientUserId,kind,title:`${a.isDemo?'DEMO · ':''}${copy[0]}`,body:isSubmissionFeeOnly(a.terms?.ruleVersion)&&['AUCTION_CANCELLED','AUCTION_MINIMUM_CANCELLED'].includes(kind)?'Auction cancelled. Accepted submission fees are non-refundable.':isSubmissionFeeOnly(a.terms?.ruleVersion)&&kind==='AUCTION_CLOSED'?'Your result is ready. The chosen number is not charged.':copy[1],href};
}
export async function materializeAlert(tx:DB,row:Pick<Outbox,'key'|'kind'|'payload'>&Partial<Pick<Outbox,'testRunId'>>,prepared?:Awaited<ReturnType<typeof notificationContent>>){
 // Broadcasts and Chapa receipts are Telegram-only. The payment transaction
 // retains its existing private alert; delivery must not add another inbox item.
 if(notificationRetired(row.kind)||row.kind==='BROADCAST'||row.kind===chapaReceiptKind)return;
 const content=prepared===undefined?await notificationContent(tx,row):prepared;if(!content)return;
 if(row.kind==='AUCTION_RESULT'){
  const preference=await tx.notificationPreference.findUnique({where:{userId:content.userId},select:{inApp:true}});
  if(preference?.inApp!==true)return;
 }

 await tx.notificationInbox.upsert({where:{key:row.key},create:{key:row.key,userId:content.userId,kind:content.kind,title:content.title,body:content.body,href:content.href,testRunId:row.testRunId},update:{}});
}
export async function enqueueAlert(tx:DB,input:{key:string;kind:string;auctionId:string;userId:string}){
 const auction=await tx.auction.findUnique({where:{id:input.auctionId},select:{testRunId:true}});
 const row=await tx.outbox.create({data:{key:input.key,kind:input.kind,payload:{auctionId:input.auctionId,recipientUserId:input.userId},testRunId:auction?.testRunId}});
 await materializeAlert(tx,row);return row;
}
export const scheduleAlerts=scheduleGlobalAlerts;
export {dispatchOne,dispatchBatch,expandPendingCampaigns} from './dispatch';

export async function retireAuctionPromotions(tx:DB,auctionId:string,now:Date){
 const promotional=['AUCTION_PUBLISHED','AUCTION_UPCOMING','AUCTION_STARTING_SOON','AUCTION_ENDING','GLOBAL_CAMPAIGN'];
 const jobs=await tx.outbox.findMany({where:{kind:{in:promotional},payload:{path:['auctionId'],equals:auctionId}},select:{id:true,key:true,state:true}});
 if(jobs.length)await tx.notificationInbox.deleteMany({where:{key:{in:jobs.map(job=>job.key)}}});
 const pending=jobs.filter(job=>job.state==='PENDING');
 const stopped=pending.length?await tx.outbox.updateMany({where:{id:{in:pending.map(job=>job.id)},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'SKIPPED',lastError:'AUCTION_RETIRED',leaseToken:null,leaseUntil:null}}):{count:0};
 const messages=await tx.telegramMessage.findMany({where:{auctionId,deletionState:'DELIVERED'}});let queued=0,unavailable=0;
 for(const message of messages){
  if(now.getTime()-message.sentAt.getTime()>=47*3600000){await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});unavailable++;continue}
  await tx.outbox.create({data:{key:`telegram-delete:${message.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:message.id},testRunId:message.testRunId}});
  await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'QUEUED',deletionRequestedAt:now}});queued++;
 }
 return {pendingSkipped:stopped.count,telegramDeletesQueued:queued,telegramDeletesUnavailable:unavailable};
}

export async function retireAuctionEndingAlerts(tx:DB,auctionId:string,now:Date){
 const candidates=await tx.outbox.findMany({where:{kind:{in:['GLOBAL_CAMPAIGN','AUCTION_ENDING']},payload:{path:['auctionId'],equals:auctionId}},select:{id:true,key:true,kind:true,state:true,payload:true}});
 const jobs=candidates.filter(row=>row.kind==='AUCTION_ENDING'||(row.payload as {deliveryKind?:string}).deliveryKind==='AUCTION_ENDING');if(!jobs.length)return {endingAlertsRetired:0,telegramDeletesQueued:0,telegramDeletesUnavailable:0};
 await tx.notificationInbox.deleteMany({where:{key:{in:jobs.map(row=>row.key)}}});const pending=jobs.filter(row=>row.state==='PENDING');if(pending.length)await tx.outbox.updateMany({where:{id:{in:pending.map(row=>row.id)},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'SKIPPED',lastError:'SUPERSEDED_BY_DEADLINE_CHANGE',leaseToken:null,leaseUntil:null}});
 const messages=await tx.telegramMessage.findMany({where:{outboxId:{in:jobs.map(row=>row.id)},deletionState:'DELIVERED'}});let queued=0,unavailable=0;
 for(const message of messages){if(now.getTime()-message.sentAt.getTime()>=47*3600000){await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});unavailable++;continue}await tx.outbox.create({data:{key:`telegram-delete:${message.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:message.id},testRunId:message.testRunId}});await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'QUEUED',deletionRequestedAt:now}});queued++}
 return {endingAlertsRetired:jobs.length,telegramDeletesQueued:queued,telegramDeletesUnavailable:unavailable};
}
