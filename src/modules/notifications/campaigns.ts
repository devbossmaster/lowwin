import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {demoBidAllowed} from '../auctions/bids';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import {formatEtb} from '@/lib/money';
import {auctionMaintenance} from '../auctions/maintenance';
import {broadcastMiniAppPath,broadcastButtonLabel} from '@/lib/broadcast-link';

type Tx=Prisma.TransactionClient;
export const telegramKinds=['AUCTION_PUBLISHED','AUCTION_UPCOMING','AUCTION_STARTING_SOON','AUCTION_ENDING','AUCTION_RESULT','DEPOSIT_CREDITED','BROADCAST'];
/** Only a published product's own local image may accompany its auction alert. */
export function auctionNotificationImagePath(presentation:unknown,productPath?:string){
 const image=typeof presentation==='object'&&presentation!==null&&'images' in presentation&&Array.isArray(presentation.images)?presentation.images[0]:null;
 const path=typeof image?.path==='string'?image.path:productPath;
 if(!path||path.includes('..'))return undefined;
 return /^\/api\/media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path)||/^\/(?:images|products)\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g)$/i.test(path)?path:undefined;
}
export function auctionNotificationImageId(presentation:unknown,productPath?:string){
 return /^\/api\/media\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(auctionNotificationImagePath(presentation,productPath)??'')?.[1];
}
export type CampaignPayload={auctionId?:string;recipientUserId?:string;intentId?:string;body?:string;imageId?:string;href?:string;buttonLabel?:string;telegramOnly?:boolean;cursor?:string;audienceBefore?:string;rootKey?:string;deliveryKind?:string};
export function broadcastRoot(row:Pick<Outbox,'kind'|'key'|'payload'>){
 const p=row.payload as CampaignPayload;
 if(row.kind==='GLOBAL_CAMPAIGN'&&p.deliveryKind==='BROADCAST')return p.rootKey??row.key;
 if(row.kind==='BROADCAST')return p.rootKey??(row.key.includes(':user:')?row.key.slice(0,row.key.lastIndexOf(':user:')):null);
 return null;
}
export async function broadcastStopped(tx:Tx,rootKey:string){return (await tx.outbox.findUnique({where:{key:rootKey},select:{lastError:true}}))?.lastError==='CAMPAIGN_STOPPED'}
export async function queueGlobal(tx:Tx,key:string,kind:string,payload:CampaignPayload){
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 const auction=payload.auctionId?await tx.auction.findUnique({where:{id:payload.auctionId},select:{testRunId:true}}):null;
 return tx.outbox.upsert({where:{key},create:{key,kind:'GLOBAL_CAMPAIGN',payload:{...payload,deliveryKind:kind,audienceBefore:now.toISOString(),rootKey:key},testRunId:auction?.testRunId},update:{}});
}
/** Each immutable batch records its cursor in a NEW intent. Recipients are
 * bounded by the event time; retrying a page cannot add duplicate deliveries. */
