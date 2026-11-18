import {Prisma,type PrismaClient} from '@prisma/client';
import type {WalletCashCommandInput,WalletCashCommandResult} from '../auctions/wallet-cash-command';
import {contactBotId} from '../auth/own-contact';
import {PrivateApiError} from '../auth/private-api';
import {ChapaError} from './chapa-provider';

export type PaymentCreationBinding={sessionId:string;sessionToken:string;userId:string;telegramId:string;telegramAuthSource:string;botId:string};
export type PaymentCreationContact={phoneCipher:string;botId:string;replayExists:boolean};
export type WalletBatchAuthorization={replayExists:boolean;assertEligible:()=>void};
export type PaymentSessionAuthorizer=((tx:Prisma.TransactionClient)=>Promise<void>)&{
 forCurrentDirectCreate?:(tx:Prisma.TransactionClient,userId:string,key:string)=>Promise<PaymentCreationContact>;
 forWalletBatch?:(tx:Prisma.TransactionClient,userId:string,key:string)=>Promise<WalletBatchAuthorization>;
 forWalletCashCommand?:(client:PrismaClient,userId:string,input:WalletCashCommandInput)=>Promise<WalletCashCommandResult|null>;
};
type CreationRow={telegramLaunchId:string|null;telegramAuthSource:string;telegramId:string|null;role:string;contactTelegramId:string|null;botId:string|null;phoneCipher:string|null;revokedAt:Date|null;staffId:string|null;suspended:boolean;replayExists:boolean};
const unauthorized=()=>new PrivateApiError(401,'Sign in through Telegram.');

/** Creation only, after the caller's existing financial locks. Every call reads
 * the current transaction snapshot; neither authorization nor contact is cached.
 * Recovery continues to use the original narrower session authorizer. */
async function readBoundCreation(tx:Prisma.TransactionClient,binding:PaymentCreationBinding,userId:string,key:string,replayTable:'direct'|'wallet'){
 if(userId!==binding.userId||!binding.telegramId||!['MINI_APP','TELEGRAM_OIDC'].includes(binding.telegramAuthSource))throw unauthorized();
 const replay=replayTable==='direct'?Prisma.sql`EXISTS(SELECT 1 FROM "ChapaCheckout" checkout WHERE checkout."userId"=u.id AND checkout.key=${key})`:Prisma.sql`EXISTS(SELECT 1 FROM "BidBatchOrder" batch WHERE batch."userId"=u.id AND batch.key=${key})`;
 const [row]=await tx.$queryRaw<CreationRow[]>`
  SELECT s."telegramLaunchId",s."telegramAuthSource",u."telegramId",u.role,
   c."telegramId" AS "contactTelegramId",c."botId",c."phoneCipher",c."revokedAt",
   staff."userId" AS "staffId",COALESCE(restriction.suspended,false) AS suspended,
   ${replay} AS "replayExists"
  FROM "session" s JOIN "user" u ON u.id=s."userId"
  LEFT JOIN "TelegramOwnContact" c ON c."userId"=u.id
  LEFT JOIN "StaffMember" staff ON staff."userId"=u.id
  LEFT JOIN "UserRestriction" restriction ON restriction."userId"=u.id
  WHERE s.id=${binding.sessionId} AND s.token=${binding.sessionToken} AND s."userId"=${binding.userId}
   AND s."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') LIMIT 1`;
 if(!row||row.telegramLaunchId!==binding.telegramId||row.telegramAuthSource!==binding.telegramAuthSource||row.telegramId!==binding.telegramId||row.staffId||!row.contactTelegramId||row.contactTelegramId!==row.telegramId||row.botId!==binding.botId||row.revokedAt)throw unauthorized();
 return row;
}

export async function authorizeCurrentDirectCreation(tx:Prisma.TransactionClient,binding:PaymentCreationBinding,userId:string,key:string):Promise<PaymentCreationContact>{
 const row=await readBoundCreation(tx,binding,userId,key,'direct');
 if(row.role!=='member')throw unauthorized();
 // Retain creation's restriction and encrypted-contact requirements without
 // imposing them on reconciliation of an existing incoming payment.
 if(row.suspended)throw new ChapaError(403,'BIDDING_RESTRICTED','Payments are unavailable for this account. Existing funds remain safe.');
 if(!row.phoneCipher||!row.botId||row.botId!==contactBotId())throw Error('CONTACT_REQUIRED');
 return {phoneCipher:row.phoneCipher,botId:row.botId,replayExists:row.replayExists};
}

/** Accepted internal-wallet receipts retain their existing read authorization.
 * Only new/quoted submissions call assertEligible. Its facts are private to
 * this fresh transaction read; no wallet funds, fee, coupon or cap is cached. */
export async function authorizeWalletBatch(tx:Prisma.TransactionClient,binding:PaymentCreationBinding,userId:string,key:string):Promise<WalletBatchAuthorization>{
 const row=await readBoundCreation(tx,binding,userId,key,'wallet');
 return {replayExists:row.replayExists,assertEligible:()=>{
  if(!row.contactTelegramId||row.revokedAt||row.contactTelegramId!==row.telegramId||row.botId!==contactBotId())throw Error('CONTACT_REQUIRED');
  if(row.role!=='member'||row.staffId||row.suspended)throw new ChapaError(403,'BIDDING_RESTRICTED','Bidding is unavailable for this account.');
 }};
}
