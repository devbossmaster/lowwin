import {Prisma} from '@prisma/client';
import {sharedAuctionMaintenanceLock} from '../auctions/maintenance';
import {AdminError} from './errors';

export const maxHomeOrder=2147483647;
type RankedAuction={id:string;homeOrder:number;controlVersion:number;featured:boolean;isDemo:boolean;endsAt:Date;publishedAt:Date;publicCode:number};
type RankedRow=Omit<RankedAuction,'homeOrder'|'endsAt'|'publishedAt'>&{homeOrder:number|null;endsAt:Date|null;publishedAt:Date|null};

// Serialize changes that can claim a position, then lock the affected pool
// before staff/idempotency locks, in the same phase as other auction writes.
export async function lockHomeOrder(tx:Prisma.TransactionClient,auctionId:string,includeRanked:boolean){
 await tx.$executeRaw`
  WITH barrier AS MATERIALIZED (SELECT ${sharedAuctionMaintenanceLock})
  SELECT pg_advisory_xact_lock(hashtextextended('lowwin:home-auction-order',0)) FROM barrier
 `;
 const rows=await tx.$queryRaw<RankedRow[]>`
  SELECT a.id,a."homeOrder",a."controlVersion",a.featured,a."isDemo",a."endsAt",a."publishedAt",a."publicCode"
  FROM "Auction" target CROSS JOIN "Auction" a
  WHERE target.id=${auctionId} AND (a.id=target.id OR (
   ${includeRanked} AND a."testRunId" IS NOT DISTINCT FROM target."testRunId"
   AND a."homeOrder" IS NOT NULL AND a."publishedAt" IS NOT NULL
   AND a.status IN ('LIVE','SCHEDULED') AND a."endsAt">(clock_timestamp() AT TIME ZONE 'UTC')
   AND NOT EXISTS (SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
   AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id)
  )) ORDER BY a.id FOR UPDATE OF a
 `;
 if(!rows.length)throw new AdminError(404,'Auction not found.');
 return rows.filter((row):row is RankedAuction=>row.id!==auctionId&&row.homeOrder!==null&&row.endsAt!==null&&row.publishedAt!==null);
}

function planMoves(ranked:RankedAuction[],previous:number|null,position:number,now:Date){
 const peers=ranked.filter(auction=>auction.endsAt>now);
 const displaced=peers.filter(auction=>auction.homeOrder>=position).sort((a,b)=>
  a.homeOrder-b.homeOrder||Number(b.featured)-Number(a.featured)||a.endsAt.getTime()-b.endsAt.getTime()||
  b.publishedAt.getTime()-a.publishedAt.getTime()||b.publicCode-a.publicCode||a.id.localeCompare(b.id));
 if(displaced[0]?.homeOrder!==position)return [];
 // A legacy duplicate can already occupy the edited auction's old number.
 // In that case, make space at the new number and leave the old owner alone.
 const canSwap=previous!==null&&previous!==position&&!peers.some(auction=>auction.homeOrder===previous);
 const swapped=canSwap?displaced.shift():undefined;
 const moves=swapped?[{auction:swapped,homeOrder:previous!}]:[];
 let next=position+1;
 for(const auction of displaced){
  if(swapped&&next===previous)next++;
  if(auction.homeOrder>=next)break;
  if(next>maxHomeOrder)throw new AdminError(422,'Choose a lower Home order. There is no room to move the current auction down.');
  moves.push({auction,homeOrder:next++});
 }
 return moves;
}

export async function moveHomeOrderOccupants(tx:Prisma.TransactionClient,ranked:RankedAuction[],previous:number|null,position:number|null,isDemo:boolean,actorId:string,now:Date,operationKey:string){
 if(position===null)return [];
 const moves=planMoves(ranked.filter(auction=>auction.isDemo===isDemo),previous,position,now);
 if(!moves.length)return [];
 await tx.auctionControlRevision.createMany({data:moves.map(({auction,homeOrder})=>({
  auctionId:auction.id,version:auction.controlVersion+1,kind:'PRESENTATION',
  before:{homeOrder:auction.homeOrder,featured:auction.featured},after:{homeOrder,featured:auction.featured},
  actorId,reason:'Home order adjusted to make room for another auction',operationKey:`${operationKey}:home-order:${auction.id}`,
 }))});
 const movedAuctions=moves.map(({auction,homeOrder})=>({auctionId:auction.id,homeOrder,controlVersion:auction.controlVersion+1}));
 await tx.$executeRaw`
  UPDATE "Auction" a SET "homeOrder"=m.position, "controlVersion"=m.version
  FROM (VALUES ${Prisma.join(movedAuctions.map(({auctionId,homeOrder,controlVersion})=>Prisma.sql`(${auctionId}::text,${homeOrder}::integer,${controlVersion}::integer)`))}) AS m(id,position,version)
  WHERE a.id=m.id
 `;
 return movedAuctions;
}
