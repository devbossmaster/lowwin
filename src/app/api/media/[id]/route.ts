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
const winnerRenditions=new Map<string,Buffer>();
const winnerCacheMaxEntries=16,winnerCacheMaxImageBytes=512*1024;

async function renditionOnce(key:string,encode:()=>Promise<Buffer>){
 const previous=pending.get(key);if(previous)return previous;
 const result=encode();
 pending.set(key,result);try{return await result}finally{pending.delete(key)}
}
function publishedRendition(id:string,bytes:Uint8Array,rendition:MediaRendition){
 return renditionOnce(`catalog:${id}:${rendition}`,async()=>{
  const output=await createMediaRendition(bytes,rendition);
  await storePublishedMedia(id,output,rendition);
  return output;
 });
}
function publicResponse(request:Request,id:string,bytes:Uint8Array,rendition?:MediaRendition){
 const etag=`"${id}-${rendition?`v${MEDIA_RENDITION_VERSION}-${rendition}`:'original'}"`;
 const headers={...publicHeaders,'Content-Type':rendition?'image/webp':'image/png','ETag':etag};
 if(request.headers.get('if-none-match')?.split(',').some(value=>value.trim()===etag||value.trim()===`W/${etag}`||value.trim()==='*'))return new Response(null,{status:304,headers});
 return new Response(Uint8Array.from(bytes),{headers:{...headers,'Content-Length':String(bytes.byteLength)}});
}
function privateResponse(bytes:Uint8Array,mime:string){
 return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline',...adminHeaders}});
}
async function readWinnerImage(id:string,now:Date,rendition?:MediaRendition){
 const eligibleAuction={is:{AND:[publicWhere(now),{status:'CLOSED' as const,isDemo:false,testRunId:null,settlement:{is:{outcome:'WINNER' as const,winnerUserId:{not:null},completedAt:{lte:now},publication:{is:{publishedAt:{lte:now}}}}}}]}};
 const where={id,OR:[
  {purpose:'WINNER_PHOTO' as const,winnerPresentations:{some:{presentationMode:'PHOTO' as const,consentConfirmedAt:{lte:now},auction:eligibleAuction}}},
  {purpose:'WINNER_BANNER' as const,winnerBannerPresentations:{some:{presentationMode:'BANNER' as const,bannerConsentConfirmedAt:{lte:now},auction:eligibleAuction}}},
 ]};
 const key=`winner:${id}:${rendition??'original'}`,cached=winnerRenditions.get(key);
 // Derivatives reuse encoded bytes in process only. Every response still requires
 // current publication and consent. Never use the public disk or HTTP cache.
 if(cached){
  if(await db.managedMedia.findFirst({where,select:{id:true}}))return privateResponse(cached,'image/webp');
  winnerRenditions.delete(key);
  return null;
 }
 const winnerMedia=await db.managedMedia.findFirst({where,select:{bytes:true,mime:true}});
 if(!winnerMedia)return null;
 if(!rendition)return privateResponse(winnerMedia.bytes,winnerMedia.mime);
 const output=await renditionOnce(key,async()=>{
  const encoded=await createMediaRendition(winnerMedia.bytes,rendition);
  if(encoded.byteLength<=winnerCacheMaxImageBytes){
   if(winnerRenditions.size>=winnerCacheMaxEntries)winnerRenditions.delete(winnerRenditions.keys().next().value!);
   winnerRenditions.set(key,encoded);
  }
  return encoded;
 });
 return privateResponse(output,'image/webp');
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response(null,{status:404});
  const query=new URL(request.url).searchParams,value=query.get('rendition'),scope=query.get('scope'),keys=[...query.keys()];
  if(keys.some(key=>!['v','rendition','scope'].includes(key))||keys.length!==new Set(keys).size)return new Response(null,{status:400,headers:adminHeaders});
  if((value!==null&&(!isMediaRendition(value)||query.get('v')!==MEDIA_RENDITION_VERSION))||(value===null&&query.has('v')))return new Response(null,{status:400,headers:adminHeaders});
  const rendition=value&&isMediaRendition(value)?value:undefined;
  if(scope!==null){
   if(scope!=='winner'||!rendition)return new Response(null,{status:400,headers:adminHeaders});
   return await readWinnerImage(id,new Date(),rendition)??new Response(null,{status:404,headers:adminHeaders});
  }
  // Only CATALOG uploads can acquire a ProductImage link or enter this cache.
  // ManagedMedia purpose is immutable; winner-only media never reaches this path.
  const cached=rendition?await readPublishedMedia(id,rendition):await readPublishedMedia(id);if(cached)return publicResponse(request,id,cached,rendition);
  // Keep the existing frozen-original cache useful after an upgrade and during a
  // database outage; write each versioned derivative beside it, never over it.
  if(rendition){const original=await readPublishedMedia(id);if(original)return publicResponse(request,id,await publishedRendition(id,original,rendition),rendition)}
  const mediaPath=`/api/media/${id}`,now=new Date();
  // Live public corrections update the auction snapshot, not frozen inventory.
  // Those CATALOG images need the same published delivery as product photos.
  const published=await db.productImage.findFirst({where:{path:mediaPath,product:{visible:true,category:{visible:true},auctions:{some:{publishedAt:{not:null}}}}},select:{id:true}})
   ??await db.auction.findFirst({where:{AND:[publicWhere(now),{presentation:{path:['images'],array_contains:[{path:mediaPath}]}}]},select:{id:true}});
  if(!published){const winner=await readWinnerImage(id,now,rendition);if(winner)return winner}
  let preview:Awaited<ReturnType<typeof requireAdmin>>|null=null;
  if(!published)try{preview=await requireAdmin(db,request.headers,{permission:'catalog'})}catch{return new Response(null,{status:404,headers:adminHeaders})}
  const media=await db.managedMedia.findUnique({where:{id}});if(!media)return new Response(null,{status:404});
  if(published&&media.purpose!=='CATALOG')return new Response(null,{status:404,headers:adminHeaders});
  if(!published&&['WINNER_PHOTO','WINNER_BANNER'].includes(media.purpose))try{if(preview?.role!=='OWNER')throw Error('Denied');assertPermission(preview.role,'fulfillment')}catch{return new Response(null,{status:404,headers:adminHeaders})}
  if(published)await storePublishedMedia(id,media.bytes);
  if(published)return publicResponse(request,id,rendition?await publishedRendition(id,media.bytes,rendition):media.bytes,rendition);
  return rendition?privateResponse(await createMediaRendition(media.bytes,rendition),'image/webp'):privateResponse(media.bytes,media.mime??'image/png');
}
