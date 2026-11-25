import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type ReferralWalletReward} from '@prisma/client';
import {z} from 'zod';
import {botReferralShareUrl,referralInviteCode,websiteReferralShareUrl} from '@/lib/referral-invite';
import {centsToEtb,etbToCents} from '@/lib/money';
import {assertPlayerContact,contactBotId} from '../auth/own-contact';
import {ensureWallet,seedPlatformAccounts} from '../wallet/ledger';
import {isSubmissionFeeOnly} from '../auctions/rules';

type DB=PrismaClient|Prisma.TransactionClient;
type Tx=Prisma.TransactionClient;
const rewardAmount=z.string().trim().regex(/^(0|[1-9]\d{0,5})(?:\.\d{1,2})?$/,'Enter an ETB amount with up to two decimal places.')
 .refine(value=>{try{const cents=etbToCents(value);return cents>=1n&&cents<=10000000n}catch{return false}},'Enter a reward from ETB 0.01 to 100,000.');
export const referralPolicySchema=z.object({enabled:z.boolean(),rewardEtb:rewardAmount}).strict();
const DAY=86400000;
export class ReferralError extends Error{constructor(public readonly status:number,public readonly code:string,message:string){super(message);this.name='ReferralError'}}
export function referralSchemaReady(raw:Record<string,string|undefined>=process.env){return raw.REFERRAL_REWARDS_SCHEMA_READY==='true'}
const draftPolicy={configured:false,enabled:false,rewardEtb:'0.00',version:0,updatedAt:null as string|null};
export async function getReferralPolicy(client:DB,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return {...draftPolicy};
 const policy=await client.referralPolicy.findUnique({where:{id:'default'},select:{enabled:true,rewardCents:true,version:true,updatedAt:true}});
 return policy?{
  configured:policy.rewardCents!==null,enabled:policy.enabled&&policy.rewardCents!==null,
  rewardEtb:policy.rewardCents===null?draftPolicy.rewardEtb:centsToEtb(policy.rewardCents),version:policy.version,updatedAt:policy.updatedAt.toISOString(),
 }:{...draftPolicy};
}
async function databaseNow(tx:DB){return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`)[0].now}
function referralToken(payload:string|undefined|null){return typeof payload==='string'?/^ref_([A-Za-z0-9_-]{12})$/.exec(payload)?.[1]??null:null}
async function eligibleSponsor(tx:DB,userId:string){const user=await tx.user.findUnique({where:{id:userId},select:{telegramId:true,role:true}});return !!user?.telegramId&&user.role==='member'&&!userId.startsWith('demo-showcase-')&&!await tx.testRunActor.findFirst({where:{userId}})&&!await tx.staffMember.findUnique({where:{userId}})&&!await tx.userRestriction.findFirst({where:{userId,suspended:true}})}
function emptyOverview(){return {configured:false,enabled:false,shareUrl:null as string|null,webShareUrl:null as string|null,rewardEtb:null as string|null,counts:{signedUp:0,qualified:0,earned:0},totalEarnedEtb:'0.00'}}

/** Private account overview. Only coordinates/DTOs are cached by the client. */
export async function getReferralOverview(client:PrismaClient,userId:string,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return emptyOverview();
 return client.$transaction(async tx=>{
  const policy=await getReferralPolicy(tx,raw);
  let invite=await tx.referralInvite.findUnique({where:{userId}});
  if(!invite&&policy.enabled&&await eligibleSponsor(tx,userId)){
   await assertPlayerContact(tx,userId);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`referral-invite:${userId}`},0))`;
   invite=await tx.referralInvite.findUnique({where:{userId}})??await tx.referralInvite.create({data:{userId,token:randomBytes(9).toString('base64url')}});
  }
  const [{signedUp,qualified,earned,totalCents}]=await tx.$queryRaw<{signedUp:number;qualified:number;earned:number;totalCents:string}[]>`
   SELECT COUNT(*)::int AS "signedUp",COUNT(s."firstBidId")::int AS qualified,COUNT(r."operationId")::int AS earned,
     COALESCE(SUM(r."amountCents") FILTER (WHERE r."operationId" IS NOT NULL),0)::text AS "totalCents"
   FROM "ReferralSignup" s LEFT JOIN "ReferralWalletReward" r ON r."referredUserId"=s."referredUserId"
   WHERE s."referrerUserId"=${userId}`;
  const shareUrl=invite&&policy.enabled?botReferralShareUrl(invite.token,raw.TELEGRAM_BOT_USERNAME):null;
  const webShareUrl=invite&&policy.enabled?websiteReferralShareUrl(invite.token,raw.BETTER_AUTH_URL):null;
  return {configured:policy.configured,enabled:policy.enabled,shareUrl,webShareUrl,rewardEtb:policy.configured?policy.rewardEtb:null,counts:{signedUp,qualified,earned},totalEarnedEtb:centsToEtb(BigInt(totalCents))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

/** Called only from the authenticated Telegram bot update handler. No messages. */
export async function recordBotReferralStart(client:PrismaClient,telegramId:string,botId:string,payload:string,raw:Record<string,string|undefined>=process.env){
 const token=referralToken(payload);if(!referralSchemaReady(raw)||!token||!/^\d{1,20}$/.test(telegramId)||botId!==contactBotId())return false;
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:${telegramId}`},0))`;
  if(await tx.user.findUnique({where:{telegramId}}))return false;
  return storePendingReferralStart(tx,telegramId,botId,token,raw);
 });
}

