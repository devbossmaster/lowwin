import {RULE_V1,RULE_V2} from './rules';
import {materializeAlert} from '../notifications/service';
import { createHash,randomUUID } from 'node:crypto';
import { Prisma,type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { demoBidAllowed } from './bids';
import {stagingDemoEnabled} from './staging-demo';
import { seedPlatformAccounts } from '@/modules/wallet/ledger';
import { settleWalletInTransaction } from '@/modules/wallet/settlement';

export class SettlementError extends Error {
  constructor(public readonly code:string){super(code);this.name='SettlementError'}
}
// Permission-ready internal capability. A future admin boundary must derive it
// from verified authorization; it must never copy a browser-supplied permission.
const cancelSchema=z.object({auctionId:z.string().min(1).max(128),actor:z.object({id:z.string().trim().min(1).max(128),permission:z.literal('auction:cancel')}).strict(),reason:z.string().trim().min(1).max(1000),key:z.string().uuid()}).strict();
export type CancelInput=z.infer<typeof cancelSchema>;
const txOptions={isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:15000,timeout:120000};
const settlementInclude={movements:true} as const;

async function completeLocked(tx:Prisma.TransactionClient,auctionId:string,cancellation:CancelInput|null,raw:Record<string,string|undefined>) {
  // Every caller locks ONE auction first. Lock ALL participant wallet advisory
  // keys in code-point user-id order, then their guard/projection rows. No writer
  // may acquire another auction after wallet locks. ReadCommitted refreshes rows
  // after waits; the original immutable bid cutoff is never advanced.
  const locked=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;
  if(!locked.length)throw new SettlementError('AUCTION_NOT_FOUND');
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  const requestHash=cancellation?createHash('sha256').update(JSON.stringify({auctionId,actorId:cancellation.actor.id,reason:cancellation.reason})).digest('hex'):null;
  if(cancellation){
    const replay=await tx.auctionSettlement.findUnique({where:{actorId_key:{actorId:cancellation.actor.id,key:cancellation.key}},include:settlementInclude});
    if(replay){if(replay.requestHash!==requestHash)throw new SettlementError('KEY_REUSED');return replay;}
  }
  const existing=await tx.auctionSettlement.findUnique({where:{auctionId},include:settlementInclude});
  if(existing){if(cancellation)throw new SettlementError('ALREADY_SETTLED');return existing;}
  const auction=await tx.auction.findUniqueOrThrow({where:{id:auctionId},include:{terms:true,result:true}});
  if(auction.result)throw new SettlementError('ILLUSTRATIVE_RESULT_PRESERVED');
  if(!auction.publishedAt||auction.publishedAt>now||!['LIVE','SCHEDULED'].includes(auction.status)||!auction.endsAt||!auction.terms)throw new SettlementError('AUCTION_NOT_SETTLEABLE');
  if(auction.isDemo&&(!auction.isSettlementFixture||!(demoBidAllowed(raw)||stagingDemoEnabled(raw))))throw new SettlementError('DEMO_SETTLEMENT_FORBIDDEN');
  if(!cancellation&&auction.endsAt>now)throw new SettlementError('NOT_DUE');
  if(![RULE_V1,RULE_V2].includes(auction.terms.ruleVersion))throw new SettlementError('UNSUPPORTED_RULE');

  const bids=await tx.bid.findMany({where:{auctionId,acceptedAt:{lt:auction.endsAt}},orderBy:[{amount:'asc'},{acceptanceOrder:'asc'},{id:'asc'}],include:{operation:{include:{journal:{include:{postings:{include:{account:true}}}}}}}});
  if(bids.length!==auction.acceptedBidCount)throw new SettlementError('ACCEPTED_COUNT_MISMATCH');
  const frequencies:{amount:string;count:number}[]=[];
  const amounts=new Map<string,typeof bids>();
  const feesByUser=new Map<string,{points:bigint;journalIds:string[]}>();
  for(const bid of bids){
    const amount=bid.amount.toString(),same=amounts.get(amount)??[];same.push(bid);amounts.set(amount,same);
    if(bid.termsVersion!==auction.terms.version||bid.feePoints!==auction.terms.entryFeePoints)throw new SettlementError('BID_TERMS_MISMATCH');
    const journal=bid.operation.journal;
    if(bid.operation.userId!==bid.userId||bid.operation.scope!=='BID')throw new SettlementError('BID_OPERATION_MISMATCH');
    if(bid.feePoints>0n){
      if(!journal||journal.kind!=='BID_FEE'||journal.postings.length!==2
        ||!journal.postings.some(p=>p.account.name==='platform:fees'&&p.delta===bid.feePoints)
        ||!journal.postings.some(p=>p.account.name===`user:${bid.userId}:available`&&p.delta===-bid.feePoints))throw new SettlementError('BID_FEE_MISMATCH');
    }else if(journal)throw new SettlementError('BID_FEE_MISMATCH');
    const fees=feesByUser.get(bid.userId)??{points:0n,journalIds:[]};fees.points+=bid.feePoints;if(journal)fees.journalIds.push(journal.id);feesByUser.set(bid.userId,fees);
  }
  for(const [amount,rows] of amounts)frequencies.push({amount,count:rows.length});
  const unique=frequencies.find(item=>item.count===1);
  const v2=auction.terms.ruleVersion===RULE_V2;
  const participantCount=new Set(bids.map(bid=>bid.userId)).size;
  const minimumCancellation=v2&&!cancellation&&participantCount<auction.terms.minParticipants;
  const cancelled=!!cancellation||minimumCancellation;
  if(v2&&(auction.terms.minParticipants!==2||bids.some(bid=>bid.acceptanceOrder===null)||auction.bidSequence!==BigInt(bids.length)))throw new SettlementError('ACCEPTANCE_ORDER_MISMATCH');
  const winner=cancelled?null:unique?amounts.get(unique.amount)![0]:v2?bids[0]??null:null;
  const decision=cancellation?'OWNER_CANCELLED':minimumCancellation?'MINIMUM_PARTICIPANTS':unique?'LOWEST_UNIQUE':'FIRST_ACCEPTED_LOWEST';
  const outcome=cancelled?'CANCELLED':winner?'WINNER':'NO_WINNER';
  const holds=await tx.auctionHold.findMany({where:{auctionId},include:{wallet:true}});
  const userIds=[...new Set([...bids.map(b=>b.userId),...holds.map(h=>h.wallet.userId)])].sort();
  for(const userId of userIds)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  // Take all guard rows before platform postings, using the same stable order.
  const wallets=await tx.wallet.findMany({where:{userId:{in:userIds}},select:{id:true,userId:true}});
  const byUser=new Map(wallets.map(wallet=>[wallet.userId,wallet.id]));
  for(const userId of userIds){const id=byUser.get(userId);if(!id)throw new SettlementError('MISSING_PARTICIPANT_WALLET');await tx.$executeRaw`SELECT lock_wallet_hold_state(${id})`;}
  await seedPlatformAccounts(tx);
  const settlementId=randomUUID(),movements=[];
  for(const userId of userIds){
    const fees=feesByUser.get(userId)??{points:0n,journalIds:[]};
    movements.push(await settleWalletInTransaction(tx,{settlementId,auctionId,userId,charge:winner?.userId===userId?winner.amount:0n,refund:cancelled?fees.points:0n,feeJournalIds:fees.journalIds}));
  }
  const journalRows=v2?await tx.journal.findMany({where:{operationId:{in:movements.flatMap(m=>[m.chargeOperationId,m.releaseOperationId,m.refundOperationId].filter((id):id is string=>!!id))}},select:{id:true,operationId:true}}):[];
  const journals=new Map(journalRows.map(j=>[j.operationId,j.id]));
  const references=movements.map(m=>({...m,holdBefore:m.holdBefore.toString(),chargedPoints:m.chargedPoints.toString(),releasedPoints:m.releasedPoints.toString(),refundedFees:m.refundedFees.toString(),feeJournalIds:v2?[...(feesByUser.get(m.userId)?.journalIds??[])].sort():(feesByUser.get(m.userId)?.journalIds??[]),...(v2?{chargeJournalId:journals.get(m.chargeOperationId!)??null,releaseJournalId:journals.get(m.releaseOperationId!)??null,refundJournalId:journals.get(m.refundOperationId!)??null}:{})}));
  const proof={ruleVersion:auction.terms.ruleVersion,termsVersion:auction.terms.version,cutoff:auction.endsAt.toISOString(),acceptedCount:bids.length,amountFrequencies:frequencies,outcome,
    winner:winner?{userId:winner.userId,bidId:winner.id,amount:winner.amount.toString(),...(v2?{acceptanceOrder:winner.acceptanceOrder!.toString()}:{})}:null,
    ...(v2?{minParticipants:auction.terms.minParticipants,participantCount,acceptanceCutoff:auction.bidSequence.toString(),decision}:{}),
    feePolicy:cancelled?'REFUND_ALL_ENTRY_FEES':'KEEP_DISCLOSED_ENTRY_FEES',settlementId,references,
    cancellation:cancellation?{actorId:cancellation.actor.id,reason:cancellation.reason,key:cancellation.key}:null};
  await tx.auction.update({where:{id:auctionId},data:{status:cancelled?'CANCELLED':'CLOSED',nextCloseAttemptAt:null,closeErrorCode:null}});
  const settled=await tx.auctionSettlement.create({data:{id:settlementId,auctionId,outcome,ruleVersion:auction.terms.ruleVersion,termsVersion:auction.terms.version,cutoff:auction.endsAt,acceptedCount:bids.length,
    winnerUserId:winner?.userId,winningBidId:winner?.id,winningPoints:winner?.amount,
    ...(v2?{decision,participantCount,acceptanceCutoff:auction.bidSequence}:{}),
    actorId:cancellation?.actor.id,reason:minimumCancellation?'MINIMUM_PARTICIPANTS':cancellation?.reason,key:cancellation?.key,requestHash,proof,
    movements:{create:movements},
    // No amounts, frequencies, names, Telegram IDs or winning guesses in intents.
    // Phase 5 resolves recipient preferences and performs external delivery.
    outbox:{create:[{key:`settlement:${settlementId}:completed`,kind:'AUCTION_FINALIZED',payload:{auctionId,settlementId,outcome}},...userIds.map(userId=>({key:`settlement:${settlementId}:user:${userId}`,kind:cancelled?'AUCTION_CANCELLED':'AUCTION_CLOSED',payload:{auctionId,settlementId,recipientUserId:userId}}))]},
  },include:settlementInclude});
  for(const row of await tx.outbox.findMany({where:{settlementId:settled.id}}))await materializeAlert(tx,row);
  return settled;
}

export function closeAuctionInTransaction(tx:Prisma.TransactionClient,auctionId:string,raw:Record<string,string|undefined>=process.env){return completeLocked(tx,auctionId,null,raw)}
export function closeAuction(client:PrismaClient,auctionId:string,raw:Record<string,string|undefined>=process.env){return client.$transaction(tx=>closeAuctionInTransaction(tx,auctionId,raw),txOptions)}
export function cancelAuctionInTransaction(tx:Prisma.TransactionClient,input:CancelInput,raw:Record<string,string|undefined>=process.env){const command=cancelSchema.parse(input);return completeLocked(tx,command.auctionId,command,raw)}
export async function cancelAuction(client:PrismaClient,input:CancelInput,raw:Record<string,string|undefined>=process.env){
  try{return await client.$transaction(tx=>cancelAuctionInTransaction(tx,input,raw),txOptions)}
  catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new SettlementError('KEY_REUSED');throw error;}
}

