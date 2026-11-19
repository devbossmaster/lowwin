import {Prisma,type PrismaClient} from '@prisma/client';
export async function readAuctionMaintenance(tx:Prisma.TransactionClient|PrismaClient){const row=await tx.adminAudit.findFirst({where:{action:{in:['AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED']}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{action:true,details:true,createdAt:true}});return {halted:row?.action==='AUCTIONS_MAINTENANCE_HALTED',...(row?{details:row.details,changedAt:row.createdAt}:{} )}}
export const sharedAuctionMaintenanceLock=Prisma.sql`pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
/** Shared barrier comes before auction / wallet locks. The reset package takes
 * the exclusive barrier before recording a durable maintenance halt. Provider
 * verification may retain evidence and credit proven funds while bids pause. */
export async function lockAuctionMaintenance(tx:Prisma.TransactionClient){
 await tx.$executeRaw`SELECT ${sharedAuctionMaintenanceLock}`;
}
export const auctionMaintenanceHalted=Prisma.sql`COALESCE((SELECT action='AUCTIONS_MAINTENANCE_HALTED' FROM "AdminAudit"
 WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1),false)`;
export async function auctionMaintenance(tx:Prisma.TransactionClient){
 await lockAuctionMaintenance(tx);
 return (await readAuctionMaintenance(tx)).halted;
}
