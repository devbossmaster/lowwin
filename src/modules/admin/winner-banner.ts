import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';

export const winnerBannerSchema=z.object({key:z.string().uuid(),auctionId:z.string().uuid(),version:z.number().int().min(0),imageId:z.string().uuid().nullable(),consentConfirmed:z.boolean().optional(),reason:z.string().trim().min(5).max(500)}).strict();

/** The caller authenticates and locks the auction. This display-only write
 * never updates product media, publication, settlement or financial records. */
export async function saveWinnerBanner(tx:Prisma.TransactionClient,actor:{id:string;role:StaffRole;now:Date},input:z.infer<typeof winnerBannerSchema>){
 if(actor.role!=='OWNER')throw new AdminError(403,'Only an administrator may manage a Winners banner.');
 const auction=await tx.auction.findUnique({where:{id:input.auctionId},select:{status:true,isDemo:true,testRunId:true,publishedAt:true,settlement:{select:{outcome:true,winnerUserId:true,completedAt:true}}}}),settled=auction?.settlement;
 if(!auction?.publishedAt||auction.publishedAt>actor.now||auction.status!=='CLOSED'||auction.isDemo||auction.testRunId||settled?.outcome!=='WINNER'||!settled.winnerUserId||settled.completedAt>actor.now)throw new AdminError(409,'A genuine settled winner is required.');
 const previous=await tx.winnerPresentation.findUnique({where:{auctionId:input.auctionId}});
 if((previous?.version??0)!==input.version)throw new AdminError(409,'The Winners banner changed. Refresh before saving.');
 if(input.imageId){
  if(input.consentConfirmed!==true)throw new AdminError(422,'Confirm image rights and consent from anyone identifiable in the banner.');
  const media=await tx.managedMedia.findUnique({where:{id:input.imageId},select:{id:true,purpose:true,mime:true}});
  if(media?.purpose!=='WINNER_BANNER'||media.mime!=='image/webp')throw new AdminError(422,'Upload a validated Winners banner first.');
 }
 const data={presentationMode:input.imageId?'BANNER':'PRODUCT',bannerImageId:input.imageId,bannerConsentConfirmedAt:input.imageId?actor.now:null,bannerConsentActorId:input.imageId?actor.id:null};
 const saved=await tx.winnerPresentation.upsert({where:{auctionId:input.auctionId},create:{auctionId:input.auctionId,...data},update:{...data,version:{increment:1}}});
 return {auctionId:saved.auctionId,version:saved.version,imageId:saved.bannerImageId,path:saved.bannerImageId?`/api/media/${saved.bannerImageId}`:null,presentationMode:saved.presentationMode};
}
