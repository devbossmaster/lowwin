import {isSubmissionFeeOnly} from '../auctions/rules';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {demoBidAllowed} from '../auctions/bids';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import {formatEtb} from '@/lib/money';

type Tx=Prisma.TransactionClient;
export const telegramKinds=['AUCTION_PUBLISHED','AUCTION_UPCOMING','AUCTION_ENDING','AUCTION_RESULT','DEPOSIT_CREDITED','BROADCAST'];
export function auctionNotificationImageId(presentation:unknown,productPath?:string){
 const image=typeof presentation==='object'&&presentation!==null&&'images' in presentation&&Array.isArray(presentation.images)?presentation.images[0]:null;
 const path=typeof image?.path==='string'?image.path:productPath;
 return /^\/api\/media\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(path??'')?.[1];
}
export type CampaignPayload={auctionId?:string;recipientUserId?:string;intentId?:string;body?:string;imageId?:string;href?:string;cursor?:string;audienceBefore?:string;rootKey?:string;deliveryKind?:string};
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
 const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 let cursor:string|undefined,created=0;
 for(;;){
  const auctions=await client.auction.findMany({where:{testRunId:null,publishedAt:{lte:now},status:{in:['LIVE','SCHEDULED']},startsAt:{lte:now},endsAt:{gt:now,lt:new Date(now.getTime()+86400000)},settlement:{is:null},result:{is:null},...(cursor?{id:{gt:cursor}}:{})},select:{id:true,isDemo:true,isSettlementFixture:true,controlVersion:true},orderBy:{id:'asc'},take:100});
  const allowed=auctions.filter(a=>!a.isDemo||a.isSettlementFixture&&(demoBidAllowed()||stagingDemoEnabled()));
  if(allowed.length)created+=(await client.outbox.createMany({data:allowed.map(a=>({key:`global:ending:${a.id}:v${a.controlVersion}`,kind:'GLOBAL_CAMPAIGN',payload:{auctionId:a.id,deliveryKind:'AUCTION_ENDING',rootKey:`global:ending:${a.id}:v${a.controlVersion}`,audienceBefore:now.toISOString()}})),skipDuplicates:true})).count;
  if(auctions.length<100)break;cursor=auctions.at(-1)!.id;
 }
 cursor=undefined;
 for(;;){
  const auctions:Array<{id:string;isDemo:boolean;isSettlementFixture:boolean}>=await client.auction.findMany({where:{testRunId:null,publishedAt:{lte:now},status:{in:['LIVE','SCHEDULED']},startsAt:{gt:now,lt:new Date(now.getTime()+86400000)},endsAt:{gt:now},product:{visible:true},settlement:{is:null},result:{is:null},...(cursor?{id:{gt:cursor}}:{})},select:{id:true,isDemo:true,isSettlementFixture:true},orderBy:{id:'asc'},take:100});
  const allowed=auctions.filter(a=>!a.isDemo||a.isSettlementFixture&&(demoBidAllowed()||stagingDemoEnabled()));
  // One durable campaign per auction, independent of deadline revisions.
  if(allowed.length)created+=(await client.outbox.createMany({data:allowed.map(a=>({key:`global:upcoming:${a.id}`,kind:'GLOBAL_CAMPAIGN',payload:{auctionId:a.id,deliveryKind:'AUCTION_UPCOMING',rootKey:`global:upcoming:${a.id}`,audienceBefore:now.toISOString()}})),skipDuplicates:true})).count;
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
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{terms:{select:{ruleVersion:true}},slug:true,publicCode:true,publishedAt:true,startsAt:true,endsAt:true,status:true,isDemo:true,isSettlementFixture:true,testRunId:true,presentation:true,product:{select:{title:true,visible:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}},result:{select:{id:true}},settlement:{select:{outcome:true,decision:true}}}});
 if(!a?.publishedAt||!a.slug||a.result||a.testRunId||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 const presentation=a.presentation as {title?:unknown;images?:{path?:unknown}[]}|null;const title=typeof presentation?.title==='string'?presentation.title:a.product?.title;
 base.imageId=auctionNotificationImageId(presentation,a.product?.images?.[0]?.path);
 const prefix=a.isDemo?'DEMO · ':'',item=`${title??'Auction'} · #${a.publicCode}`;
 if(row.kind==='AUCTION_RESULT'){
  if(!a.settlement)return null;
  const outcome=a.settlement.outcome==='WINNER'?'A winner has been announced. See the final result.\nአሸናፊው ታውቋል። የመጨረሻ ውጤቱን ይመልከቱ።':a.settlement.outcome==='CANCELLED'?isSubmissionFeeOnly(a.terms?.ruleVersion)?'The auction was cancelled. Accepted submission fees are non-refundable.\nጨረታው ተሰርዟል። ለተቀበሉ ጨረታዎች የተከፈሉ የማቅረቢያ ክፍያዎች ተመላሽ አይሆኑም።':'The auction was cancelled. Entry fees and holds were returned.\nጨረታው ተሰርዟል። ክፍያዎችና የተያዘው ገንዘብ ተመልሰዋል።':'The auction closed without a winner.\nጨረታው ያለ አሸናፊ ተዘግቷል።';
  return {...base,title:`${prefix}Auction finished · ጨረታው ተጠናቋል`,body:`${item}\n${outcome}\n${new URL(`/winners/${a.publicCode}`,process.env.MINI_APP_URL).href}`,href:`/auctions/${a.slug}`};
 }
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
 if(!['LIVE','SCHEDULED'].includes(a.status)||!a.product?.visible||!a.endsAt||a.endsAt<=now)return null;
 if(row.kind==='AUCTION_UPCOMING'){
  if(a.settlement||!a.startsAt||a.startsAt<=now||a.startsAt.getTime()-now.getTime()>=86400000)return null;
  const options={dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'} as const;
  const when=new Intl.DateTimeFormat('en-GB',options).format(a.startsAt),whenAm=new Intl.DateTimeFormat('am-ET',options).format(a.startsAt);
  return {...base,title:`${prefix}Starts in less than 24 hours · ከ24 ሰዓት በታች ጊዜ ውስጥ ይጀምራል`,body:`${item}\nStarts ${when} EAT. View the item before bidding opens.\nየሚጀምርበት ጊዜ፦ ${whenAm} EAT። ጨረታው ከመጀመሩ በፊት ዕቃውን ይመልከቱ።`,href:`/auctions/${a.slug}`};
 }
 if(row.kind==='AUCTION_ENDING'&&(!a.startsAt||a.startsAt>now||a.endsAt.getTime()-now.getTime()>=86400000))return null;
 return {...base,title:prefix+(row.kind==='AUCTION_ENDING'?'Less than one day left · ከአንድ ቀን ያነሰ ጊዜ ቀርቷል':'New auction · አዲስ ጨረታ'),body:`${item}\n${row.kind==='AUCTION_ENDING'?'Check the closing time and place your bid.\nየመዝጊያ ሰዓቱን ይመልከቱና ጨረታዎን ያቅርቡ።':'View the item and its auction terms.\nዕቃውንና የጨረታውን ውሎች ይመልከቱ።'}`,href:`/auctions/${a.slug}`};
}
