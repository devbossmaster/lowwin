import {db} from '@/lib/db';
import {requireAdmin,adminHeaders} from '@/modules/admin/boundary';
import {readPublishedMedia,storePublishedMedia} from '@/modules/media/published-cache';
import {publicWhere} from '@/modules/auctions/catalog';
import {assertPermission} from '@/modules/admin/permissions';
export const runtime='nodejs';
const publicHeaders={'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Cache-Control':'public, max-age=31536000, immutable'};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response(null,{status:404});
  // Only CATALOG uploads can acquire a ProductImage link or enter this cache.
  // ManagedMedia purpose is immutable; winner-only media never reaches this path.
  const cached=await readPublishedMedia(id);if(cached)return new Response(cached,{headers:publicHeaders});
  const published=await db.productImage.findFirst({where:{path:`/api/media/${id}`,product:{visible:true,category:{visible:true},auctions:{some:{publishedAt:{not:null}}}}},select:{id:true}});
  if(!published){
   const now=new Date();
   const winnerPhoto=await db.managedMedia.findFirst({where:{id,purpose:'WINNER_PHOTO',winnerPresentations:{some:{consentConfirmedAt:{lte:now},auction:{is:{AND:[publicWhere(now),{status:'CLOSED',isDemo:false,testRunId:null,settlement:{is:{outcome:'WINNER',winnerUserId:{not:null},completedAt:{lte:now},publication:{is:{publishedAt:{lte:now}}}}}}]}}}}},select:{bytes:true}});
   // Unlike a frozen product image, this consented announcement can be removed.
   // Recheck eligibility on every read and never store it in the immutable cache.
   if(winnerPhoto)return new Response(winnerPhoto.bytes,{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Cache-Control':'private, no-store, max-age=0','Vary':'Cookie'}});
  }
  let preview:Awaited<ReturnType<typeof requireAdmin>>|null=null;
  if(!published)try{preview=await requireAdmin(db,request.headers,{permission:'catalog'})}catch{return new Response(null,{status:404,headers:adminHeaders})}
  const media=await db.managedMedia.findUnique({where:{id}});if(!media)return new Response(null,{status:404});
  if(published&&media.purpose!=='CATALOG')return new Response(null,{status:404,headers:adminHeaders});
  if(!published&&media.purpose==='WINNER_PHOTO')try{if(preview?.role!=='OWNER')throw Error('Denied');assertPermission(preview.role,'fulfillment')}catch{return new Response(null,{status:404,headers:adminHeaders})}
  if(published)await storePublishedMedia(id,media.bytes);
  return new Response(media.bytes,{headers:published?publicHeaders:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Cache-Control':adminHeaders['Cache-Control']}});
}