/** Durable work is the due auction row, not an in-memory claim. SKIP LOCKED lets
 * independent processes work concurrently. A crash releases the transaction lock. */
export async function processDueAuction(client:PrismaClient,raw:Record<string,string|undefined>=process.env){
  let attempted:string|null=null;
  try{
    return await client.$transaction(async tx=>{
      const allowDemo=demoBidAllowed(raw)||stagingDemoEnabled(raw);
      const rows=await tx.$queryRaw<{id:string}[]>`SELECT a.id FROM "Auction" a
        WHERE a.status IN ('LIVE','SCHEDULED') AND a."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC'
          AND a."endsAt"<=clock_timestamp() AT TIME ZONE 'UTC'
          AND (a."nextCloseAttemptAt" IS NULL OR a."nextCloseAttemptAt"<=clock_timestamp() AT TIME ZONE 'UTC')
          AND (NOT a."isDemo" OR (${allowDemo} AND a."isSettlementFixture"))
          AND NOT EXISTS (SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
          AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id)
        ORDER BY a."endsAt",a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`;
      if(!rows.length)return {status:'idle' as const};
      attempted=rows[0].id;
      const settled=await closeAuctionInTransaction(tx,attempted,raw);
      return {status:'settled' as const,auctionId:attempted,settlementId:settled.id};
    },txOptions);
  }catch(error){
    if(!attempted)throw error;
    // Persist bounded retry timing after the failed transaction has rolled back.
    // Log/store only a safe code, never SQL errors containing bids or identities.
    const code=error instanceof SettlementError?error.code:'SETTLEMENT_RETRY';
    await client.$executeRaw`UPDATE "Auction" SET "closeAttempts"="closeAttempts"+1,
      "nextCloseAttemptAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '5 seconds',"closeErrorCode"=${code}
      WHERE id=${attempted} AND status IN ('LIVE','SCHEDULED')`;
    return {status:'retry' as const,auctionId:attempted,code};
  }
}
