import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,smallJson,privateHeaders,privateError} from '@/modules/auth/private-api';
import {automaticNotificationKinds} from '@/modules/notifications/policy';
import {fallbackAmharicNotificationCopy} from '@/modules/notifications/amharic-copy';
export const dynamic='force-dynamic';
const visibleToCustomer:Prisma.NotificationInboxWhereInput={kind:{in:[...automaticNotificationKinds]}};
const categories=z.enum(['all','draws','payments','promotions']);
function categoryWhere(category:z.infer<typeof categories>):Prisma.NotificationInboxWhereInput{
  if(category==='draws')return {OR:[{kind:{startsWith:'AUCTION_'}},{kind:{in:['BID_ACCEPTED','WINNER_CONGRATULATIONS']}}]};
  if(category==='payments')return {kind:{in:['DEPOSIT_CREDITED','BID_ACCEPTED']}};
  if(category==='promotions')return {kind:{in:[]}};
  return {};
}
export async function GET(request:Request){
  try{
    const userId=await requireUser(request),params=new URL(request.url).searchParams;
    if(params.get('summary')==='1')return Response.json({unread:await db.notificationInbox.count({where:{AND:[{userId,readAt:null},visibleToCustomer]}})},{headers:privateHeaders});
    const page=z.coerce.number().int().min(1).max(10000).parse(params.get('page')??1),category=categories.parse(params.get('category')??'all'),pageSize=params.get('preview')==='1'?8:20;
    const where:Prisma.NotificationInboxWhereInput={AND:[{userId},visibleToCustomer,categoryWhere(category)]};
    const [items,total,unread]=await Promise.all([
      db.notificationInbox.findMany({where,select:{id:true,kind:true,title:true,body:true,href:true,readAt:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],take:pageSize,skip:(page-1)*pageSize}),
      db.notificationInbox.count({where}),db.notificationInbox.count({where:{AND:[{userId,readAt:null},visibleToCustomer]}}),
    ]);
    // Authored bilingual notices contain committed outcome/refund facts. Keep
    // those facts for the client language selector; fallback only legacy rows.
    const notices=items.map(item=>({
      ...item,
      // Older auction alerts store the timezone suffix as part of their body.
      body:item.kind.startsWith('AUCTION_')?item.body.replace(/(\d{2}:\d{2} \(አዲስ አበባ) · GMT\+3\)(?=\r?$)/gm,'$1)'):item.body,
      ...(!/[\u1200-\u137f]/.test(item.title)?fallbackAmharicNotificationCopy(item.kind):{}),
      href:item.href,
    }));
    return Response.json({items:notices,total,page,totalPages:Math.ceil(total/pageSize),unread,categories:['all','draws','payments']},{headers:privateHeaders});
  }catch(error){return privateError(error)}
}
export async function POST(request:Request){try{requireMutationOrigin(request);const userId=await requireUser(request),body=z.object({action:z.literal('read'),id:z.string().uuid().optional()}).strict().parse(await smallJson(request));await db.notificationInbox.updateMany({where:{userId,readAt:null,...(body.id?{id:body.id}:{})},data:{readAt:new Date()}});return Response.json({saved:true},{headers:privateHeaders})}catch(error){return privateError(error)}}
