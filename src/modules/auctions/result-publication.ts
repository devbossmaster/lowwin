import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient,type AuctionSettlement} from '@prisma/client';
import {z} from 'zod';
import {RULE_V1,RULE_V2,RULE_V3,RULE_V4} from './rules';
import {clearPublicDataCache} from '@/modules/cache/public-data';

export class ResultPublicationError extends Error{constructor(public readonly code:string){super(code);this.name='ResultPublicationError'}}
export const reviewSettlementSelect={id:true,auctionId:true,outcome:true,ruleVersion:true,termsVersion:true,cutoff:true,completedAt:true,acceptedCount:true,participantCount:true,decision:true,acceptanceCutoff:true,winnerUserId:true,winningBidId:true,winningPoints:true,proof:true} as const;
export type ReviewSettlement=Pick<AuctionSettlement,keyof typeof reviewSettlementSelect>;
export function settlementProofHash(s:ReviewSettlement){return createHash('sha256').update(JSON.stringify({id:s.id,auctionId:s.auctionId,outcome:s.outcome,ruleVersion:s.ruleVersion,termsVersion:s.termsVersion,cutoff:s.cutoff.toISOString(),completedAt:s.completedAt.toISOString(),acceptedCount:s.acceptedCount,participantCount:s.participantCount,decision:s.decision,acceptanceCutoff:s.acceptanceCutoff?.toString()??null,winnerUserId:s.winnerUserId,winningBidId:s.winningBidId,winningPoints:s.winningPoints?.toString()??null,proof:s.proof})).digest('hex')}
const proofSchema=z.object({settlementId:z.string(),ruleVersion:z.string(),termsVersion:z.number().int(),cutoff:z.string(),acceptedCount:z.number().int().nonnegative(),outcome:z.enum(['WINNER','NO_WINNER','CANCELLED']),winner:z.object({userId:z.string(),bidId:z.string(),amount:z.string(),acceptanceOrder:z.string().optional()}).nullable(),amountFrequencies:z.array(z.object({amount:z.string(),count:z.number().int().positive()})),participantCount:z.number().int().nonnegative().optional(),minParticipants:z.number().int().optional(),acceptanceCutoff:z.string().optional(),decision:z.string().optional()}).passthrough();

/** Validate the frozen acceptance snapshot, not a new winner or live bids.
 * The result/ledger are never rewritten by this verification. */
