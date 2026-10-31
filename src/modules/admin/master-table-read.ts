import {Prisma,type PrismaClient} from '@prisma/client';
import {centsToEtb} from '@/lib/money';
import {contactBotId,decryptPhone,normalizePhone,phoneHash} from '../auth/own-contact';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';

const identity={id:true,name:true,telegramId:true,telegramUsername:true,createdAt:true,
 ownContact:{select:{telegramId:true,botId:true,phoneCipher:true,revokedAt:true}}} satisfies Prisma.UserSelect;
type Identity=Prisma.UserGetPayload<{select:typeof identity}>;
type Filters={page:number;q:string;status:string;sort?:'newest'|'oldest'|'amount';view?:'completed'|'unfinished'|'review'|'failed'|'all';purpose?:''|'TOP_UP'|'BID'};
type Actor={id:string;role:StaffRole;now:Date};
const take=25;
const pageResult=<T,>(items:T[],total:number,page:number,now:Date)=>({items,total,page,totalPages:Math.ceil(total/take),serverNow:now.toISOString()});
function contact(user:Identity){
 let phone:string|null=null,phoneUnavailable=false;
 if(user.ownContact){try{if(!user.ownContact.revokedAt&&user.ownContact.telegramId===user.telegramId&&user.ownContact.botId===contactBotId())phone=decryptPhone(user.ownContact.phoneCipher,user.ownContact.botId)}catch{phoneUnavailable=true}}
 return {id:user.id,name:user.name,telegramId:user.telegramId,telegramUsername:user.telegramUsername,createdAt:user.createdAt,phone,phoneUnavailable};
}
function playerSearch(q:string):Prisma.UserWhereInput{
 if(!q)return {};
 const OR:Prisma.UserWhereInput[]=[{id:{contains:q}},{name:{contains:q,mode:'insensitive'}},{telegramId:{contains:q}},{telegramUsername:{contains:q.replace(/^@/,''),mode:'insensitive'}}];
 try{OR.push({ownContact:{is:{phoneHash:phoneHash(normalizePhone(q)),revokedAt:null}}})}catch{}
 return {OR};
}
async function audit(client:PrismaClient,actor:Actor,action:string,count:number){if(count)await client.adminAudit.create({data:{actorId:actor.id,action,target:'master-admin-table',details:{count}}})}

/** Bounded current balances and activity, without loading journals or ledger scans. */
export async function readPlayerTable(client:PrismaClient,actor:Actor,f:Filters){
 if(!['','ACTIVE','SUSPENDED'].includes(f.status))throw new AdminError(422,'Choose a valid player status.');
 let lookup:string|null=null;try{lookup=phoneHash(normalizePhone(f.q))}catch{}
 const from=Prisma.sql`FROM "user" u LEFT JOIN "UserRestriction" r ON r."userId"=u.id`;
 const where=Prisma.sql`u."telegramId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "StaffMember" s WHERE s."userId"=u.id) AND NOT EXISTS(SELECT 1 FROM "TestRunActor" t WHERE t."userId"=u.id) ${f.status==='SUSPENDED'?Prisma.sql`AND r.suspended IS TRUE`:f.status==='ACTIVE'?Prisma.sql`AND COALESCE(r.suspended,false)=false`:Prisma.empty} ${f.q?Prisma.sql`AND (u.id ILIKE ${'%'+f.q+'%'} OR u.name ILIKE ${'%'+f.q+'%'} OR u."telegramId" ILIKE ${'%'+f.q+'%'} OR u."telegramUsername" ILIKE ${'%'+f.q.replace(/^@/,'')+'%'} ${lookup?Prisma.sql`OR EXISTS(SELECT 1 FROM "TelegramOwnContact" c WHERE c."userId"=u.id AND c."phoneHash"=${lookup} AND c."revokedAt" IS NULL)`:Prisma.empty})`:Prisma.empty}`;
 const order=f.sort==='oldest'?Prisma.sql`u."createdAt" ASC,u.id ASC`:Prisma.sql`u."createdAt" DESC,u.id ASC`;
 // Resolve only this page's IDs. Status filters never materialize every
 // suspended player's ID into process memory or a large IN clause.
 const [pageRows,counts]=await Promise.all([
  client.$queryRaw<{id:string;suspended:boolean}[]>(Prisma.sql`SELECT u.id,COALESCE(r.suspended,false) AS suspended ${from} WHERE ${where} ORDER BY ${order} LIMIT 25 OFFSET ${(f.page-1)*take}`),
  client.$queryRaw<{count:number}[]>(Prisma.sql`SELECT COUNT(*)::int AS count ${from} WHERE ${where}`),
 ]);
 const ids=pageRows.map(row=>row.id),referralsReady=process.env.REFERRAL_REWARDS_SCHEMA_READY==='true',balancesVisible=['OWNER','AUDITOR','PAYMENTS_OPERATOR'].includes(actor.role);
 const [users,referrals,coupons]=await Promise.all([
  ids.length?client.user.findMany({where:{id:{in:ids}},select:{...identity,wallet:{select:{accounts:{where:{kind:{in:['AVAILABLE','HELD']}},select:{kind:true,balance:true}}}},_count:{select:{bids:true,wonSettlements:true}}}}):[],
  ids.length&&referralsReady?client.referralSignup.groupBy({by:['referrerUserId'],where:{referrerUserId:{in:ids}},_count:{referredUserId:true}}):[],
  ids.length&&referralsReady?client.referralCoupon.groupBy({by:['ownerUserId'],where:{ownerUserId:{in:ids},expiresAt:{gt:actor.now},redemption:{is:null}},_count:{id:true}}):[],
 ]);
 const items=pageRows.flatMap(row=>{const user=users.find(value=>value.id===row.id);return user?[{...contact(user),bidCount:user._count.bids,winCount:user._count.wonSettlements,suspended:row.suspended,
  available:balancesVisible?user.wallet?.accounts.find(account=>account.kind==='AVAILABLE')?.balance.toString()??'0':null,held:balancesVisible?user.wallet?.accounts.find(account=>account.kind==='HELD')?.balance.toString()??'0':null,
  referralCount:referralsReady?referrals.find(value=>value.referrerUserId===user.id)?._count.referredUserId??0:null,
  couponCount:referralsReady?coupons.find(value=>value.ownerUserId===user.id)?._count.id??0:null}]:[]});
 await audit(client,actor,'MASTER_PLAYER_TABLE_READ',items.length);
 return {...pageResult(items,counts[0].count,f.page,actor.now),referralsReady};
}

