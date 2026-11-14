import type {Prisma} from '@prisma/client';
import {AdminError} from './errors';
import {digest} from './crypto';
import {auctionNotificationImagePath} from '../notifications/campaigns';

/** Read and command share the same public-only preview. No recipient/contact data. */
export async function auctionBroadcastDraft(tx:Prisma.TransactionClient,auctionId:string,now=new Date()){
 const a=await tx.auction.findUnique({where:{id:auctionId},select:{id:true,publicCode:true,status:true,startsAt:true,endsAt:true,publishedAt:true,isDemo:true,testRunId:true,presentation:true,settlement:{select:{id:true}},result:{select:{id:true}},product:{select:{title:true,titleAm:true,visible:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}}}});
 if(!a||a.status!=='LIVE'||!a.publishedAt||a.publishedAt>now||!a.startsAt||a.startsAt>now||!a.endsAt||a.endsAt<=now||a.publicCode===null||a.publicCode<1||!a.product?.visible||a.isDemo||a.testRunId||a.settlement||a.result)throw new AdminError(422,'Choose a visible live auction that is still accepting bids.');
 const snapshot=a.presentation as {title?:string;titleAm?:string}|null;
 const title=(snapshot?.title??a.product.title).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120),titleAm=(snapshot?.titleAm??a.product.titleAm??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120);
 const imagePath=auctionNotificationImagePath(a.presentation,a.product.images[0]?.path);
 if(!imagePath)throw new AdminError(422,'Add a published product image before broadcasting this auction.');
 const text=`${title}${titleAm&&titleAm!==title?'\n'+titleAm:''}\n\nCome and join the auction. Choose your number and place your bid.\nጨረታውን ይቀላቀሉ። ቁጥርዎን መርጠው ጨረታዎን ያቅርቡ።`;
 const miniAppPath=`/auctions/${a.publicCode}`,buttonLabel='Bid now · አሁን ይጫረቱ';
 return {id:a.id,auctionId:a.id,auctionCode:String(a.publicCode),title,text,imageId:null,imagePath,miniAppPath,buttonLabel,draftHash:digest(JSON.stringify({title,text,imagePath,miniAppPath}))};
}
