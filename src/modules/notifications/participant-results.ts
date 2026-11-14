import type {Prisma,Outbox} from '@prisma/client';
/** Compatibility expansion never notifies all participants about winning or
 * losing. It creates only the published winner's private congratulations,
 * using the same durable key as direct publication. */
export async function expandParticipantResults(tx:Prisma.TransactionClient,row:Outbox){
 const p=row.payload as {auctionId?:string;settlementId?:string;imagePath?:string};
 const skip=async(reason:string)=>{await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:reason}});return 0};
 if(row.kind!=='AUCTION_PARTICIPANTS'||!p.auctionId)return skip('NOTIFICATION_RETIRED');
 const settlement=await tx.auctionSettlement.findUnique({where:{auctionId:p.auctionId},select:{id:true,outcome:true,winnerUserId:true,completedAt:true,cutoff:true,publication:{select:{publishedAt:true}}}});
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 if(!settlement?.publication||settlement.outcome!=='WINNER'||!settlement.winnerUserId||settlement.completedAt>now||settlement.cutoff>now||settlement.publication.publishedAt>now||p.settlementId&&p.settlementId!==settlement.id||row.settlementId&&row.settlementId!==settlement.id)return skip('RESULT_NOT_PUBLISHED');
 const created=await tx.outbox.createMany({data:[{
  key:`settlement:${settlement.id}:winner:${settlement.winnerUserId}`,kind:'WINNER_CONGRATULATIONS',
  settlementId:settlement.id,testRunId:row.testRunId,
  payload:{auctionId:p.auctionId,settlementId:settlement.id,recipientUserId:settlement.winnerUserId,...(p.imagePath?{imagePath:p.imagePath}:{})},
 }],skipDuplicates:true});
 await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:now}});
 return created.count;
}
