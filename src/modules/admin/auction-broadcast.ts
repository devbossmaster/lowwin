import type {Prisma} from '@prisma/client';
import {AdminError} from './errors';
import {digest} from './crypto';
import {auctionNotificationImagePath} from '../notifications/campaigns';
import {readAuctionPromotion} from '../notifications/auction-promotion';

/** Read and command share the same public-only preview. No recipient/contact data. */
export async function auctionBroadcastDraft(tx:Prisma.TransactionClient,auctionId:string,now?:Date){
 const {auction:a,issue}=await readAuctionPromotion(tx,auctionId,now);
 if(issue||!a?.product)throw new AdminError(422,issue??'Auction not found.');
 const snapshot=a.presentation as {title?:string;titleAm?:string}|null;
 const title=(snapshot?.title??a.product.title).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120),titleAm=(snapshot?.titleAm??a.product.titleAm??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120);
 const imagePath=auctionNotificationImagePath(a.presentation,a.product.images[0]?.path);
 if(!imagePath)throw new AdminError(422,'Add a published product image before broadcasting this auction.');
 const text=`${title}${titleAm&&titleAm!==title?'\n'+titleAm:''}\n\nCome and join the auction. Choose your number and place your bid.\nጨረታውን ይቀላቀሉ። ቁጥርዎን መርጠው ጨረታዎን ያቅርቡ።`;
 const miniAppPath=`/auctions/${a.publicCode}`,buttonLabel='Bid now · አሁን ይጫረቱ';
 return {id:a.id,auctionId:a.id,auctionCode:String(a.publicCode),title,text,imageId:null,imagePath,miniAppPath,buttonLabel,draftHash:digest(JSON.stringify({title,text,imagePath,miniAppPath}))};
}
