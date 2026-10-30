import type {Prisma,Outbox} from '@prisma/client';

/** dispatchOne locks this durable cursor job first. Each transaction expands at
 * most 250 immutable settlement participants, never the entire auction. Private
 * inbox entries are materialized by normal per-recipient dispatch afterwards. */
export async function expandParticipantResults(tx:Prisma.TransactionClient,row:Outbox){
 const p=row.payload as {auctionId?:string;settlementId?:string;cursor?:string};
 if(!p.auctionId||!p.settlementId)throw Error('Invalid participant result intent');
 const settlement=await tx.auctionSettlement.findFirst({where:{id:p.settlementId,auctionId:p.auctionId,publication:{is:{publishedAt:{lte:new Date()}}}},select:{outcome:true}});
 if(!settlement||settlement.outcome==='CANCELLED'){
  await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:!settlement?'RESULT_NOT_PUBLISHED':'CANCELLATION_SILENT'}});return 0;
 }
 const participants=await tx.settlementMovement.findMany({where:{settlementId:p.settlementId,...(p.cursor?{userId:{gt:p.cursor}}:{})},select:{userId:true},orderBy:{userId:'asc'},take:250});
 if(participants.length)await tx.outbox.createMany({data:participants.map(({userId})=>({key:`settlement:${p.settlementId}:user:${userId}`,kind:'AUCTION_CLOSED',settlementId:p.settlementId,testRunId:row.testRunId,payload:{auctionId:p.auctionId,settlementId:p.settlementId,recipientUserId:userId}})),skipDuplicates:true});
 if(participants.length===250){
  const cursor=participants.at(-1)!.userId,key=`settlement:${p.settlementId}:participants:after:${cursor}`;
  await tx.outbox.upsert({where:{key},create:{key,kind:'AUCTION_PARTICIPANTS',settlementId:p.settlementId,testRunId:row.testRunId,payload:{auctionId:p.auctionId,settlementId:p.settlementId,cursor}},update:{}});
 }
 await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:new Date()}});return participants.length;
}
