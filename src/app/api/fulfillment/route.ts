import {z} from 'zod';
import {db} from '@/lib/db';
import {sealContact} from '@/modules/fulfillment/crypto';
import {enqueueAlert} from '@/modules/notifications/service';
import {requireUser,requireMutationOrigin,smallJson,privateHeaders,privateError,PrivateApiError} from '@/modules/auth/private-api';
export const dynamic='force-dynamic';
export async function GET(r:Request){try{const userId=await requireUser(r);return Response.json(await db.$queryRaw`SELECT f."auctionId",f.state,f.tracking,f.version,f."updatedAt" FROM "FulfillmentCase" f JOIN "AuctionSettlement" s ON s."auctionId"=f."auctionId" AND s."winnerUserId"=f."userId" JOIN "ResultPublication" rp ON rp."settlementId"=s.id WHERE f."userId"=${userId} AND s.outcome='WINNER' AND rp."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC' ORDER BY f."updatedAt" DESC,f."auctionId"`,{headers:privateHeaders})}catch(e){return privateError(e)}}
export async function POST(r:Request){try{requireMutationOrigin(r);const userId=await requireUser(r),body=z.object({auctionId:z.string().uuid(),action:z.enum(['claim','dispute']),name:z.string().trim().max(100).optional(),phone:z.string().trim().max(40).optional(),address:z.string().trim().max(500).optional(),reason:z.string().trim().max(500).optional()}).strict().parse(await smallJson(r));const result=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${body.auctionId} FOR UPDATE`;
 const s=await tx.auctionSettlement.findUnique({where:{auctionId:body.auctionId},include:{publication:{select:{publishedAt:true}}}});if(s?.outcome!=='WINNER'||s.winnerUserId!==userId||!s.publication||s.publication.publishedAt>new Date())throw new PrivateApiError(404,'Your published win was not found.');
 const old=await tx.fulfillmentCase.findUnique({where:{auctionId:body.auctionId}});
 if(body.action==='claim'&&old&&!['PENDING','CLAIMED'].includes(old.state))throw new PrivateApiError(409,'Contact changes require support after packing starts.');
 if(body.action==='claim'&&(!body.name||!body.phone||!body.address))throw new PrivateApiError(422,'Enter a recipient, delivery phone and address.');
 if(body.action==='dispute'&&(!old||!body.reason||body.reason.length<5))throw new PrivateApiError(422,'Provide a reason for this delivery dispute.');
 const data=body.action==='claim'?{state:'CLAIMED',contactCipher:sealContact(JSON.stringify({name:body.name,phone:body.phone,address:body.address}))}:{state:'DISPUTED',note:body.reason!,contactDeleteAt:null};
 const row=await tx.fulfillmentCase.upsert({where:{auctionId:body.auctionId},create:{auctionId:body.auctionId,userId,...data},update:{...data,version:{increment:1}}});
 await tx.adminAudit.create({data:{actorId:userId,action:body.action==='claim'?'WIN_CLAIMED':'DELIVERY_DISPUTED',target:body.auctionId,details:{}}});await enqueueAlert(tx,{key:`fulfillment:${row.auctionId}:${row.version}`,kind:'FULFILLMENT_UPDATED',auctionId:row.auctionId,userId});return {state:row.state,version:row.version};
 });return Response.json(result,{headers:privateHeaders})}catch(e){return privateError(e)}}