export async function expandCampaign(tx:Tx,row:Outbox){
 const p=row.payload as CampaignPayload;
 const rootKey=p.rootKey??row.key,before=new Date(p.audienceBefore??row.createdAt.toISOString());
 if(broadcastRoot(row)){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${rootKey}`},0))`;
  if(await broadcastStopped(tx,rootKey)){await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'CAMPAIGN_STOPPED'}});return 0}
 }
 // A cancellation queued by an older app version must not fan out after deploy.
 if(row.kind==='AUCTION_FINALIZED'||p.deliveryKind==='AUCTION_RESULT'){
  const settlement=p.auctionId?await tx.auctionSettlement.findUnique({where:{auctionId:p.auctionId},select:{outcome:true}}):null;
  if(settlement?.outcome==='CANCELLED'){
   await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'CANCELLATION_SILENT'}});
   return 0;
  }
 }
 const users=await tx.user.findMany({where:{staffMember:{is:null},telegramId:{not:null},createdAt:{lte:before},...(p.cursor?{id:{gt:p.cursor}}:{})},select:{id:true},orderBy:{id:'asc'},take:250});
 const kind=row.kind==='AUCTION_FINALIZED'?'AUCTION_RESULT':p.deliveryKind;
 if(!kind||!telegramKinds.includes(kind))throw Error('Unknown campaign kind');
 const {cursor:_cursor,audienceBefore:_before,rootKey:_root,deliveryKind:_kind,...content}=p;
 if(users.length)await tx.outbox.createMany({data:users.map(user=>({key:`${rootKey}:user:${user.id}`,kind,payload:{...content,rootKey,recipientUserId:user.id},testRunId:row.testRunId})),skipDuplicates:true});
 if(users.length===250){const cursor=users.at(-1)!.id;await tx.outbox.upsert({where:{key:`${rootKey}:after:${cursor}`},create:{key:`${rootKey}:after:${cursor}`,kind:'GLOBAL_CAMPAIGN',payload:{...p,deliveryKind:kind,rootKey,audienceBefore:before.toISOString(),cursor},testRunId:row.testRunId},update:{}})}
 await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:new Date()}});
 return users.length;
}
export async function scheduleGlobalAlerts(client:PrismaClient){
 return client.$transaction(async tx=>{
  if(await auctionMaintenance(tx))return 0;
  return scheduleGlobalAlertsInTransaction(tx);
 },{maxWait:5000,timeout:30000});
}
async function scheduleGlobalAlertsInTransaction(client:Tx){
 const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 let cursor:string|undefined,created=0;
 for(;;){
  const auctions=await client.auction.findMany({where:{testRunId:null,publishedAt:{lte:now},status:{in:['LIVE','SCHEDULED']},startsAt:{lte:now},endsAt:{gt:now,lt:new Date(now.getTime()+86400000)},settlement:{is:null},result:{is:null},...(cursor?{id:{gt:cursor}}:{})},select:{id:true,isDemo:true,isSettlementFixture:true,controlVersion:true},orderBy:{id:'asc'},take:100});
  const allowed=auctions.filter(a=>!a.isDemo||a.isSettlementFixture&&(demoBidAllowed()||stagingDemoEnabled()));
  if(allowed.length)created+=(await client.outbox.createMany({data:allowed.map(a=>({key:`global:ending:${a.id}:v${a.controlVersion}`,kind:'GLOBAL_CAMPAIGN',payload:{auctionId:a.id,deliveryKind:'AUCTION_ENDING',rootKey:`global:ending:${a.id}:v${a.controlVersion}`,audienceBefore:now.toISOString()}})),skipDuplicates:true})).count;
  if(auctions.length<100)break;cursor=auctions.at(-1)!.id;
 }
 for(const reminder of [
  {kind:'AUCTION_UPCOMING',key:'upcoming',startsAt:{gt:new Date(now.getTime()+3600000),lt:new Date(now.getTime()+86400000)}},
  {kind:'AUCTION_STARTING_SOON',key:'starting-soon',startsAt:{gt:now,lte:new Date(now.getTime()+3600000)}},
 ]){
  cursor=undefined;
  for(;;){
   const auctions:Array<{id:string;isDemo:boolean;isSettlementFixture:boolean}>=await client.auction.findMany({where:{testRunId:null,publishedAt:{lte:now},status:{in:['LIVE','SCHEDULED']},startsAt:reminder.startsAt,endsAt:{gt:now},product:{visible:true},settlement:{is:null},result:{is:null},...(cursor?{id:{gt:cursor}}:{})},select:{id:true,isDemo:true,isSettlementFixture:true},orderBy:{id:'asc'},take:100});
   const allowed=auctions.filter(a=>!a.isDemo||a.isSettlementFixture&&(demoBidAllowed()||stagingDemoEnabled()));
   // Separate durable keys deliver each reminder at most once per auction.
   if(allowed.length)created+=(await client.outbox.createMany({data:allowed.map(a=>({key:`global:${reminder.key}:${a.id}`,kind:'GLOBAL_CAMPAIGN',payload:{auctionId:a.id,deliveryKind:reminder.kind,rootKey:`global:${reminder.key}:${a.id}`,audienceBefore:now.toISOString()}})),skipDuplicates:true})).count;
   if(auctions.length<100)break;cursor=auctions.at(-1)!.id;
  }
 }
 return created;
}
export async function campaignContent(tx:Tx,row:Pick<Outbox,'kind'|'payload'>){
 const p=row.payload as CampaignPayload;if(!p.recipientUserId||!telegramKinds.includes(row.kind))return null;
 const base={userId:p.recipientUserId,kind:row.kind,imageId:undefined as string|undefined,imagePath:undefined as string|undefined};
 if(row.kind==='BROADCAST'){
  if(!p.body||!p.href)return null;
  let href:string,buttonLabel:string;try{href=broadcastMiniAppPath(p.href);buttonLabel=broadcastButtonLabel(p.buttonLabel)}catch{return null}
  return {...base,title:'Lowwin update · የLowwin መረጃ',body:p.body,href,imageId:p.imageId,buttonLabel};
 }
 if(row.kind==='DEPOSIT_CREDITED'){
  if(!p.intentId)return null;
  const t=await tx.topUpIntent.findUnique({where:{id:p.intentId},select:{userId:true,status:true,points:true,provider:true}});
  if(!t||t.userId!==p.recipientUserId||t.status!=='CREDITED')return null;
  if(t.provider==='ADMIN_CREDIT')return {...base,title:'Funds added · ገንዘብ ተጨምሯል',body:`Lowwin admin added ${formatEtb(t.points)} to your wallet.\nየLowwin አስተዳዳሪ ${formatEtb(t.points)} ወደ ሂሳብዎ ጨምሯል።`,href:'/wallet'};
  return {...base,title:'Deposit successful · ገንዘቡ ገብቷል',body:`${formatEtb(t.points)} has been added to your wallet.\n${formatEtb(t.points)} ወደ ሂሳብዎ ገብቷል።`,href:'/wallet'};
 }
 if(!p.auctionId)return null;
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{slug:true,publicCode:true,publishedAt:true,startsAt:true,endsAt:true,status:true,isDemo:true,isSettlementFixture:true,testRunId:true,presentation:true,product:{select:{title:true,visible:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}},result:{select:{id:true}},settlement:{select:{outcome:true}}}});
 if(!a?.publishedAt||!a.slug||a.result||a.testRunId||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 if(a.publishedAt>now)return null;
 const presentation=a.presentation as {title?:unknown;images?:{path?:unknown}[]}|null;const title=typeof presentation?.title==='string'?presentation.title:a.product?.title;
 base.imagePath=auctionNotificationImagePath(presentation,a.product?.images?.[0]?.path);
 base.imageId=auctionNotificationImageId(presentation,a.product?.images?.[0]?.path);
 const prefix=a.isDemo?'DEMO · ':'',item=`${title??'Auction'} · #${a.publicCode}`,shortItem=(title??'Auction').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120),code=a.publicCode===null?'':`\n#${a.publicCode}`;
 const when=(date:Date)=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'}).format(date)+' EAT';
 const action={buttonLabel:'View auction · ጨረታውን ይመልከቱ',href:`/auctions/${a.slug}`};
 if(row.kind==='AUCTION_RESULT'){
  if(!a.settlement)return null;
  if(a.settlement.outcome==='CANCELLED')return null;
  const outcome=a.settlement.outcome==='WINNER'?'A winner has been announced. See the final result.\nአሸናፊው ታውቋል። የመጨረሻ ውጤቱን ይመልከቱ።':'The auction closed without a winner.\nጨረታው ያለ አሸናፊ ተዘግቷል።';
  return {...base,...action,title:`${prefix}Auction finished · ጨረታው ተጠናቋል`,body:`${item}\n${outcome}\n${new URL(`/winners/${a.publicCode}`,process.env.MINI_APP_URL).href}`,telegramCaption:`🏁 ${prefix}${shortItem}\n${a.settlement.outcome==='WINNER'?'Winner announced · አሸናፊው ታውቋል':'Closed without a winner · ያለ አሸናፊ ተዘግቷል'}${a.endsAt?'\n⏰ '+when(a.endsAt):''}${code}`};
 }
 if(!['LIVE','SCHEDULED'].includes(a.status)||!a.product?.visible||!a.endsAt||a.endsAt<=now)return null;
 if(row.kind==='AUCTION_UPCOMING'||row.kind==='AUCTION_STARTING_SOON'){
  if(a.settlement||!a.startsAt)return null;
  const remaining=a.startsAt.getTime()-now.getTime();
  if(remaining<=0||remaining>=86400000)return null;
  if(row.kind==='AUCTION_UPCOMING'?remaining<=3600000:remaining>3600000)return null;
  const hour=row.kind==='AUCTION_STARTING_SOON';
  const options={dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'} as const;
  const whenEn=new Intl.DateTimeFormat('en-GB',options).format(a.startsAt),whenAm=new Intl.DateTimeFormat('am-ET',options).format(a.startsAt);
  return {...base,...action,title:`${prefix}${hour?'⏰ Bidding opens within 1 hour':'⏰ Bidding opens within 24 hours'}\n${hour?'ጨረታው በ1 ሰዓት ውስጥ ይጀምራል':'ጨረታው በ24 ሰዓት ውስጥ ይጀምራል'}`,body:`${item}\nOpens: ${whenEn} EAT\nየሚጀምርበት ጊዜ፦ ${whenAm} EAT\n${hour?'Get ready to bid when it opens.':'Preview the item before bidding opens.'}\n${hour?'ሲከፈት ለመጫረት ይዘጋጁ።':'ጨረታው ከመጀመሩ በፊት ዕቃውን ይመልከቱ።'}`,telegramCaption:`⏰ ${prefix}${shortItem}\n${hour?'Opens within 1 hour · በ1 ሰዓት ውስጥ ይጀምራል':'Opens within 24 hours · በ24 ሰዓት ውስጥ ይጀምራል'}\n🗓 ${when(a.startsAt)}${code}`};
 }
 if(row.kind==='AUCTION_ENDING'&&(!a.startsAt||a.startsAt>now||a.endsAt.getTime()-now.getTime()>=86400000))return null;
 return {...base,...action,title:prefix+(row.kind==='AUCTION_ENDING'?'Less than one day left · ከአንድ ቀን ያነሰ ጊዜ ቀርቷል':'New auction · አዲስ ጨረታ'),body:`${item}\n${row.kind==='AUCTION_ENDING'?'Check the closing time and place your bid.\nየመዝጊያ ሰዓቱን ይመልከቱና ጨረታዎን ያቅርቡ።':'View the item and its auction terms.\nዕቃውንና የጨረታውን ውሎች ይመልከቱ።'}`,telegramCaption:row.kind==='AUCTION_ENDING'?`⌛ ${prefix}${shortItem}\nEnds · ይዘጋል: ${when(a.endsAt)}${code}`:`📣 ${prefix}${shortItem}\nNew auction · አዲስ ጨረታ${a.startsAt?'\n🗓 '+when(a.startsAt):''}${code}`};
}
