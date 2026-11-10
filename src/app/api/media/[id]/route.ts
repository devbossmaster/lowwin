import {db} from '@/lib/db';
import {requireAdmin,adminHeaders} from '@/modules/admin/boundary';
import {readPublishedMedia,storePublishedMedia} from '@/modules/media/published-cache';
import {publicWhere} from '@/modules/auctions/catalog';
import {assertPermission} from '@/modules/admin/permissions';
import {MEDIA_RENDITION_VERSION,isMediaRendition,type MediaRendition} from '@/lib/media-renditions';
import {createMediaRendition} from '@/modules/media/renditions';
export const runtime='nodejs';
const publicHeaders={'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Cache-Control':'public, max-age=31536000, immutable'};
const pending=new Map<string,Promise<Buffer>>();
async function publishedRendition(id:string,bytes:Uint8Array,rendition:MediaRendition){
 const key=`${id}:${rendition}`,previous=pending.get(key);if(previous)return previous;
 const result=(async()=>{const output=await createMediaRendition(bytes,rendition);await storePublishedMedia(id,output,rendition);return output})();
 pending.set(key,result);try{return await result}finally{pending.delete(key)}
}
function publicResponse(request:Request,id:string,bytes:Uint8Array,rendition?:MediaRendition){
 const etag=`"${id}-${rendition?`v${MEDIA_RENDITION_VERSION}-${rendition}`:'original'}"`;
 const headers={...publicHeaders,'Content-Type':rendition?'image/webp':'image/png','ETag':etag};
 if(request.headers.get('if-none-match')?.split(',').some(value=>value.trim()===etag||value.trim()===`W/${etag}`||value.trim()==='*'))return new Response(null,{status:304,headers});
 return new Response(Uint8Array.from(bytes),{headers:{...headers,'Content-Length':String(bytes.byteLength)}});
}
async function privateResponse(bytes:Uint8Array,mime:string,rendition?:MediaRendition){
 const output=rendition?await createMediaRendition(bytes,rendition):bytes;
 return new Response(Uint8Array.from(output),{headers:{'Content-Type':rendition?'image/webp':mime,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline',...adminHeaders}});
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response(null,{status:404});
  const query=new URL(request.url).searchParams,value=query.get('rendition');
  if([...query.keys()].some(key=>!['v','rendition'].includes(key))||query.getAll('v').length>1||query.getAll('rendition').length>1)return new Response(null,{status:400,headers:adminHeaders});
  if((value!==null&&(!isMediaRendition(value)||query.get('v')!==MEDIA_RENDITION_VERSION))||(value===null&&query.has('v')))return new Response(null,{status:400,headers:adminHeaders});
  const rendition=value&&isMediaRendition(value)?value:undefined;
  // Only CATALOG uploads can acquire a ProductImage link or enter this cache.
  // ManagedMedia purpose is immutable; winner-only media never reaches this path.
  const cached=rendition?await readPublishedMedia(id,rendition):await readPublishedMedia(id);if(cached)return publicResponse(request,id,cached,rendition);
  // Keep the existing frozen-original cache useful after an upgrade and during a
  // database outage; write each versioned derivative beside it, never over it.
  if(rendition){const original=await readPublishedMedia(id);if(original)return publicResponse(request,id,await publishedRendition(id,original,rendition),rendition)}
  const published=await db.productImage.findFirst({where:{path:`/api/media/${id}`,product:{visible:true,category:{visible:true},auctions:{some:{publishedAt:{not:null}}}}},select:{id:true}});
  if(!published){
   const now=new Date();
   const eligibleAuction={is:{AND:[publicWhere(now),{status:'CLOSED',isDemo:false,testRunId:null,settlement:{is:{outcome:'WINNER',winnerUserId:{not:null},completedAt:{lte:now},publication:{is:{publishedAt:{lte:now}}}}}}]}};
   const winnerMedia=await db.managedMedia.findFirst({where:{id,OR:[{purpose:'WINNER_PHOTO',winnerPresentations:{some:{presentationMode:'PHOTO',consentConfirmedAt:{lte:now},auction:eligibleAuction}}},{purpose:'WINNER_BANNER',winnerBannerPresentations:{some:{presentationMode:'BANNER',bannerConsentConfirmedAt:{lte:now},auction:eligibleAuction}}}]},select:{bytes:true,mime:true}});
   // Unlike a frozen product image, this consented announcement can be removed.
   // Recheck eligibility on every read and never store it in the immutable cache.
   if(winnerMedia)return privateResponse(winnerMedia.bytes,winnerMedia.mime,rendition);
  }
  let preview:Awaited<ReturnType<typeof requireAdmin>>|null=null;
  if(!published)try{preview=await requireAdmin(db,request.headers,{permission:'catalog'})}catch{return new Response(null,{status:404,headers:adminHeaders})}
  const media=await db.managedMedia.findUnique({where:{id}});if(!media)return new Response(null,{status:404});
  if(published&&media.purpose!=='CATALOG')return new Response(null,{status:404,headers:adminHeaders});
  if(!published&&['WINNER_PHOTO','WINNER_BANNER'].includes(media.purpose))try{if(preview?.role!=='OWNER')throw Error('Denied');assertPermission(preview.role,'fulfillment')}catch{return new Response(null,{status:404,headers:adminHeaders})}
  if(published)await storePublishedMedia(id,media.bytes);
  if(published)return publicResponse(request,id,rendition?await publishedRendition(id,media.bytes,rendition):media.bytes,rendition);
  return privateResponse(media.bytes,media.mime??'image/png',rendition);
}
