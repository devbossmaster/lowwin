import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,smallJson,privateHeaders,privateError} from '@/modules/auth/private-api';
export const dynamic='force-dynamic';
const visibleToCustomer:Prisma.NotificationInboxWhereInput={NOT:{OR:[{kind:{startsWith:'DEPOSIT_'}},{kind:{startsWith:'TOPUP_'}}]}};
const promotionKinds=['BROADCAST','GLOBAL_CAMPAIGN'];
const categories=z.enum(['all','draws','payments','promotions']);
function categoryWhere(category:z.infer<typeof categories>):Prisma.NotificationInboxWhereInput{
  if(category==='draws')return {OR:[{kind:{startsWith:'AUCTION_'}},{kind:{in:['BID_ACCEPTED','FAVORITE_ENDING','FULFILLMENT_UPDATED']}}]};
  if(category==='payments')return {kind:{startsWith:'PAYMENT_'}};
  if(category==='promotions')return {kind:{in:promotionKinds}};
  return {};
}
export async function GET(request:Request){
  try{
    const userId=await requireUser(request),params=new URL(request.url).searchParams;
    if(params.get('summary')==='1')return Response.json({unread:await db.notificationInbox.count({where:{AND:[{userId,readAt:null},visibleToCustomer]}})},{headers:privateHeaders});
    const page=z.coerce.number().int().min(1).max(10000).parse(params.get('page')??1),category=categories.parse(params.get('category')??'all'),pageSize=params.get('preview')==='1'?8:20;
    const where:Prisma.NotificationInboxWhereInput={AND:[{userId},visibleToCustomer,categoryWhere(category)]};
    const [items,total,unread,promotions]=await Promise.all([
      db.notificationInbox.findMany({where,select:{id:true,kind:true,title:true,body:true,href:true,readAt:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],take:pageSize,skip:(page-1)*pageSize}),
      db.notificationInbox.count({where}),db.notificationInbox.count({where:{AND:[{userId,readAt:null},visibleToCustomer]}}),
      db.notificationInbox.findFirst({where:{userId,kind:{in:promotionKinds}},select:{id:true}}),
    ]);
    return Response.json({items:items.map(item=>({...item,href:item.href?.startsWith('/wallet')?'/payments':item.href})),total,page,totalPages:Math.ceil(total/pageSize),unread,categories:['all','draws','payments',...(promotions?['promotions']:[])]},{headers:privateHeaders});
  }catch(error){return privateError(error)}
}
export async function POST(request:Request){try{requireMutationOrigin(request);const userId=await requireUser(request),body=z.object({action:z.literal('read'),id:z.string().uuid().optional()}).strict().parse(await smallJson(request));await db.notificationInbox.updateMany({where:{userId,readAt:null,...(body.id?{id:body.id}:{})},data:{readAt:new Date()}});return Response.json({saved:true},{headers:privateHeaders})}catch(error){return privateError(error)}}
