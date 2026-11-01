import {Prisma,type PrismaClient} from '@prisma/client';
import {centsToEtb} from '@/lib/money';
import {contactBotId,decryptPhone,normalizePhone,phoneHash} from '../auth/own-contact';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';
import {walletBidNetFee} from './wallet-bid-payment';

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

/** One globally ordered page of Chapa attempts and committed wallet bid fees.
 * A Chapa bid has both a receipt and a BID_FEE journal: include it only once,
 * under its checkout, while retaining ordinary wallet bids in the same table. */
export async function readChapaTable(client:PrismaClient,actor:Actor,f:Filters){
 const statuses=['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED','CREDITED','BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED'];
 const view=f.view??(f.status?'all':'completed');
 if(!['completed','unfinished','review','failed','all'].includes(view)||f.status&&!statuses.includes(f.status)||f.purpose&&!['TOP_UP','BID'].includes(f.purpose))throw new AdminError(422,'Choose a valid payment status and type.');
 const chapaConfigured=process.env.CHAPA_SCHEMA_READY==='true',walletVisible=['completed','all'].includes(view)&&f.purpose!=='TOP_UP'&&(!f.status||f.status==='BID_ACCEPTED');
 let lookup:string|null=null;try{lookup=phoneHash(normalizePhone(f.q))}catch{}
 const selected:Prisma.Sql[]=[];
 if(chapaConfigured){
  const group=view==='completed'?Prisma.sql`AND c.status IN ('CREDITED','BID_ACCEPTED') AND c."creditJournalId" IS NOT NULL`:view==='unfinished'?Prisma.sql`AND c.status IN ('SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED')`:view==='review'?Prisma.sql`AND c.status='NEEDS_REVIEW'`:view==='failed'?Prisma.sql`AND c.status IN ('FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED')`:Prisma.empty;
  // Resolve a matching record ID as well as player search without exposing
  // sensitive provider references or scanning customer evidence/receipts.
  const chapaSearch=f.q?Prisma.sql`AND (c.id ILIKE ${'%'+f.q+'%'} OR u.id ILIKE ${'%'+f.q+'%'} OR u.name ILIKE ${'%'+f.q+'%'} OR u."telegramId" ILIKE ${'%'+f.q+'%'} OR u."telegramUsername" ILIKE ${'%'+f.q.replace(/^@/,'')+'%'} ${lookup?Prisma.sql`OR EXISTS(SELECT 1 FROM "TelegramOwnContact" t WHERE t."userId"=u.id AND t."phoneHash"=${lookup} AND t."revokedAt" IS NULL)`:Prisma.empty})`:Prisma.empty;
  selected.push(Prisma.sql`SELECT c.id,'chapa'::text AS source,c."createdAt",c."amountCents"::numeric/100 AS amount FROM "ChapaCheckout" c JOIN "user" u ON u.id=c."userId" WHERE true ${group} ${f.status?Prisma.sql`AND c.status=${f.status}`:Prisma.empty} ${f.purpose?Prisma.sql`AND c.purpose=${f.purpose}`:Prisma.empty} ${chapaSearch}`);
 }
 if(walletVisible){
  const walletSearch=f.q?Prisma.sql`AND (b.id ILIKE ${'%'+f.q+'%'} OR u.id ILIKE ${'%'+f.q+'%'} OR u.name ILIKE ${'%'+f.q+'%'} OR u."telegramId" ILIKE ${'%'+f.q+'%'} OR u."telegramUsername" ILIKE ${'%'+f.q.replace(/^@/,'')+'%'} ${lookup?Prisma.sql`OR EXISTS(SELECT 1 FROM "TelegramOwnContact" t WHERE t."userId"=u.id AND t."phoneHash"=${lookup} AND t."revokedAt" IS NULL)`:Prisma.empty})`:Prisma.empty;
  const netFee=Prisma.sql`CASE WHEN o.result#>>'{charge,netFeePoints}' ~ '^(0|[1-9][0-9]*)([.][0-9]{1,2})?$' THEN LEAST((o.result#>>'{charge,netFeePoints}')::numeric,b."feePoints") ELSE b."feePoints" END`;
  selected.push(Prisma.sql`SELECT b.id,'wallet'::text AS source,b."acceptedAt" AS "createdAt",${netFee} AS amount FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId" JOIN "Operation" o ON o.id=b."operationId" AND o.scope='BID' JOIN "Journal" j ON j."operationId"=o.id AND j.kind='BID_FEE' JOIN "user" u ON u.id=b."userId" WHERE NOT a."isDemo" AND a."testRunId" IS NULL ${chapaConfigured?Prisma.sql`AND NOT EXISTS(SELECT 1 FROM "ChapaCheckout" c WHERE c."bidId"=b.id)`:Prisma.empty} ${walletSearch}`);
 }
 if(!selected.length)return {...pageResult([],0,f.page,actor.now),configured:true,chapaConfigured,summary:[]};
 const combined=Prisma.join(selected,' UNION ALL '),order=f.sort==='amount'?Prisma.sql`amount DESC,"createdAt" DESC,id ASC,source ASC`:f.sort==='oldest'?Prisma.sql`"createdAt" ASC,id ASC,source ASC`:Prisma.sql`"createdAt" DESC,id ASC,source ASC`;
 const [pageRows,counts]=await Promise.all([
  client.$queryRaw<{id:string;source:'wallet'|'chapa'}[]>(Prisma.sql`WITH payments AS (${combined}) SELECT id,source FROM payments ORDER BY ${order} LIMIT 25 OFFSET ${(f.page-1)*take}`),
  client.$queryRaw<{count:number}[]>(Prisma.sql`WITH payments AS (${combined}) SELECT COUNT(*)::int AS count FROM payments`),
 ]);
 const chapaIds=pageRows.filter(row=>row.source==='chapa').map(row=>row.id),walletIds=pageRows.filter(row=>row.source==='wallet').map(row=>row.id);
 const [rows,walletRows]=await Promise.all([
  chapaIds.length?client.chapaCheckout.findMany({where:{id:{in:chapaIds}},select:{id:true,userId:true,purpose:true,mode:true,amountCents:true,currency:true,status:true,providerStatus:true,reason:true,creditJournalId:true,bidId:true,auctionId:true,paymentMethod:true,createdAt:true,user:{select:identity}},take:25}):[],
  walletIds.length?client.bid.findMany({where:{id:{in:walletIds}},select:{id:true,userId:true,auctionId:true,feePoints:true,acceptedAt:true,operation:{select:{result:true,journal:{select:{id:true}}}},user:{select:identity}},take:25}):[],
 ]);
 const chapaItems=rows.map(row=>{
  const creditApplied=!!row.creditJournalId;
  // A browser checking timeout is not a provider payment outcome. Keep the
  // last server-verified state visible in the admin table too.
  return {id:row.id,source:'chapa' as const,userId:row.userId,provider:'Chapa',channel:row.paymentMethod??'Hosted checkout',status:row.status,providerStatus:row.providerStatus,creditApplied,typeLabel:row.purpose==='BID'?creditApplied?'Bid payment':'Bid payment attempt':creditApplied?'Wallet deposit':'Deposit attempt',amount:centsToEtb(row.amountCents),currency:row.currency,createdAt:row.createdAt,journalId:actor.role==='SUPPORT'?null:row.creditJournalId,reason:row.reason&&/^[A-Z0-9_]{1,64}$/.test(row.reason)?row.reason:null,review:row.status==='NEEDS_REVIEW'?'OPEN':'NONE',reference:'',bidId:row.bidId,auctionId:row.auctionId,purpose:row.purpose,mode:row.mode,user:contact(row.user)};
 });
 const walletItems=walletRows.map(row=>({id:row.id,source:'wallet' as const,userId:row.userId,provider:'Wallet',channel:'Wallet',status:'BID_ACCEPTED',providerStatus:null,creditApplied:true,typeLabel:'Bid payment',amount:walletBidNetFee(row.feePoints,row.operation.result),currency:'ETB',createdAt:row.acceptedAt,journalId:actor.role==='SUPPORT'?null:row.operation.journal!.id,reason:null,review:'NONE',reference:'',bidId:row.id,auctionId:row.auctionId,purpose:'BID',mode:'live',user:contact(row.user)}));
 const byId=new Map([...chapaItems,...walletItems].map(row=>[`${row.source}:${row.id}`,row]));
 const items=pageRows.flatMap(row=>{const item=byId.get(`${row.source}:${row.id}`);return item?[item]:[]});
 await audit(client,actor,'MASTER_CHAPA_TABLE_READ',items.length);
 return {...pageResult(items,counts[0].count,f.page,actor.now),configured:true,chapaConfigured,summary:[]};
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
