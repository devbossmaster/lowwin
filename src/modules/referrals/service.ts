import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {assertPlayerContact,contactBotId} from '../auth/own-contact';
import {ensureWallet,seedPlatformAccounts} from '../wallet/ledger';
import {isSubmissionFeeOnly} from '../auctions/rules';

type DB=PrismaClient|Prisma.TransactionClient;
type Tx=Prisma.TransactionClient;
export const referralPolicySchema=z.object({enabled:z.boolean(),discountPercent:z.number().int().min(5).max(15),expiryDays:z.number().int().min(15).max(30)}).strict();
const DAY=86400000;
export class ReferralError extends Error{constructor(public readonly status:number,public readonly code:string,message:string){super(message);this.name='ReferralError'}}
export function referralSchemaReady(raw:Record<string,string|undefined>=process.env){return raw.REFERRAL_REWARDS_SCHEMA_READY==='true'}
const draftPolicy={configured:false,enabled:false,discountPercent:10,expiryDays:30,version:0,updatedAt:null as string|null};
export async function getReferralPolicy(client:DB,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return {...draftPolicy};
 const policy=await client.referralPolicy.findUnique({where:{id:'default'}});
 return policy?{configured:true,enabled:policy.enabled,discountPercent:policy.discountPercent,expiryDays:policy.expiryDays,version:policy.version,updatedAt:policy.updatedAt.toISOString()}:{...draftPolicy};
}
async function databaseNow(tx:DB){return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`)[0].now}
function referralToken(payload:string|undefined|null){return typeof payload==='string'?/^ref_([A-Za-z0-9_-]{12})$/.exec(payload)?.[1]??null:null}
async function eligibleSponsor(tx:DB,userId:string){const user=await tx.user.findUnique({where:{id:userId},select:{telegramId:true}});return !!user?.telegramId&&!userId.startsWith('demo-showcase-')&&!await tx.testRunActor.findFirst({where:{userId}})&&!await tx.staffMember.findUnique({where:{userId}})&&!await tx.userRestriction.findFirst({where:{userId,suspended:true}})}
function emptyOverview(){return {configured:false,enabled:false,shareUrl:null as string|null,discountPercent:null as number|null,expiryDays:null as number|null,counts:{signedUp:0,qualified:0,earned:0,available:0},coupons:[] as Array<{id:string;percent:number;expiresAt:string;status:'AVAILABLE'|'USED'|'EXPIRED'}>}}

/** Private account overview. Only coordinates/DTOs are cached by the client. */
export async function getReferralOverview(client:PrismaClient,userId:string,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return emptyOverview();
 return client.$transaction(async tx=>{
  const policy=await getReferralPolicy(tx,raw),now=await databaseNow(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral-invite:${userId}`},0))`;
  let invite=await tx.referralInvite.findUnique({where:{userId}});
  if(!invite&&policy.enabled&&await eligibleSponsor(tx,userId)){
   await assertPlayerContact(tx,userId);
   invite=await tx.referralInvite.create({data:{userId,token:randomBytes(9).toString('base64url')}});
  }
  const [signedUp,qualified,earned,available,usable,recent]=await Promise.all([
   tx.referralSignup.count({where:{referrerUserId:userId}}),tx.referralSignup.count({where:{referrerUserId:userId,firstBidId:{not:null}}}),tx.referralCoupon.count({where:{ownerUserId:userId}}),
   tx.referralCoupon.count({where:{ownerUserId:userId,redemption:null,expiresAt:{gt:now}}}),
   tx.referralCoupon.findMany({where:{ownerUserId:userId,redemption:null,expiresAt:{gt:now}},orderBy:[{expiresAt:'asc'},{id:'asc'}],take:20,include:{redemption:{select:{id:true}}}}),
   tx.referralCoupon.findMany({where:{ownerUserId:userId,OR:[{redemption:{isNot:null}},{expiresAt:{lte:now}}]},orderBy:[{createdAt:'desc'},{id:'asc'}],take:5,include:{redemption:{select:{id:true}}}}),
  ]);
  const username=raw.TELEGRAM_BOT_USERNAME,shareUrl=invite&&policy.enabled&&username&&/^[A-Za-z0-9_]+bot$/i.test(username)?`https://t.me/${username}?start=ref_${invite.token}`:null;
  return {configured:policy.configured,enabled:policy.enabled,shareUrl,discountPercent:policy.configured?policy.discountPercent:null,expiryDays:policy.configured?policy.expiryDays:null,counts:{signedUp,qualified,earned,available},coupons:[...usable,...recent].map(c=>({id:c.id,percent:c.percent,expiresAt:c.expiresAt.toISOString(),status:c.redemption?'USED' as const:c.expiresAt<=now?'EXPIRED' as const:'AVAILABLE' as const}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

/** Called only from the authenticated Telegram bot update handler. No messages. */
export async function recordBotReferralStart(client:PrismaClient,telegramId:string,botId:string,payload:string,raw:Record<string,string|undefined>=process.env){
 const token=referralToken(payload);if(!referralSchemaReady(raw)||!token||!/^\d{1,20}$/.test(telegramId)||botId!==contactBotId())return false;
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${telegramId}`},0))`;
  if(await tx.user.findUnique({where:{telegramId}}))return false;
  const policy=await getReferralPolicy(tx,raw);if(!policy.enabled)return false;
  const invite=await tx.referralInvite.findUnique({where:{token}});if(!invite||!await eligibleSponsor(tx,invite.userId))return false;
  const now=await databaseNow(tx);
  const prior=await tx.referralPendingSignup.findUnique({where:{botId_telegramId:{botId,telegramId}}});
  if(prior){
   if(prior.consumedUserId||prior.expiresAt>now||!await eligibleSponsor(tx,prior.referrerUserId))return false;
   await tx.referralPendingSignup.update({where:{id:prior.id},data:{renewedAt:now,expiresAt:new Date(now.getTime()+30*DAY)}});return true;
  }
  await tx.referralPendingSignup.create({data:{botId,telegramId,referrerUserId:invite.userId,createdAt:now,expiresAt:new Date(now.getTime()+30*DAY)}});
  return true;
 });
}

/** Caller holds the existing telegram identity lock and proves this user is new. */
export async function attributeNewReferralInTransaction(tx:Tx,userId:string,telegramId:string,{newAccount,signedStartParam}:{newAccount:boolean;signedStartParam?:string|null},raw:Record<string,string|undefined>=process.env){
 if(!newAccount||!referralSchemaReady(raw))return;
 const now=await databaseNow(tx),policy=await getReferralPolicy(tx,raw);if(!policy.enabled)return;
 if(await tx.referralSignup.findUnique({where:{referredUserId:userId}})||await tx.bid.findFirst({where:{userId}}))return;
 const pending=await tx.referralPendingSignup.findUnique({where:{botId_telegramId:{botId:contactBotId(),telegramId}}});
 const usablePending=pending&&!pending.consumedUserId&&pending.expiresAt>now?pending:null;
 const token=referralToken(signedStartParam),direct=token?await tx.referralInvite.findUnique({where:{token}}):null;
 const sponsor=usablePending?.referrerUserId??direct?.userId;
 if(!sponsor||sponsor===userId||!await eligibleSponsor(tx,sponsor))return;
 if(usablePending)await tx.referralPendingSignup.update({where:{id:usablePending.id},data:{consumedUserId:userId}});
 await tx.referralSignup.create({data:{referredUserId:userId,referrerUserId:sponsor,pendingId:usablePending?.id,registeredAt:now}});
}

/** Runs only after an accepted bid is recorded, inside the same transaction. */
export async function qualifyReferralInTransaction(tx:Tx,userId:string,bidId:string,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return;
 const locked=await tx.$queryRaw<{referredUserId:string}[]>`SELECT "referredUserId" FROM "ReferralSignup" WHERE "referredUserId"=${userId} FOR UPDATE`;if(!locked.length)return;
 const signup=await tx.referralSignup.findUniqueOrThrow({where:{referredUserId:userId}});if(signup.firstBidId)return;
 const bid=await tx.bid.findUnique({where:{id:bidId},select:{userId:true,auction:{select:{isDemo:true,testRunId:true,product:{select:{isDemo:true}}}}}});
 if(!bid||bid.userId!==userId||bid.auction.isDemo||bid.auction.testRunId||bid.auction.product?.isDemo||await tx.bid.count({where:{userId}})!==1)return;
 await tx.$queryRaw`SELECT id FROM "ReferralPolicy" WHERE id='default' FOR SHARE`;
 const policy=await getReferralPolicy(tx,raw),now=await databaseNow(tx);
 await tx.referralSignup.update({where:{referredUserId:userId},data:{firstBidId:bidId,qualifiedAt:now}});
 if(!policy.enabled||!await eligibleSponsor(tx,signup.referrerUserId))return;
 await tx.referralCoupon.create({data:{ownerUserId:signup.referrerUserId,referredUserId:userId,percent:policy.discountPercent,policyVersion:policy.version,createdAt:now,expiresAt:new Date(now.getTime()+policy.expiryDays*DAY)}});
}

export type LockedReferralDiscount={couponId:string;percent:number;expiresAt:Date;grossFeePoints:Prisma.Decimal;discountPoints:Prisma.Decimal;netFeePoints:Prisma.Decimal};
export function calculateReferralDiscount(fee:Prisma.Decimal,percent:number){return fee.mul(percent).div(100).toDecimalPlaces(2,Prisma.Decimal.ROUND_DOWN)}
export async function lockReferralDiscountInTransaction(tx:Tx,userId:string,couponId:string,fee:Prisma.Decimal,ruleVersion:string,raw:Record<string,string|undefined>=process.env):Promise<LockedReferralDiscount>{
 if(!referralSchemaReady(raw))throw new ReferralError(503,'REFERRAL_UNAVAILABLE','Referral discounts are not configured yet.');
 if(!isSubmissionFeeOnly(ruleVersion))throw new ReferralError(409,'COUPON_UNAVAILABLE','This auction keeps its original payment terms.');
 await tx.$queryRaw`SELECT id FROM "ReferralCoupon" WHERE id=${couponId} AND "ownerUserId"=${userId} FOR UPDATE`;
 const coupon=await tx.referralCoupon.findFirst({where:{id:couponId,ownerUserId:userId},include:{redemption:true}}),now=await databaseNow(tx);
 if(!coupon||coupon.redemption||coupon.expiresAt<=now)throw new ReferralError(409,'COUPON_UNAVAILABLE','This earned discount is unavailable or expired.');
 const discountPoints=calculateReferralDiscount(fee,coupon.percent);
 if(fee.lte(0)||discountPoints.lte(0))throw new ReferralError(409,'COUPON_UNAVAILABLE','Keep this discount for a paid submission fee.');
 return {couponId:coupon.id,percent:coupon.percent,expiresAt:coupon.expiresAt,grossFeePoints:fee,discountPoints,netFeePoints:fee.sub(discountPoints)};
}

/** No standalone credit endpoint exists: deferred DB proof requires its bid. */
export async function redeemReferralInTransaction(tx:Tx,userId:string,bidId:string,auctionId:string,discount:LockedReferralDiscount){
 const wallet=await ensureWallet(tx,userId);await seedPlatformAccounts(tx);
 const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}}),fees=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:fees'}});
 const operationId=randomUUID(),result={bidId,auctionId,couponId:discount.couponId,grossFeePoints:discount.grossFeePoints.toString(),discountPoints:discount.discountPoints.toString(),netFeePoints:discount.netFeePoints.toString(),percent:discount.percent};
 await tx.operation.create({data:{id:operationId,userId,scope:'REFERRAL_DISCOUNT',key:bidId,requestHash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result}});
 await tx.journal.create({data:{operationId,kind:'REFERRAL_DISCOUNT',reference:`bid:${bidId}`,postings:{create:[{accountId:fees.id,delta:discount.discountPoints.negated()},{accountId:available.id,delta:discount.discountPoints}]}}});
 await tx.referralRedemption.create({data:{couponId:discount.couponId,userId,bidId,operationId,grossFeePoints:discount.grossFeePoints,discountPoints:discount.discountPoints,createdAt:await databaseNow(tx)}});
}