/** The caller proved a new identity and signed start parameter under its Telegram lock. */
export async function recordSignedMiniReferralStartInTransaction(tx:Tx,telegramId:string,payload:string,raw:Record<string,string|undefined>=process.env){
 const token=referralToken(payload);if(!referralSchemaReady(raw)||!token)return false;
 return storePendingReferralStart(tx,telegramId,contactBotId(),token,raw);
}

async function storePendingReferralStart(tx:Tx,telegramId:string,botId:string,token:string,raw:Record<string,string|undefined>){
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
}

/** Caller holds the existing telegram identity lock and proves this user is new. */
export async function attributeNewReferralInTransaction(tx:Tx,userId:string,telegramId:string,{newAccount,signedStartParam,websiteReferralCode}:{newAccount:boolean;signedStartParam?:string|null;websiteReferralCode?:string|null},raw:Record<string,string|undefined>=process.env){
 if(!newAccount||!referralSchemaReady(raw))return;
 const token=referralToken(signedStartParam)??referralInviteCode(websiteReferralCode);
 const pending=await tx.referralPendingSignup.findUnique({where:{botId_telegramId:{botId:contactBotId(),telegramId}}});
 // A signup without a signed referral token or pending bot referral has
 // nothing to attribute. Avoid policy, clock and eligibility reads in that case.
 if(!token&&(!pending||pending.consumedUserId))return;
 const now=await databaseNow(tx),policy=await getReferralPolicy(tx,raw);if(!policy.enabled)return;
 if(await tx.referralSignup.findUnique({where:{referredUserId:userId}})||await tx.bid.findFirst({where:{userId}}))return;
 const usablePending=pending&&!pending.consumedUserId&&pending.expiresAt>now?pending:null;
 const direct=!usablePending&&token?await tx.referralInvite.findUnique({where:{token}}):null;
 const sponsor=usablePending?.referrerUserId??direct?.userId;
 if(!sponsor||sponsor===userId||!await eligibleSponsor(tx,sponsor))return;
 if(usablePending)await tx.referralPendingSignup.update({where:{id:usablePending.id},data:{consumedUserId:userId}});
 await tx.referralSignup.create({data:{referredUserId:userId,referrerUserId:sponsor,pendingId:usablePending?.id,registeredAt:now}});
}