/** Only Chapa attempts appear here. Legacy providers and journals remain stored. */
export async function readChapaTable(client:PrismaClient,actor:Actor,f:Filters){
 const statuses=['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED','CREDITED','BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED'];
 const view=f.view??(f.status?'all':'completed');
 if(!['completed','unfinished','review','failed','all'].includes(view)||f.status&&!statuses.includes(f.status)||f.purpose&&!['TOP_UP','BID'].includes(f.purpose))throw new AdminError(422,'Choose a valid payment status and type.');
 if(process.env.CHAPA_SCHEMA_READY!=='true')return {...pageResult([],0,f.page,actor.now),configured:false,summary:[]};
 const grouped:Prisma.ChapaCheckoutWhereInput=view==='completed'?{status:{in:['CREDITED','BID_ACCEPTED']},creditJournalId:{not:null}}:view==='unfinished'?{status:{in:['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED']}}:view==='review'?{status:'NEEDS_REVIEW'}:view==='failed'?{status:{in:['FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED']}}:{};
 const where:Prisma.ChapaCheckoutWhereInput={AND:[grouped,...(f.status?[{status:f.status}]:[]),...(f.purpose?[{purpose:f.purpose}]:[]),...(f.q?[{OR:[{id:{contains:f.q,mode:'insensitive' as const}},{user:playerSearch(f.q)}]}]:[])]};
 const orderBy:Prisma.ChapaCheckoutOrderByWithRelationInput[]=f.sort==='amount'?[{amountCents:'desc'},{id:'asc'}]:[{createdAt:f.sort==='oldest'?'asc':'desc'},{id:'asc'}];
 const [rows,total]=await Promise.all([client.chapaCheckout.findMany({where,select:{id:true,userId:true,purpose:true,mode:true,amountCents:true,currency:true,status:true,providerStatus:true,reason:true,creditJournalId:true,bidId:true,auctionId:true,paymentMethod:true,createdAt:true,user:{select:identity}},orderBy,skip:(f.page-1)*take,take}),client.chapaCheckout.count({where})]);
 const items=rows.map(row=>{
  const creditApplied=!!row.creditJournalId;
  // A browser checking timeout is not a provider payment outcome. Keep the
  // last server-verified state visible in the admin table too.
  return {id:row.id,userId:row.userId,provider:'Chapa',channel:row.paymentMethod??'Hosted checkout',status:row.status,providerStatus:row.providerStatus,creditApplied,typeLabel:row.purpose==='BID'?creditApplied?'Bid payment':'Bid payment attempt':creditApplied?'Wallet deposit':'Deposit attempt',amount:centsToEtb(row.amountCents),currency:row.currency,createdAt:row.createdAt,journalId:actor.role==='SUPPORT'?null:row.creditJournalId,reason:row.reason&&/^[A-Z0-9_]{1,64}$/.test(row.reason)?row.reason:null,review:row.status==='NEEDS_REVIEW'?'OPEN':'NONE',reference:'',bidId:row.bidId,auctionId:row.auctionId,purpose:row.purpose,mode:row.mode,user:contact(row.user)};
 });
 await audit(client,actor,'MASTER_CHAPA_TABLE_READ',items.length);
 return {...pageResult(items,total,f.page,actor.now),configured:true,summary:[]};
}

