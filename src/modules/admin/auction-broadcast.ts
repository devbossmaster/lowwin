import type {Prisma} from '@prisma/client';
import {AdminError} from './errors';
import {digest} from './crypto';
import {auctionNotificationImagePath} from '../notifications/campaigns';
import {readAuctionPromotion} from '../notifications/auction-promotion';
import {auctionPromotionText} from '../notifications/amharic-copy';

function amharicTitle(value:unknown){
 if(typeof value!=='string')return '';
 const title=value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120);
 return /\p{Script=Ethiopic}/u.test(title)?title:'';
}

/** Read and command share the same public-only preview. No recipient/contact data. */
export async function auctionBroadcastDraft(tx:Prisma.TransactionClient,auctionId:string,now?:Date){
 const {auction:a,issue,now:at}=await readAuctionPromotion(tx,auctionId,now);
 if(issue||!a?.product||!a.endsAt)throw new AdminError(422,issue??'Auction not found.');
 const snapshot=a.presentation as {titleAm?:unknown}|null;
 const title=amharicTitle(snapshot?.titleAm)||amharicTitle(a.product.titleAm)||'የሎውዊን ጨረታ';
 const imagePath=auctionNotificationImagePath(a.presentation,a.product.images[0]?.path);
 if(!imagePath)throw new AdminError(422,'Add a published product image before broadcasting this auction.');
 const text=auctionPromotionText(title,a.endsAt,at);
 const miniAppPath=`/auctions/${a.publicCode}`,buttonLabel='እናሸንፍ!';
 // Approve the real deadline, so clock ticks can refresh the count at send time.
 const draftHash=digest(JSON.stringify({title,endsAt:a.endsAt.toISOString(),imagePath,miniAppPath,buttonLabel}));
 return {id:a.id,auctionId:a.id,auctionCode:String(a.publicCode),title,text,imageId:null,imagePath,miniAppPath,buttonLabel,draftHash};
}