/** Quotes use server fees, eligibility and owned unspent rewards, never client money. */
export async function getBidDiscountQuote(client:PrismaClient,userId:string,auctionSlug:string,couponId?:string,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))throw new ReferralError(503,'REFERRAL_UNAVAILABLE','Referral discounts are not configured yet.');
 if(!/^[a-z0-9-]{1,120}$/.test(auctionSlug)||couponId&&!z.string().uuid().safeParse(couponId).success)throw new ReferralError(422,'INVALID_DISCOUNT','Choose an earned discount.');
 return client.$transaction(async tx=>{
  await assertPlayerContact(tx,userId);if(!await eligibleSponsor(tx,userId))throw new ReferralError(403,'BIDDING_RESTRICTED','Bidding is unavailable for this account.');
  const a=await tx.auction.findUnique({where:{slug:auctionSlug},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1},product:{include:{category:true}},category:true}}),now=await databaseNow(tx);
  if(!a?.terms||!a.publishedAt||a.publishedAt>now||!a.startsAt||a.startsAt>now||!a.endsAt||a.endsAt<=now||!['LIVE','SCHEDULED'].includes(a.status)||!a.product?.visible||!a.product.category.visible||!a.category?.visible)throw new ReferralError(409,'AUCTION_CLOSED','This auction is not open for bids.');
  const fee=a.feeRevisions[0];if(!fee)throw new ReferralError(409,'TERMS_CHANGED','Review the current submission fee.');
  const supported=isSubmissionFeeOnly(a.terms.ruleVersion)&&!a.isDemo&&!a.testRunId&&!a.product.isDemo;
  if(couponId&&!supported)throw new ReferralError(409,'COUPON_UNAVAILABLE','This auction keeps its original payment terms.');
  const coupons=supported?await tx.referralCoupon.findMany({where:{ownerUserId:userId,expiresAt:{gt:now},redemption:null},orderBy:[{expiresAt:'asc'},{id:'asc'}],take:20}):[];
  const selected=couponId?await tx.referralCoupon.findFirst({where:{id:couponId,ownerUserId:userId,expiresAt:{gt:now},redemption:null}}):coupons[0];
  if(couponId&&!selected)throw new ReferralError(409,'COUPON_UNAVAILABLE','This earned discount is unavailable or expired.');
  const discountPoints=selected?calculateReferralDiscount(fee.feePoints,selected.percent):new Prisma.Decimal(0);
  if(selected&&discountPoints.lte(0))throw new ReferralError(409,'COUPON_UNAVAILABLE','Keep this discount for a paid submission fee.');
  return {serverNow:now.toISOString(),auctionSlug,feeVersion:fee.version,ruleVersion:a.terms.ruleVersion,grossFeePoints:fee.feePoints.toString(),discountPoints:discountPoints.toString(),netFeePoints:fee.feePoints.sub(discountPoints).toString(),coupon:selected?{id:selected.id,percent:selected.percent,expiresAt:selected.expiresAt.toISOString()}:null,eligible:supported&&fee.feePoints.gt(0),availableCoupons:coupons.map(c=>({id:c.id,percent:c.percent,expiresAt:c.expiresAt.toISOString()}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
