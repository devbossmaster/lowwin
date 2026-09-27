import {db} from '@/lib/db';
import {requireAdmin,adminHeaders} from '@/modules/admin/boundary';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response(null,{status:404});
  const published=await db.productImage.findFirst({where:{path:`/api/media/${id}`,product:{visible:true,category:{visible:true},auctions:{some:{publishedAt:{not:null}}}}},select:{id:true}});
  if(!published)try{await requireAdmin(db,request.headers,{permission:'catalog'})}catch{return new Response(null,{status:404,headers:adminHeaders})}
  const media=await db.managedMedia.findUnique({where:{id}});if(!media)return new Response(null,{status:404});
  return new Response(media.bytes,{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Cache-Control':published?'public, max-age=31536000, immutable':adminHeaders['Cache-Control']}});
}
