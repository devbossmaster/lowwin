import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from './boundary';
import {permissions,staffRoles,type Permission} from './permissions';
import {AdminError} from './errors';
import {digest,token} from './crypto';
import {openContact} from '../fulfillment/crypto';
import {emailAdapter} from './email';
import {enqueueAlert} from '../notifications/service';
import {reconcile} from '../wallet/ledger';
const key=z.string().uuid(),reason=z.string().trim().min(5).max(500),uid=z.string().min(1).max(128);
const schemas={
 invite:z.object({key,email:z.email().max(254).transform(s=>s.toLowerCase()),role:z.enum(staffRoles),reason}).strict(),
 staff:z.object({key,userId:uid,role:z.enum(staffRoles),active:z.boolean(),reason}).strict(),
 suspend:z.object({key,userId:uid,suspended:z.boolean(),reason}).strict(),
 support:z.object({key,id:z.string().uuid(),status:z.enum(['OPEN','INVESTIGATING','RESOLVED']),reason}).strict(),
 fulfillment:z.object({key,auctionId:z.string().uuid(),version:z.number().int().min(0),state:z.enum(['PENDING','CLAIMED','PACKING','SHIPPED','DELIVERED','DISPUTED']),tracking:z.string().trim().max(160),reason,assignedTo:uid.nullable().optional()}).strict(),
 retry:z.object({key,id:z.string().uuid(),reason}).strict(),
};
export type OpsAction=keyof typeof schemas;
const commandPermission:Record<OpsAction,Permission>={invite:'team',staff:'team',suspend:'support',support:'support',fulfillment:'fulfillment',retry:'jobs'};
export const sectionPermission:Record<string,Permission>={users:'support',support:'support',results:'audit',fulfillment:'fulfillment',wallets:'wallets',notifications:'jobs',jobs:'jobs',analytics:'audit',audit:'audit',team:'team',settings:'settings'};
export const serialize=(v:unknown)=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
export function pageInput(params:URLSearchParams){return z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:z.string().trim().max(100).default(''),status:z.string().max(40).default('')}).parse(Object.fromEntries(params))}
export async function opsMutation(client:PrismaClient,headers:Headers,action:OpsAction,raw:unknown){
 if(!Object.hasOwn(schemas,action))throw new AdminError(404,'Unknown staff command.');
 const input=schemas[action].parse(raw),actor=await requireAdmin(client,headers,{permission:commandPermission[action]}),hash=digest(JSON.stringify({action,input}));
 return client.$transaction(async tx=>{
  // Auction -> wallet (for bidding policy) -> staff. Team lock serializes grants.
  if(action==='fulfillment')await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${schemas.fulfillment.parse(input).auctionId} FOR UPDATE`;
  if(action==='invite'||action==='staff')await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:team',0))`;
  if('userId' in input)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${input.userId}`},0))`;
  const owner=await requireAdmin(tx,headers,{permission:commandPermission[action],lock:true,fresh:action==='invite'||action==='staff'});
  const operationKey=`${actor.id}:${input.key}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`admin:${operationKey}`},0))`;
  const old=await tx.adminAudit.findUnique({where:{operationKey}});if(old){if(old.requestHash!==hash)throw new AdminError(409,'Idempotency key changed.');return (old.details as {receipt:unknown}).receipt}
  let receipt:Record<string,unknown>={},target='';
  if(action==='invite'){
   const d=schemas.invite.parse(input);if(await tx.user.findUnique({where:{email:d.email}}))throw new AdminError(409,'Use a separate staff identity.');
   const mail=emailAdapter(),invitation=token();await tx.staffToken.updateMany({where:{email:d.email,kind:'INVITE',usedAt:null},data:{usedAt:owner.now}});
   await tx.staffToken.create({data:{tokenHash:digest(invitation),kind:'INVITE',email:d.email,role:d.role,expiresAt:new Date(owner.now.getTime()+86400000)}});
   const link=new URL('/admin/login',process.env.BETTER_AUTH_URL);link.hash=new URLSearchParams({invite:invitation}).toString();
   await mail.send({to:d.email,subject:'Your Lowin staff invitation',text:`Accept within 24 hours: ${link}\nYour role is ${d.role}. Authenticator enrollment is required.`});receipt={invited:true,role:d.role};target='staff-invitation';
  }else if(action==='staff'){
   const d=schemas.staff.parse(input);if(d.userId===owner.id)throw new AdminError(403,'You cannot change your own grants.');
   const member=await tx.staffMember.findUniqueOrThrow({where:{userId:d.userId}});
   if(member.role==='OWNER'&&member.active&&(!d.active||d.role!=='OWNER')&&await tx.staffMember.count({where:{role:'OWNER',active:true}})<=1)throw new AdminError(409,'The last active Owner must remain.');
   await tx.staffMember.update({where:{userId:d.userId},data:{role:d.role,active:d.active}});await tx.session.deleteMany({where:{userId:d.userId}});receipt={userId:d.userId,role:d.role,active:d.active,sessionsRevoked:true};target=d.userId;
  }else if(action==='suspend'){
   const d=schemas.suspend.parse(input);if(await tx.staffMember.findUnique({where:{userId:d.userId}}))throw new AdminError(409,'Manage staff access through Team.');
   if(owner.role!=='OWNER'){const proposal=await tx.supportCase.create({data:{userId:d.userId,subject:d.suspended?'Suspension proposal':'Restore bidding proposal',message:d.reason}});receipt={userId:d.userId,proposed:true,caseId:proposal.id}}else{await tx.userRestriction.upsert({where:{userId:d.userId},create:{userId:d.userId,suspended:d.suspended,reason:d.reason},update:{suspended:d.suspended,reason:d.reason}});receipt={userId:d.userId,suspended:d.suspended}}target=d.userId;
  }else if(action==='support'){
   const d=schemas.support.parse(input);await tx.supportCase.update({where:{id:d.id},data:{status:d.status,resolution:d.reason}});receipt={id:d.id,status:d.status};target=d.id;
  }else if(action==='fulfillment'){
   const d=schemas.fulfillment.parse(input),settled=await tx.auctionSettlement.findUnique({where:{auctionId:d.auctionId}});
   if(settled?.outcome!=='WINNER'||!settled.winnerUserId)throw new AdminError(409,'A settled winner is required.');
   const previous=await tx.fulfillmentCase.findUnique({where:{auctionId:d.auctionId}});
   if(owner.role!=='OWNER'&&(previous?.assignedTo!==owner.id||d.assignedTo!==undefined))throw new AdminError(403,'Only the Owner assigns cases; you may work only on your assignments.');
   if((previous?.version??0)!==d.version)throw new AdminError(409,'Fulfillment changed. Reload.');
   if(d.assignedTo){const staff=await tx.staffMember.findUnique({where:{userId:d.assignedTo}});if(!staff?.active||!permissions(staff.role).includes('fulfillment'))throw new AdminError(422,'Choose an active fulfillment staff member.');}
   const state=previous?.state??'PENDING',transitions:Record<string,string[]>={PENDING:['PENDING'],CLAIMED:['CLAIMED','PACKING','DISPUTED'],PACKING:['PACKING','SHIPPED','DISPUTED'],SHIPPED:['SHIPPED','DELIVERED','DISPUTED'],DELIVERED:['DELIVERED','DISPUTED'],DISPUTED:['DISPUTED','CLAIMED','PACKING','SHIPPED','DELIVERED']};
   if(!transitions[state].includes(d.state))throw new AdminError(409,'The winner must claim before packing; confirm each delivery step.');
   if(d.state==='SHIPPED'&&!d.tracking)throw new AdminError(422,'Record a shipment reference.');
   const data={state:d.state,tracking:d.tracking,note:d.reason,...(d.assignedTo!==undefined?{assignedTo:d.assignedTo}:{}),...(d.state==='DELIVERED'?{deliveredAt:owner.now,contactDeleteAt:new Date(owner.now.getTime()+30*86400000)}:{})};
   const row=await tx.fulfillmentCase.upsert({where:{auctionId:d.auctionId},create:{auctionId:d.auctionId,userId:settled.winnerUserId,...data},update:{...data,version:{increment:1}}});
   await enqueueAlert(tx,{key:`fulfillment:${row.auctionId}:${row.version}`,kind:'FULFILLMENT_UPDATED',auctionId:row.auctionId,userId:row.userId});receipt={auctionId:row.auctionId,state:row.state,version:row.version};target=row.auctionId;
  }else if(action==='retry'){
   const d=schemas.retry.parse(input);await tx.$queryRaw`SELECT id FROM "Outbox" WHERE id=${d.id} FOR UPDATE`;
   const row=await tx.outbox.findUniqueOrThrow({where:{id:d.id}});if(row.state!=='FAILED')throw new AdminError(409,'Only terminal failed delivery can be retried.');
   if(row.lastError==='CHAT_BLOCKED'){const user=await tx.user.findUnique({where:{id:(row.payload as {recipientUserId:string}).recipientUserId},select:{telegramId:true}});const chat=user?.telegramId?await tx.botChat.findUnique({where:{telegramId:user.telegramId}}):null;if(!chat||chat.blocked)throw new AdminError(409,'The user must restart the private bot chat first.');}
   await tx.outbox.update({where:{id:d.id},data:{state:'PENDING',attempts:0,nextAttemptAt:owner.now,lastError:null}});receipt={id:d.id,state:'PENDING'};target=d.id;
  }
  await tx.adminAudit.create({data:{actorId:owner.id,action:`OPS_${action.toUpperCase()}`,target,operationKey,requestHash:hash,details:{sessionId:owner.sessionId,reason:input.reason,receipt:serialize(receipt)}}});return receipt;
 },{timeout:30000,maxWait:10000});
}
export async function opsRead(client:PrismaClient,headers:Headers,path:string[],params:URLSearchParams){
 const section=path[0],permission=sectionPermission[section];if(!permission)throw new AdminError(404,'Admin resource not found.');
 const actor=await requireAdmin(client,headers,{permission}),{page,q,status}=pageInput(params),take=25,skip=(page-1)*take;
 const result=(items:unknown,total:number)=>serialize({items,total,page,totalPages:Math.ceil(total/take)});
 if(section==='team'){const where:Prisma.StaffMemberWhereInput=q?{user:{email:{contains:q,mode:'insensitive'}}}:{};return result(await client.staffMember.findMany({where,select:{userId:true,role:true,active:true,createdAt:true,user:{select:{email:true}}},orderBy:{userId:'asc'},skip,take}),await client.staffMember.count({where}))}
 if(section==='users'){const where:Prisma.UserWhereInput={staffMember:{is:null},...(q?{OR:[{id:{contains:q}},{name:{contains:q,mode:'insensitive'}}]}:{})};const rows=await client.user.findMany({where,select:{id:true,name:true,createdAt:true},orderBy:{id:'asc'},skip,take}),restrictions=await client.userRestriction.findMany({where:{userId:{in:rows.map(x=>x.id)}}});return result(rows.map(r=>({...r,suspended:restrictions.find(s=>s.userId===r.id)?.suspended??false})),await client.user.count({where}))}
 if(section==='support'){const where={...(status?{status}:{}),...(q?{subject:{contains:q,mode:'insensitive' as const}}:{})};return result(await client.supportCase.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take}),await client.supportCase.count({where}))}
 if(section==='results'){const where:Prisma.AuctionSettlementWhereInput={...(status?{outcome:status}:{}),...(q?{auction:{code:{contains:q,mode:'insensitive'}}}:{})};return result(await client.auctionSettlement.findMany({where,select:{auctionId:true,outcome:true,completedAt:true,winningPoints:true,auction:{select:{code:true,isDemo:true}}},orderBy:[{completedAt:'desc'},{id:'asc'}],skip,take}),await client.auctionSettlement.count({where}))}
 if(section==='fulfillment'){
  if(path[1]){const row=await client.fulfillmentCase.findUnique({where:{auctionId:path[1]}});if(!row||actor.role!=='OWNER'&&row.assignedTo!==actor.id)throw new AdminError(404,'Assigned fulfillment not found.');const {contactCipher,...safe}=row;await client.adminAudit.create({data:{actorId:actor.id,action:'FULFILLMENT_CONTACT_READ',target:row.auctionId,details:{}}});return {...safe,contact:contactCipher?JSON.parse(openContact(contactCipher)):null}}
  const where:Prisma.AuctionSettlementWhereInput={outcome:'WINNER',...(q?{auction:{code:{contains:q,mode:'insensitive'}}}:{}),...(actor.role!=='OWNER'?{auctionId:{in:(await client.fulfillmentCase.findMany({where:{assignedTo:actor.id},select:{auctionId:true}})).map(f=>f.auctionId)}}:{})};
  const rows=await client.auctionSettlement.findMany({where,select:{auctionId:true,completedAt:true,auction:{select:{code:true,isDemo:true,product:{select:{title:true}}}}},orderBy:[{completedAt:'desc'},{id:'asc'}],skip,take}),f=await client.fulfillmentCase.findMany({where:{auctionId:{in:rows.map(r=>r.auctionId)}},select:{auctionId:true,assignedTo:true,state:true,tracking:true,version:true}});return result(rows.map(r=>({...r,...(f.find(x=>x.auctionId===r.auctionId)??{state:'PENDING',version:0})})),await client.auctionSettlement.count({where}));
 }
 if(section==='wallets'){
  if(path[1]==='operations'&&path[2]){const op=await client.operation.findUniqueOrThrow({where:{id:path[2]},select:{id:true,scope:true,createdAt:true,journal:{select:{id:true,kind:true,createdAt:true,postings:{select:{accountId:true,delta:true}}}}}});return serialize(op)}
  if(path[1]){const wallet=await client.wallet.findUniqueOrThrow({where:{id:path[1]},select:{id:true,userId:true,accounts:{select:{id:true,kind:true,balance:true}},holds:{select:{auctionId:true,points:true}}}});const where={userId:wallet.userId};return serialize({...wallet,operations:await client.operation.findMany({where,select:{id:true,scope:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take}),total:await client.operation.count({where}),page})}
  const where=q?{userId:{contains:q}}:{};return result(await client.wallet.findMany({where,select:{id:true,userId:true,accounts:{select:{kind:true,balance:true}},holds:{select:{points:true}}},orderBy:{id:'asc'},skip,take}),await client.wallet.count({where}));
 }
 if(section==='jobs'||section==='notifications'){const where:Prisma.OutboxWhereInput={...(status?{state:status}:{}),...(q?{kind:{contains:q,mode:'insensitive'}}:{})};return result(await client.outbox.findMany({where,select:{id:true,kind:true,state:true,attempts:true,nextAttemptAt:true,lastError:true,createdAt:true,sentAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take}),await client.outbox.count({where}))}
 if(section==='audit'){const where:Prisma.AdminAuditWhereInput={...(q?{action:{contains:q,mode:'insensitive'}}:{})};return result(await client.adminAudit.findMany({where,select:{id:true,actorId:true,action:true,target:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take}),await client.adminAudit.count({where}))}
 if(section==='analytics'){const from=params.get('from'),to=params.get('to');const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);const range={...(from?{gte:new Date(date.parse(from))}:{}),...(to?{lt:new Date(new Date(date.parse(to)).getTime()+86400000)}:{})};if(from&&to&&from>to)throw new AdminError(422,'Start date must precede end date.');return serialize({outcomes:await client.auctionSettlement.groupBy({by:['outcome'],where:{completedAt:range},_count:{id:true}}),participants:await client.bid.groupBy({by:['userId'],where:{acceptedAt:range},_count:{id:true}}).then(x=>x.length),points:await client.ledgerAccount.groupBy({by:['kind'],_sum:{balance:true}}),delivery:await client.outbox.groupBy({by:['state'],where:{createdAt:range},_count:{id:true}}),reconciliation:await reconcile(client)})}
 if(section==='settings'){let email='Unavailable — configure a production provider';try{emailAdapter();email='Local test sink only'}catch{}return {email,payments:'Unavailable until Phase 6',contactRetention:'Encrypted delivery contact is deleted 30 days after delivery. Resolve disputes before resuming deletion.',securityReview:'Independent staff-auth security review remains a release check.'}}
 throw new AdminError(404,'Admin resource not found.');
}
