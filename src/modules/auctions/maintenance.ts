import type {Prisma,PrismaClient} from '@prisma/client';
export async function readAuctionMaintenance(tx:Prisma.TransactionClient|PrismaClient){const row=await tx.adminAudit.findFirst({where:{action:{in:['AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED']}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{action:true,details:true,createdAt:true}});return {halted:row?.action==='AUCTIONS_MAINTENANCE_HALTED',...(row?{details:row.details,changedAt:row.createdAt}:{} )}}
/** Shared barrier comes before auction / wallet locks. The reset package takes
 * the exclusive barrier before recording a durable maintenance halt. Provider
 * verification may retain evidence and credit proven funds while bids pause. */
export async function auctionMaintenance(tx:Prisma.TransactionClient){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
 return (await readAuctionMaintenance(tx)).halted;
}