export async function reviewResult(tx:Prisma.TransactionClient,s:ReviewSettlement){
 const proof=proofSchema.safeParse(s.proof),modern=[RULE_V2,RULE_V3,RULE_V4].includes(s.ruleVersion);
 if(![RULE_V1,RULE_V2,RULE_V3,RULE_V4].includes(s.ruleVersion)||!proof.success)throw new ResultPublicationError('RESULT_PROOF_INVALID');
 const p=proof.data;
 if(p.settlementId!==s.id||p.ruleVersion!==s.ruleVersion||p.termsVersion!==s.termsVersion||p.cutoff!==s.cutoff.toISOString()||p.acceptedCount!==s.acceptedCount||p.outcome!==s.outcome)throw new ResultPublicationError('RESULT_PROOF_MISMATCH');
 const where:Prisma.BidWhereInput={auctionId:s.auctionId,acceptedAt:{lt:s.cutoff},...(s.acceptanceCutoff===null?{}:{acceptanceOrder:{lte:s.acceptanceCutoff}})};
 const groups=await tx.bid.groupBy({by:['amount'],where,_count:{_all:true},orderBy:{amount:'asc'}});
 const frequencies=groups.map(row=>({amount:row.amount.toString(),count:row._count._all})),acceptedCount=frequencies.reduce((sum,g)=>sum+g.count,0);
 if(acceptedCount!==s.acceptedCount||p.amountFrequencies.length!==frequencies.length||p.amountFrequencies.some((g,i)=>{try{return !new Prisma.Decimal(g.amount).eq(frequencies[i].amount)||g.count!==frequencies[i].count}catch{return true}}))throw new ResultPublicationError('ACCEPTED_PROOF_MISMATCH');
 const participants=await tx.bid.groupBy({by:['userId'],where}),participantCount=participants.length;
 if(modern){
  const orders=await tx.bid.aggregate({where,_count:{acceptanceOrder:true},_min:{acceptanceOrder:true},_max:{acceptanceOrder:true}});
  if(s.participantCount!==participantCount||p.participantCount!==participantCount||p.minParticipants!==2||p.acceptanceCutoff!==s.acceptanceCutoff?.toString()||s.acceptanceCutoff!==BigInt(acceptedCount)||orders._count.acceptanceOrder!==acceptedCount||acceptedCount&&(orders._min.acceptanceOrder!==1n||orders._max.acceptanceOrder!==s.acceptanceCutoff))throw new ResultPublicationError('ACCEPTANCE_ORDER_MISMATCH');
 }
 const unique=frequencies.find(row=>row.count===1),selected=unique?.amount??(modern?frequencies[0]?.amount:undefined);
 const winner=s.outcome==='CANCELLED'?null:selected?await tx.bid.findFirst({where:{...where,amount:new Prisma.Decimal(selected)},orderBy:modern?[{acceptanceOrder:'asc'},{id:'asc'}]:[{amount:'asc'},{acceptanceOrder:'asc'},{id:'asc'}],select:{id:true,userId:true,amount:true,acceptanceOrder:true}}):null;
 if(s.outcome==='CANCELLED'){
  if(s.winnerUserId||s.winningBidId||s.winningPoints||p.winner)throw new ResultPublicationError('CANCELLED_PROOF_MISMATCH');
  if(modern&&(p.decision!==s.decision||s.decision!=='OWNER_CANCELLED'&&(participantCount>=2||s.decision!=='MINIMUM_PARTICIPANTS')))throw new ResultPublicationError('PARTICIPANT_PROOF_MISMATCH');
 }else{
  if(modern&&(participantCount<2||s.completedAt<s.cutoff||p.decision!==s.decision||s.decision!==(unique?'LOWEST_UNIQUE':'FIRST_ACCEPTED_LOWEST')))throw new ResultPublicationError('PARTICIPANT_PROOF_MISMATCH');
  if(winner?(s.outcome!=='WINNER'||s.winningBidId!==winner.id||s.winnerUserId!==winner.userId||!s.winningPoints?.eq(winner.amount)||!p.winner||p.winner.bidId!==winner.id||p.winner.userId!==winner.userId||!new Prisma.Decimal(p.winner.amount).eq(winner.amount)||modern&&p.winner.acceptanceOrder!==winner.acceptanceOrder?.toString()):(s.outcome!=='NO_WINNER'||s.winningBidId!==null||s.winnerUserId!==null||s.winningPoints!==null||p.winner!==null))throw new ResultPublicationError('WINNER_PROOF_MISMATCH');
 }
 return {proofHash:settlementProofHash(s),frequencies:frequencies.slice(0,100),frequencyTotal:frequencies.length,winningFrequency:s.winningPoints?frequencies.find(g=>new Prisma.Decimal(g.amount).eq(s.winningPoints!))?.count??0:null};
}

/** Caller holds the auction row lock. Publication and logical notification
 * intents commit together; no provider/Telegram HTTP occurs here. */
