import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';

export const winnerPhotoSchema=z.object({key:z.string().uuid(),auctionId:z.string().uuid(),version:z.number().int().min(0),imageId:z.string().uuid().nullable(),consentConfirmed:z.boolean().optional(),reason:z.string().trim().min(5).max(500)}).strict();
type Actor={id:string;role:StaffRole;now:Date};

/** Called only after opsMutation has authenticated staff and locked the auction.
 * Personal media never changes the winning bid, settlement, product or ledger. */
export async function saveWinnerPhoto(tx:Prisma.TransactionClient,actor:Actor,input:z.infer<typeof winnerPhotoSchema>){
 const auction=await tx.auction.findUnique({where:{id:input.auctionId},select:{status:true,isDemo:true,testRunId:true,publishedAt:true,settlement:{select:{outcome:true,winnerUserId:true,completedAt:true}}}});
 const settled=auction?.settlement;
 if(!auction?.publishedAt||auction.publishedAt>actor.now||auction.status!=='CLOSED'||auction.isDemo||auction.testRunId||settled?.outcome!=='WINNER'||!settled.winnerUserId||settled.completedAt>actor.now)throw new AdminError(409,'A genuine settled winner is required.');
 if(actor.role!=='OWNER'){
  const assigned=await tx.fulfillmentCase.findUnique({where:{auctionId:input.auctionId},select:{assignedTo:true}});
  if(assigned?.assignedTo!==actor.id)throw new AdminError(403,'You may update only your assigned winner announcements.');
 }
 const previous=await tx.winnerPresentation.findUnique({where:{auctionId:input.auctionId}});
 if((previous?.version??0)!==input.version)throw new AdminError(409,'Winner photo changed. Refresh before saving.');
 if(input.imageId){
  if(input.consentConfirmed!==true)throw new AdminError(422,'Confirm the winner consented to publication of this photo.');
  const media=await tx.managedMedia.findUnique({where:{id:input.imageId},select:{id:true,purpose:true}});
  if(media?.purpose!=='WINNER_PHOTO')throw new AdminError(422,'Upload a validated winner photograph first.');
 }
 const data={imageId:input.imageId,consentConfirmedAt:input.imageId?actor.now:null,consentActorId:input.imageId?actor.id:null};
 const saved=await tx.winnerPresentation.upsert({where:{auctionId:input.auctionId},create:{auctionId:input.auctionId,...data},update:{...data,version:{increment:1}}});
 return {auctionId:saved.auctionId,version:saved.version,imageId:saved.imageId,path:saved.imageId?`/api/media/${saved.imageId}`:null};
}
