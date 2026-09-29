import {z} from 'zod';
import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,smallJson,privateHeaders,privateError} from '@/modules/auth/private-api';
export const dynamic='force-dynamic';
async function preview(userId:string){
 const [items,unread]=await Promise.all([
  db.notificationInbox.findMany({where:{userId},select:{id:true,kind:true,title:true,body:true,href:true,readAt:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],take:8}),
  db.notificationInbox.count({where:{userId,readAt:null}}),
 ]);
 return Response.json({items,unread},{headers:privateHeaders});
}
export async function GET(request:Request){try{const userId=await requireUser(request),page=z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get('page')??1),where={userId};if(new URL(request.url).searchParams.get('preview')==='1')return await preview(userId);if(new URL(request.url).searchParams.get('summary')==='1')return Response.json({unread:await db.notificationInbox.count({where:{userId,readAt:null}})},{headers:privateHeaders});const [items,total,unread]=await Promise.all([db.notificationInbox.findMany({where,select:{id:true,kind:true,title:true,body:true,href:true,readAt:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],take:20,skip:(page-1)*20}),db.notificationInbox.count({where}),db.notificationInbox.count({where:{userId,readAt:null}})]);return Response.json({items,total,page,totalPages:Math.ceil(total/20),unread},{headers:privateHeaders})}catch(e){return privateError(e)}}
export async function POST(request:Request){try{requireMutationOrigin(request);const userId=await requireUser(request),body=z.object({action:z.literal('read'),id:z.string().uuid().optional()}).strict().parse(await smallJson(request));await db.notificationInbox.updateMany({where:{userId,readAt:null,...(body.id?{id:body.id}:{})},data:{readAt:new Date()}});return Response.json({saved:true},{headers:privateHeaders})}catch(e){return privateError(e)}}