export async function publishSettledResultInTransaction(tx:Prisma.TransactionClient,auctionId:string,options:{forceSilent?:boolean;allowFixture?:boolean}={}){
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 const s=await tx.auctionSettlement.findUnique({where:{auctionId},select:{...reviewSettlementSelect,publication:true,auction:{select:{status:true,publishedAt:true,isDemo:true,testRunId:true,presentation:true,product:{select:{images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}}}}}});
 if(!s||!['CLOSED','CANCELLED'].includes(s.auction.status)||!s.auction.publishedAt||s.auction.publishedAt>now||s.completedAt>now)throw new ResultPublicationError('RESULT_NOT_READY');
 if(s.publication)return {auctionId,settlementId:s.id,publishedAt:s.publication.publishedAt.toISOString(),alreadyPublished:true,historical:s.publication.historical};
 // Use the database wall clock for announcement readiness as well as the
 // immutable settlement timestamp and strict frozen bid cutoff checks.
 if((s.outcome!=='CANCELLED'||s.decision==='MINIMUM_PARTICIPANTS')&&s.cutoff>now)throw new ResultPublicationError('RESULT_NOT_READY');
 if((s.auction.isDemo||s.auction.testRunId)&&!options.allowFixture)return {auctionId,settlementId:s.id,skipped:true as const};
 const policy=await tx.resultPublicationPolicy.findUnique({where:{id:'auto'}});if(!policy)throw new ResultPublicationError('PUBLICATION_POLICY_NOT_READY');
 const reviewed=await reviewResult(tx,s),historical=options.forceSilent===true||s.completedAt<policy.automaticFrom;
 const publication=await tx.resultPublication.create({data:{settlementId:s.id,actorId:'system:auto-publication',proofHash:reviewed.proofHash,historical,reason:historical?'Validated historical settlement; silent automatic backfill':'Automatic publication of validated immutable settlement'}});
 if(!historical&&s.outcome==='WINNER'){
  const snapshot=s.auction.presentation as {images?:{path?:string}[]}|null,imagePath=snapshot?.images?.[0]?.path??s.auction.product?.images[0]?.path;
  const rows=[{key:`settlement:${s.id}:completed`,kind:'AUCTION_FINALIZED',payload:{auctionId,settlementId:s.id,outcome:s.outcome,...(imagePath?{imagePath}:{})}}];
  await tx.outbox.createMany({data:rows.map(row=>({...row,settlementId:s.id,testRunId:s.auction.testRunId})),skipDuplicates:true});
 }
 await tx.auction.update({where:{id:auctionId},data:{publicationErrorCode:null,nextPublicationAttemptAt:null}});
 return {auctionId,settlementId:s.id,publishedAt:publication.publishedAt.toISOString(),alreadyPublished:false,historical};
}

export async function publishSettledResult(client:PrismaClient,auctionId:string,options:{forceSilent?:boolean;allowFixture?:boolean}={}){
 const result=await client.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;return publishSettledResultInTransaction(tx,auctionId,options)},{maxWait:10000,timeout:60000});
 if(!('skipped'in result))await clearPublicDataCache();return result;
}
export async function recordPublicationFailure(client:PrismaClient,auctionId:string,error:unknown){
 const code=error instanceof ResultPublicationError?error.code:'PUBLICATION_RETRY';
 await client.auction.updateMany({where:{id:auctionId,status:{in:['CLOSED','CANCELLED']},settlement:{is:{publication:{is:null}}}},data:{publicationAttempts:{increment:1},nextPublicationAttemptAt:new Date(Date.now()+30000),publicationErrorCode:code}});
 return {status:'publication-retry' as const,auctionId,code};
}
/** Restart recovery scans durable unpublished settlements. A failed item is
 * postponed so one integrity failure cannot starve later valid auctions. */
export async function recoverUnpublishedResult(client:PrismaClient){
 let attempted:string|null=null;
 try{
  const result=await client.$transaction(async tx=>{
   const rows=await tx.$queryRaw<{id:string}[]>`SELECT a.id FROM "Auction" a JOIN "AuctionSettlement" s ON s."auctionId"=a.id LEFT JOIN "ResultPublication" p ON p."settlementId"=s.id WHERE p."settlementId" IS NULL AND a.status IN ('CLOSED','CANCELLED') AND a."isDemo"=false AND a."testRunId" IS NULL AND a."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC' AND (a."nextPublicationAttemptAt" IS NULL OR a."nextPublicationAttemptAt"<=clock_timestamp() AT TIME ZONE 'UTC') ORDER BY s."completedAt",a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`;
   if(!rows.length)return {status:'idle' as const};attempted=rows[0].id;
   return {status:'published' as const,...await publishSettledResultInTransaction(tx,attempted)};
  },{maxWait:10000,timeout:60000});
  if(result.status==='published')await clearPublicDataCache();return result;
 }catch(error){if(!attempted)throw error;return recordPublicationFailure(client,attempted,error)}
}
