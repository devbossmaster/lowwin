import {campaignContent,expandCampaign,scheduleGlobalAlerts,telegramKinds} from './campaigns';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import type {Bot} from 'grammy';
import {demoBidAllowed} from '../auctions/bids';
type DB=Prisma.TransactionClient;
const words:Record<string,[string,string]>={AUCTION_MINIMUM_CANCELLED:['Auction cancelled: participant minimum not met','Fewer than two eligible participants entered. All entry fees were refunded and all holds released.'],AUCTION_FALLBACK_WON:['You won: first accepted lowest bid','No amount was unique. Your bid at the lowest amount was accepted first by the database. View your final result and delivery details.'],BID_ACCEPTED:['Bid accepted','Your accepted receipt is ready in My Bids.'],AUCTION_CLOSED:['Auction closed','Your result and released holds are ready to review.'],AUCTION_WON:['You won this auction','Your settled result is ready. Claim instructions are in your wins.'],AUCTION_NO_WINNER:['No unique winner','This auction closed without a winner. Holds were released; disclosed entry fees were retained.'],AUCTION_CANCELLED:['Auction cancelled','Auction holds were released and charged entry fees were refunded.'],FULFILLMENT_UPDATED:['Delivery update','Open your win to review its fulfillment status.'],AUCTION_START:['A saved auction is open','Your saved auction is now open.'],FAVORITE_ENDING:['A saved auction ends soon','Open your saved auction to check its closing time.']};
export async function notificationContent(tx:DB,row:Pick<Outbox,'kind'|'payload'>){
 if(telegramKinds.includes(row.kind))return campaignContent(tx,row);
 const p=row.payload as {auctionId?:string;recipientUserId?:string};if(!p.recipientUserId||!p.auctionId)return null;
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{slug:true,code:true,isDemo:true,isSettlementFixture:true,result:{select:{id:true}},settlement:{select:{decision:true,outcome:true,winnerUserId:true}}}});
 if(!a||a.result||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 const kind=row.kind==='AUCTION_CANCELLED'&&a.settlement?.decision==='MINIMUM_PARTICIPANTS'?'AUCTION_MINIMUM_CANCELLED':row.kind==='AUCTION_CLOSED'?(a.settlement?.winnerUserId===p.recipientUserId?(a.settlement.decision==='FIRST_ACCEPTED_LOWEST'?'AUCTION_FALLBACK_WON':'AUCTION_WON'):a.settlement?.outcome==='NO_WINNER'?'AUCTION_NO_WINNER':row.kind):row.kind;
 const copy=words[kind];if(!copy)return null;
 const href=kind==='BID_ACCEPTED'?'/my-bids':kind==='FULFILLMENT_UPDATED'||kind==='AUCTION_WON'||kind==='AUCTION_FALLBACK_WON'?'/profile/wins':a.settlement?`/winners/${a.code}`:`/auctions/${a.slug}`;
 return {userId:p.recipientUserId,kind,title:`${a.isDemo?'DEMO · ':''}${copy[0]}`,body:copy[1],href};
}
export async function materializeAlert(tx:DB,row:Pick<Outbox,'key'|'kind'|'payload'>){
 const content=await notificationContent(tx,row);if(!content)return;

 await tx.notificationInbox.upsert({where:{key:row.key},create:{key:row.key,userId:content.userId,kind:content.kind,title:content.title,body:content.body,href:content.href},update:{}});
}
export async function enqueueAlert(tx:DB,input:{key:string;kind:string;auctionId:string;userId:string}){
 const row=await tx.outbox.create({data:{key:input.key,kind:input.kind,payload:{auctionId:input.auctionId,recipientUserId:input.userId}}});
 await materializeAlert(tx,row);return row;
}
export const scheduleAlerts=scheduleGlobalAlerts;
/** Row lock is held during a bounded external call. Crash after send but before
 * commit may repeat a message; never repeats a ledger operation. */
export async function dispatchOne(client:PrismaClient,bot:Pick<Bot,'api'>){
 return client.$transaction(async tx=>{
  const rows=await tx.$queryRaw<Outbox[]>`SELECT * FROM "Outbox" WHERE state='PENDING' AND "nextAttemptAt"<=clock_timestamp() ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1`;
  const row=rows[0];if(!row)return false;
  const skip=()=>tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:null}});
  if(row.kind==='GLOBAL_CAMPAIGN'||row.kind==='AUCTION_FINALIZED'){await expandCampaign(tx,row);return true}
  const content=await notificationContent(tx,row);
  if(!content){await skip();return true}
  await materializeAlert(tx,row);
  // These are the only automatic Telegram categories. Legacy private inbox
  // receipts remain readable, but their jobs no longer send Telegram messages.
  if(!telegramKinds.includes(row.kind)){await skip();return true}
  const user=await tx.user.findUnique({where:{id:content.userId},select:{telegramId:true,name:true}}),chat=user?.telegramId?await tx.botChat.findUnique({where:{telegramId:user.telegramId}}):null;
  if(!chat||chat.blocked){await skip();return true}
  const link=new URL(content.href,process.env.MINI_APP_URL);
  if(link.protocol!=='https:'){await skip();return true}
  try{
   const name=(user?.name??'Lowwin player').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,80);
   const body=content.body.includes('{name}')?content.body.replaceAll('{name}',name):`${name},\n${content.body}`;
   const text=`${content.title}\n${body}`.slice(0,1000);
   const options={reply_markup:{inline_keyboard:[[{text:'Bid',web_app:{url:link.href}}]]}};
   if('imageId' in content&&content.imageId){
    // The validated image is stored once; our media endpoint caches its bytes.
    const photo=new URL(`/api/media/${content.imageId}`,process.env.MINI_APP_URL);
    await bot.api.sendPhoto(chat.chatId,photo.href,{...options,caption:text});
   }else await bot.api.sendMessage(chat.chatId,text,options);
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