export async function readWinnerTable(client:PrismaClient,actor:Actor,f:Filters){
 if(!['','INCOMPLETE','PENDING','CLAIMED','PACKING','SHIPPED','DELIVERED','DISPUTED'].includes(f.status))throw new AdminError(422,'Choose a valid delivery status.');
 const from=Prisma.sql`FROM "AuctionSettlement" s JOIN "Auction" a ON a.id=s."auctionId" LEFT JOIN "Product" p ON p.id=a."productId" LEFT JOIN "FulfillmentCase" f ON f."auctionId"=a.id LEFT JOIN "user" u ON u.id=s."winnerUserId"`;
 const where=Prisma.sql`s.outcome='WINNER' AND NOT a."isDemo" AND a."testRunId" IS NULL ${actor.role==='FULFILLMENT'?Prisma.sql`AND f."assignedTo"=${actor.id}`:Prisma.empty} ${f.status==='INCOMPLETE'?Prisma.sql`AND COALESCE(f.state,'PENDING')<>'DELIVERED'`:f.status?Prisma.sql`AND COALESCE(f.state,'PENDING')=${f.status}`:Prisma.empty} ${f.q?Prisma.sql`AND (a.code ILIKE ${'%'+f.q+'%'} OR p.title ILIKE ${'%'+f.q+'%'} OR u.name ILIKE ${'%'+f.q+'%'} OR u."telegramUsername" ILIKE ${'%'+f.q.replace(/^@/,'')+'%'})`:Prisma.empty}`;
 type WinnerRow={auctionId:string;publicCode:number;code:string;title:string|null;presentation:Prisma.JsonValue|null;completedAt:Date;winnerUserId:string|null;winningAmount:string|null;ruleVersion:string;state:string;version:number;tracking:string;note:string;assignedTo:string|null;deliveredAt:Date|null};
 const [rows,counts]=await Promise.all([
  client.$queryRaw<WinnerRow[]>(Prisma.sql`SELECT a.id AS "auctionId",a."publicCode",a.code,p.title,a.presentation,s."completedAt",s."winnerUserId",s."winningPoints"::text AS "winningAmount",s."ruleVersion",COALESCE(f.state,'PENDING') AS state,COALESCE(f.version,0) AS version,COALESCE(f.tracking,'') AS tracking,COALESCE(f.note,'') AS note,f."assignedTo",f."deliveredAt" ${from} WHERE ${where} ORDER BY s."completedAt" DESC,a.id ASC LIMIT 25 OFFSET ${(f.page-1)*take}`),
  client.$queryRaw<{count:number}[]>(Prisma.sql`SELECT COUNT(*)::int AS count ${from} WHERE ${where}`),
 ]);
 const ids=[...new Set(rows.flatMap(row=>row.winnerUserId?[row.winnerUserId]:[]))];
 const [winners,photos]=await Promise.all([
  ids.length?client.user.findMany({where:{id:{in:ids}},select:identity}):[],
  rows.length?client.winnerPresentation.findMany({where:{auctionId:{in:rows.map(row=>row.auctionId)}},select:{auctionId:true,imageId:true,version:true}}):[],
 ]);
 const items=rows.map(row=>{const winner=winners.find(value=>value.id===row.winnerUserId),presentation=row.presentation as {title?:string}|null,photo=photos.find(value=>value.auctionId===row.auctionId);return {auctionId:row.auctionId,publicCode:row.publicCode,code:row.code,title:presentation?.title??row.title??'Auction',completedAt:row.completedAt,winner:winner?contact(winner):null,winningAmount:row.winningAmount,ruleVersion:row.ruleVersion,state:row.state,version:row.version,tracking:row.tracking,note:row.note,assignedTo:row.assignedTo,deliveredAt:row.deliveredAt,winnerPhotoPath:photo?.imageId?`/api/media/${photo.imageId}`:null,winnerPhotoId:photo?.imageId??null,winnerPhotoVersion:photo?.version??0}});
 await audit(client,actor,'MASTER_WINNER_TABLE_READ',items.length);
 return pageResult(items,counts[0].count,f.page,actor.now);
}
