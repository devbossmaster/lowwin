import type {Prisma} from '@prisma/client';

export const bidPublicationSelect={status:true,settlement:{select:{publication:{select:{publishedAt:true}}}}} as const satisfies Prisma.AuctionSelect;

type AuctionPublication=Prisma.AuctionGetPayload<{select:typeof bidPublicationSelect}>;

export function bidNumbersPublished(auction:AuctionPublication|null,now:Date){
 const publishedAt=auction?.settlement?.publication?.publishedAt;
 return !!auction&&(auction.status==='CLOSED'||auction.status==='CANCELLED')&&!!publishedAt&&publishedAt<=now;
}
