import type {Prisma,Outbox} from '@prisma/client';
/** The published winner campaign replaces legacy private result fan-out. */
export async function expandParticipantResults(tx:Prisma.TransactionClient,row:Outbox){
 await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'NOTIFICATION_RETIRED'}});
 return 0;
}