/** Runs only after an accepted bid is recorded, inside the same transaction. */
export async function qualifyReferralInTransaction(tx:Tx,userId:string,bidId:string,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return;
 const [signup]=await tx.$queryRaw<{referrerUserId:string;eligible:boolean}[]>`
  SELECT "referrerUserId",lowwin_referral_bid_eligible(${bidId},${userId}) AS eligible
  FROM "ReferralSignup" WHERE "referredUserId"=${userId} AND "firstBidId" IS NULL FOR UPDATE`;
 if(!signup?.eligible)return;
 const [policy]=await tx.$queryRaw<{enabled:boolean;rewardCents:bigint|null;version:number}[]>`
  SELECT enabled,"rewardCents",version FROM "ReferralPolicy" WHERE id='default' FOR SHARE`;
 const [{qualifiedAt}]=await tx.$queryRaw<{qualifiedAt:Date}[]>`
  UPDATE "ReferralSignup" SET "firstBidId"=${bidId},"qualifiedAt"=clock_timestamp() AT TIME ZONE 'UTC'
  WHERE "referredUserId"=${userId} RETURNING "qualifiedAt"`;
 if(!policy?.enabled||policy.rewardCents===null||!await eligibleSponsor(tx,signup.referrerUserId))return;
 const reward=await tx.referralWalletReward.create({data:{
  referredUserId:userId,referrerUserId:signup.referrerUserId,bidId,amountCents:policy.rewardCents,policyVersion:policy.version,createdAt:qualifiedAt,
 }});
 await creditReferralWalletReward(tx,reward);
}

type WalletReward=Pick<ReferralWalletReward,'referredUserId'|'referrerUserId'|'bidId'|'amountCents'|'policyVersion'>;
async function creditReferralWalletReward(tx:Tx,reward:WalletReward){
 // The bid already owns a different player's wallet. Do not wait on another
 // wallet while holding bid or settlement ledger locks. Persisted awards are
 // picked up by the worker if a referrer's wallet is in use.
 const [{locked}]=await tx.$queryRaw<{locked:boolean}[]>`
  SELECT pg_try_advisory_xact_lock(hashtextextended(${`wallet:${reward.referrerUserId}`},0)) AS locked`;
 if(!locked)return false;
 const availableName=`user:${reward.referrerUserId}:available`;
 let available=await tx.ledgerAccount.findUnique({where:{name:availableName},select:{id:true}});
 if(!available){
  await ensureWallet(tx,reward.referrerUserId);
  available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:availableName},select:{id:true}});
 }
 const funding=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:referral-wallet-rewards'},select:{id:true}});
 const scope='REFERRAL_REWARD',amount=new Prisma.Decimal(centsToEtb(reward.amountCents));
 const result={bidId:reward.bidId,amountCents:reward.amountCents.toString(),amountEtb:centsToEtb(reward.amountCents),policyVersion:reward.policyVersion};
 const operation=await tx.operation.create({data:{
  userId:reward.referrerUserId,scope,key:reward.referredUserId,requestHash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result,
 }});
 await tx.journal.create({data:{operationId:operation.id,kind:scope,reference:`referral:${reward.referredUserId}`,postings:{create:[
  {accountId:available.id,delta:amount},{accountId:funding.id,delta:amount.negated()},
 ]}}});
 await tx.$executeRaw`
  UPDATE "ReferralWalletReward" SET "operationId"=${operation.id},"creditedAt"=clock_timestamp() AT TIME ZONE 'UTC'
  WHERE "referredUserId"=${reward.referredUserId}`;
 return true;
}

export async function settlePendingReferralWalletRewards(client:PrismaClient,raw:Record<string,string|undefined>=process.env){
 if(!referralSchemaReady(raw))return false;
 const pending=await client.referralWalletReward.findMany({where:{operationId:null},orderBy:[{createdAt:'asc'},{referredUserId:'asc'}],take:10,select:{referredUserId:true}});
 let credited=false;
 for(const row of pending){
  const settled=await client.$transaction(async tx=>{
   const [reward]=await tx.$queryRaw<WalletReward[]>`
    SELECT "referredUserId","referrerUserId","bidId","amountCents","policyVersion" FROM "ReferralWalletReward"
    WHERE "referredUserId"=${row.referredUserId} AND "operationId" IS NULL FOR UPDATE SKIP LOCKED`;
   return reward?creditReferralWalletReward(tx,reward):false;
  });
  credited=credited||settled;
 }
 return credited;
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
