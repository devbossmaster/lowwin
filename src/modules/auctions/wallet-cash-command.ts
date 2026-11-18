import {Prisma,type PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import type {PaymentCreationBinding} from '../payments/creation-eligibility';
import {PrivateApiError} from '../auth/private-api';
import {ChapaError,chapaHash} from '../payments/chapa-provider';
import {BidError,type BidReceipt} from './bids';
import {batchChildKey,type BatchLine} from './batch';
import {centsToEtb,etbToCents} from '@/lib/money';
import {walletBidsEnabled} from '../wallet/policy';
import {bidPurchaseNotificationCopy} from '../notifications/amharic-copy';
import {walletBidCommittedReceipt} from '@/lib/wallet-bid-command';

export type WalletCashCommandInput={key:string;auctionSlug:string;numbers:string[];feeVersion:number;approvedTotal:string;requestHash:string};
type Batch={id:string;quoteHash:string;auctionSlug:string;ruleVersion:string;feeVersion:number;lines:BatchLine[];entryCount:number;total:string;totalCents:string;grossTotal:string;discountTotal:string;status:string};
export type WalletCashCommandResult={kind:'receipt';receipt:{batch:Batch;receipts:Array<Pick<BidReceipt,'bid'|'charge'>>;wallet:{available:string;held:string;cashAvailable:string;bonusAvailable:string;bonusExpiresAt:null;revision:string};payment:{method:'wallet';gateway:'INTERNAL_WALLET';total:string;acceptedBidIds:string[]}}};
const productMarker='LOWWIN_PRODUCT_TITLE_SLOT';
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** The optional migration may lag the application during a rolling deployment.
 * Only absence of this exact entrypoint permits the original command. A lost
 * connection, timeout, failed trigger or malformed committed result is uncertain
 * and must never run a second mutation as a fallback. */
function missingEntrypoint(error:unknown){
 return error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'&&error.meta?.code==='42883'&&typeof error.meta.message==='string'&&/^(?:ERROR: )?function (?:public\.)?lowwin_cash_wallet_batch\(/.test(error.meta.message);
}
function databaseError(error:unknown):never{
 if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'){
  const message=typeof error.meta?.message==='string'?error.meta.message:'';
  if(message.includes('Auction is not open for bids'))throw new ChapaError(409,'AUCTION_CLOSED','This auction closed before your bids were accepted.');
  if(message.includes('Distinct bid limit reached'))throw new ChapaError(409,'CAP_REACHED','These entries exceed your remaining submissions.');
  if(message.includes('current fee revision')||message.includes('fee quote is stale'))throw new ChapaError(409,'TERMS_CHANGED','The fee changed. Review a new quote before paying.');
  if(message.includes('Minimum bid')||message.includes('published terms'))throw new ChapaError(422,'INVALID_AMOUNT','Choose amounts within the published bounds and increment.');
  if(error.meta?.code==='23505'&&message.includes('Bid_userId_auctionId_amount_key'))throw new ChapaError(409,'OWN_DUPLICATE','You already submitted one of these amounts.');
 }
 throw error;
}

/** One autocommit database call for an existing cash-only wallet. All mutable
 * eligibility and balances are read by the database after its financial locks.
 * Original/referred/coupon/bonus/incomplete cases perform no financial writes
 * here and retain the existing complete command. */
export async function runAtomicCashWalletCommand(client:PrismaClient,binding:PaymentCreationBinding,userId:string,input:WalletCashCommandInput):Promise<WalletCashCommandResult|null>{
 if(userId!==binding.userId)throw new PrivateApiError(401,'Sign in through Telegram.');
 const totalCents=etbToCents(input.approvedTotal),count=BigInt(input.numbers.length);
 // This is an eligibility bound, not a second rejection policy: the original
 // command retains validation/error precedence for an out-of-bound draft.
 if(count<1n||count>100n||totalCents%count!==0n||input.numbers.some(number=>etbToCents(number)<100n))return null;
 const feeCents=totalCents/count,fee=centsToEtb(feeCents),batchId=randomUUID();
 const lines=input.numbers.map((number,position)=>({position,number,grossFee:fee,discount:'0.00',netFee:fee}));
 const quoteHashes=Object.fromEntries(['lowest-unique-v4','lowest-unique-v5'].map(ruleVersion=>[ruleVersion,chapaHash(JSON.stringify({id:batchId,userId,ruleVersion,feeVersion:input.feeVersion,lines,totalCents:String(totalCents)}))]));
 // Notification wording remains owned by the existing copy helper. The DB
 // replaces only the product slot using its locked current presentation.
 const notice=bidPurchaseNotificationCopy({productTitle:productMarker,numbers:input.numbers,paidFee:input.approvedTotal,ruleVersion:'lowest-unique-v5'});
 const children=input.numbers.map((number,position)=>({id:randomUUID(),operationId:randomUUID(),journalId:randomUUID(),postingIds:[randomUUID(),randomUUID()],key:batchChildKey(batchId,position),requestHash:chapaHash(JSON.stringify({auctionSlug:input.auctionSlug,amount:new Prisma.Decimal(number).toString(),feeVersion:input.feeVersion})),numberText:new Prisma.Decimal(number).toString()}));
 let result:unknown;
 try{
  const rows=await client.$queryRaw<Array<{result:unknown}>>`SELECT public.lowwin_cash_wallet_batch(${JSON.stringify(binding)}::jsonb,${JSON.stringify({...input,batchId,quoteHashes,lines,children,notice,productMarker,outboxId:randomUUID(),inboxId:randomUUID(),walletEnabled:walletBidsEnabled()})}::jsonb) AS result`;
  if(rows.length!==1)throw Error('Cash wallet command returned no owned result.');
  result=rows[0].result;
 }catch(error){if(missingEntrypoint(error))return null;databaseError(error)}
 if(result===null)return null;
 const data=record(result);
 if(data?.kind==='error'){
  const code=data.code;
  if(code==='UNAUTHORIZED')throw new PrivateApiError(401,'Sign in through Telegram.');
  if(code==='BIDDING_RESTRICTED')throw new ChapaError(403,code,'Bidding is unavailable for this account.');
  if(code==='AUCTIONS_PAUSED')throw new ChapaError(503,code,'Auctions are paused. Existing funds remain safe.');
  if(code==='INSUFFICIENT_POINTS')throw new BidError(code,409,'Your Lowwin Wallet balance is too low.',data.wallet as {available:string;required:string;shortfall:string;currency:'ETB'});
 }
 if(!walletBidCommittedReceipt(result,{command:input}))throw Error('Cash wallet command did not return its exact committed receipt.');
 return result as WalletCashCommandResult;
}
