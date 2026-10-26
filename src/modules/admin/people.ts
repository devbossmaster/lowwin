import {Prisma,type PrismaClient} from '@prisma/client';
import {contactBotId,decryptPhone,normalizePhone,phoneHash} from '../auth/own-contact';
import {deliveryQueue} from './workspace-read';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';

const identity={id:true,name:true,telegramId:true,telegramUsername:true,createdAt:true,
 ownContact:{select:{telegramId:true,botId:true,phoneCipher:true,revokedAt:true}}} satisfies Prisma.UserSelect;
const playerSelect={...identity,
 _count:{select:{bids:true,wonSettlements:true}}} satisfies Prisma.UserSelect;
type Identity=Prisma.UserGetPayload<{select:typeof identity}>;
function contact(user:Identity){
 let phone:string|null=null,phoneUnavailable=false;
 if(user.ownContact){
  try{if(!user.ownContact.revokedAt&&user.ownContact.telegramId===user.telegramId&&user.ownContact.botId===contactBotId())phone=decryptPhone(user.ownContact.phoneCipher,user.ownContact.botId)}catch{phoneUnavailable=true}
 }
 return {id:user.id,name:user.name,telegramId:user.telegramId,telegramUsername:user.telegramUsername,createdAt:user.createdAt,phone,phoneUnavailable};
}
/** Use only after the caller's staff authorization, and audit contact access. */
export async function adminPlayerContacts(client:PrismaClient,ids:string[]){
 const users=await client.user.findMany({where:{id:{in:[...new Set(ids)]}},select:identity});return users.map(contact);
}
export function playerSearch(q:string):Prisma.UserWhereInput{
 if(!q)return {};
 const OR:Prisma.UserWhereInput[]=[{id:{contains:q}},{name:{contains:q,mode:'insensitive'}},{telegramId:{contains:q}},{telegramUsername:{contains:q.replace(/^@/,''),mode:'insensitive'}}];
 let normalized:string|undefined;try{normalized=normalizePhone(q)}catch{}
 if(normalized){OR.push({ownContact:{is:{phoneHash:phoneHash(normalized),revokedAt:null}}})}
 return {OR};
}
export async function peopleRead(client:PrismaClient,actor:{id:string;role:StaffRole},path:string[],{page,q,status}:{page:number;q:string;status:string}){
 const section=path[0],take=25,skip=(page-1)*take;
 const result=(items:unknown,total:number)=>({items,total,page,totalPages:Math.ceil(total/take)});
 if(section==='users'){
  const where:Prisma.UserWhereInput={staffMember:{is:null},...(path[1]?{id:path[1]}:playerSearch(q))};
  const [users,total]=await Promise.all([client.user.findMany({where,select:playerSelect,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:path[1]?0:skip,take:path[1]?1:take}),client.user.count({where})]);
  if(path[1]&&!users.length)throw new AdminError(404,'Player not found.');
  const restrictions=await client.userRestriction.findMany({where:{userId:{in:users.map(u=>u.id)}},select:{userId:true,suspended:true,reason:true}});
  const items=users.map(u=>({...contact(u),bidCount:u._count.bids,winCount:u._count.wonSettlements,suspended:restrictions.find(r=>r.userId===u.id)?.suspended??false,...(path[1]?{restrictionReason:restrictions.find(r=>r.userId===u.id)?.reason??null}:{})}));
  if(users.length)await client.adminAudit.create({data:{actorId:actor.id,action:path[1]?'PLAYER_DETAILS_READ':'PLAYER_CONTACT_LIST_READ',target:path[1]??'players',details:{count:users.length}}});
  return path[1]?items[0]:result(items,total);
 }
 if(section!=='fulfillment')throw new AdminError(404,'People task not found.');
 const queue=await deliveryQueue(client,actor,{page,q,status});
 const settlements=await client.auctionSettlement.findMany({where:{auctionId:{in:queue.items.map(r=>r.auctionId)}},select:{auctionId:true,ruleVersion:true,winningPoints:true,winner:{select:identity},auction:{select:{publicCode:true,presentation:true}}}});
 const cases=await client.fulfillmentCase.findMany({where:{auctionId:{in:queue.items.map(r=>r.auctionId)}},select:{auctionId:true,deliveredAt:true}});
 const items=queue.items.map(row=>{const settled=settlements.find(s=>s.auctionId===row.auctionId),presentation=settled?.auction.presentation as {title?:string}|null;return {...row,title:presentation?.title??row.title,publicCode:settled?.auction.publicCode,winner:settled?.winner?contact(settled.winner):null,winningAmount:settled?.winningPoints?.toString()??null,ruleVersion:settled?.ruleVersion??null,deliveredAt:cases.find(c=>c.auctionId===row.auctionId)?.deliveredAt??null}});
 if(items.length)await client.adminAudit.create({data:{actorId:actor.id,action:'DELIVERY_CONTACT_LIST_READ',target:'deliveries',details:{count:items.length}}});
 return {...queue,items};
}
