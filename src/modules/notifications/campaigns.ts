import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {demoBidAllowed} from '../auctions/bids';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import {formatEtb} from '@/lib/money';

type Tx=Prisma.TransactionClient;
export const telegramKinds=['AUCTION_PUBLISHED','AUCTION_ENDING','AUCTION_RESULT','DEPOSIT_CREDITED','BROADCAST'];
export type CampaignPayload={auctionId?:string;recipientUserId?:string;intentId?:string;body?:string;imageId?:string;href?:string;cursor?:string;audienceBefore?:string;rootKey?:string;deliveryKind?:string};
export async function queueGlobal(tx:Tx,key:string,kind:string,payload:CampaignPayload){
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 return tx.outbox.upsert({where:{key},create:{key,kind:'GLOBAL_CAMPAIGN',payload:{...payload,deliveryKind:kind,audienceBefore:now.toISOString(),rootKey:key}},update:{}});
}
/** Each immutable batch records its cursor in a NEW intent. Recipients are
 * bounded by the event time; retrying a page cannot add duplicate deliveries. */
export async function expandCampaign(tx:Tx,row:Outbox){
 const p=row.payload as CampaignPayload;
 const rootKey=p.rootKey??row.key,before=new Date(p.audienceBefore??row.createdAt.toISOString());
 const users=await tx.user.findMany({where:{staffMember:{is:null},telegramId:{not:null},createdAt:{lte:before},...(p.cursor?{id:{gt:p.cursor}}:{})},select:{id:true},orderBy:{id:'asc'},take:250});
 const kind=row.kind==='AUCTION_FINALIZED'?'AUCTION_RESULT':p.deliveryKind;
 if(!kind||!telegramKinds.includes(kind))throw Error('Unknown campaign kind');
 const {cursor:_cursor,audienceBefore:_before,rootKey:_root,deliveryKind:_kind,...content}=p;
 if(users.length)await tx.outbox.createMany({data:users.map(user=>({key:`${rootKey}:user:${user.id}`,kind,payload:{...content,recipientUserId:user.id}})),skipDuplicates:true});
 if(users.length===250){const cursor=users.at(-1)!.id;await tx.outbox.upsert({where:{key:`${rootKey}:after:${cursor}`},create:{key:`${rootKey}:after:${cursor}`,kind:'GLOBAL_CAMPAIGN',payload:{...p,deliveryKind:kind,rootKey,audienceBefore:before.toISOString(),cursor}},update:{}})}
 await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:new Date()}});
 return users.length;
}
export async function scheduleGlobalAlerts(client:PrismaClient){
 const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 let cursor:string|undefined,created=0;
 for(;;){
  const auctions=await client.auction.findMany({where:{publishedAt:{lte:now},status:{in:['LIVE','SCHEDULED']},startsAt:{lte:now},endsAt:{gt:now,lt:new Date(now.getTime()+86400000)},settlement:{is:null},result:{is:null},...(cursor?{id:{gt:cursor}}:{})},select:{id:true,isDemo:true,isSettlementFixture:true},orderBy:{id:'asc'},take:100});
  const allowed=auctions.filter(a=>!a.isDemo||a.isSettlementFixture&&(demoBidAllowed()||stagingDemoEnabled()));
  if(allowed.length)created+=(await client.outbox.createMany({data:allowed.map(a=>({key:`global:ending:${a.id}`,kind:'GLOBAL_CAMPAIGN',payload:{auctionId:a.id,deliveryKind:'AUCTION_ENDING',rootKey:`global:ending:${a.id}`,audienceBefore:now.toISOString()}})),skipDuplicates:true})).count;
  if(auctions.length<100)break;cursor=auctions.at(-1)!.id;
 }
 return created;
}
export async function campaignContent(tx:Tx,row:Pick<Outbox,'kind'|'payload'>){
 const p=row.payload as CampaignPayload;if(!p.recipientUserId||!telegramKinds.includes(row.kind))return null;
 const base={userId:p.recipientUserId,kind:row.kind,imageId:undefined as string|undefined};
 if(row.kind==='BROADCAST'){
  if(!p.body||!p.href||!/^\/(?:auctions\/[-a-z0-9]+|auctions\/all)$/.test(p.href))return null;
  return {...base,title:'Lowwin update · የLowwin መረጃ',body:p.body,href:p.href,imageId:p.imageId};
 }
 if(row.kind==='DEPOSIT_CREDITED'){
  if(!p.intentId)return null;
  const t=await tx.topUpIntent.findUnique({where:{id:p.intentId},select:{userId:true,status:true,points:true}});
  if(!t||t.userId!==p.recipientUserId||t.status!=='CREDITED')return null;
  return {...base,title:'Deposit successful · ገንዘቡ ገብቷል',body:`${formatEtb(t.points)} has been added to your wallet.\n${formatEtb(t.points)} ወደ ሂሳብዎ ገብቷል።`,href:'/auctions/all'};
 }
 if(!p.auctionId)return null;
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{slug:true,publicCode:true,publishedAt:true,startsAt:true,endsAt:true,status:true,isDemo:true,isSettlementFixture:true,product:{select:{title:true,visible:true}},result:{select:{id:true}},settlement:{select:{outcome:true,decision:true}}}});
 if(!a?.publishedAt||!a.slug||a.result||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 const prefix=a.isDemo?'DEMO · ':'',item=`${a.product?.title??'Auction'} · #${a.publicCode}`;
 if(row.kind==='AUCTION_RESULT'){
  if(!a.settlement)return null;
  const outcome=a.settlement.outcome==='WINNER'?'A winner has been announced. See the final result.\nአሸናፊው ታውቋል። የመጨረሻ ውጤቱን ይመልከቱ።':a.settlement.outcome==='CANCELLED'?'The auction was cancelled. Entry fees and holds were returned.\nጨረታው ተሰርዟል። ክፍያዎችና የተያዘው ገንዘብ ተመልሰዋል።':'The auction closed without a winner.\nጨረታው ያለ አሸናፊ ተዘግቷል።';
  return {...base,title:`${prefix}Auction finished · ጨረታው ተጠናቋል`,body:`${item}\n${outcome}\n${new URL(`/winners/${a.publicCode}`,process.env.MINI_APP_URL).href}`,href:`/auctions/${a.slug}`};
 }
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 if(!['LIVE','SCHEDULED'].includes(a.status)||!a.product?.visible||!a.endsAt||a.endsAt<=now)return null;
 if(row.kind==='AUCTION_ENDING'&&(!a.startsAt||a.startsAt>now||a.endsAt.getTime()-now.getTime()>=86400000))return null;
 return {...base,title:prefix+(row.kind==='AUCTION_ENDING'?'Less than one day left · ከአንድ ቀን ያነሰ ጊዜ ቀርቷል':'New auction · አዲስ ጨረታ'),body:`${item}\n${row.kind==='AUCTION_ENDING'?'Check the closing time and place your bid.\nየመዝጊያ ሰዓቱን ይመልከቱና ጨረታዎን ያቅርቡ።':'View the item and its auction terms.\nዕቃውንና የጨረታውን ውሎች ይመልከቱ።'}`,href:`/auctions/${a.slug}`};
}
