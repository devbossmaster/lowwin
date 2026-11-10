import type {PrismaClient} from '@prisma/client';
import {publishSettledResultInTransaction} from '../src/modules/auctions/result-publication';
import {expandParticipantResults} from '../src/modules/notifications/participant-results';
import {materializeAlert} from '../src/modules/notifications/service';
/** Internal server capability for already-settled fixtures; never a player route. */
export async function publishFixtureResult(db:PrismaClient,auctionId:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;
  const s=await tx.auctionSettlement.findUniqueOrThrow({where:{auctionId}});
  const receipt=await publishSettledResultInTransaction(tx,auctionId,{allowFixture:true});
  for(;;){const job=await tx.outbox.findFirst({where:{settlementId:s.id,kind:'AUCTION_PARTICIPANTS',state:'PENDING'}});if(!job)break;await expandParticipantResults(tx,job)}
  for(const row of await tx.outbox.findMany({where:{settlementId:s.id,kind:'AUCTION_CLOSED'}}))await materializeAlert(tx,row);
  return receipt;
 },{timeout:30000,maxWait:10000});
}
