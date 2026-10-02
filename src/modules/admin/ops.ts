import {peopleRead} from './people';
import {broadcastHistory,stopBroadcast} from './broadcast-history';
import {deliveryQueue} from './workspace-read';
import {paymentHealth} from '../payments/service';
import {queueGlobal} from '../notifications/campaigns';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from './boundary';
import {permissions,staffRoles,type Permission} from './permissions';
import {AdminError} from './errors';
import {digest,token} from './crypto';
import {openContact} from '../fulfillment/crypto';
import {emailAdapter} from './email';
import {enqueueAlert} from '../notifications/service';
import {randomUUID} from 'node:crypto';
import {demoBidAllowed,submitBidInTransaction} from '../auctions/bids';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import {closeAuctionInTransaction} from '../auctions/settlement';
import {creditTestRunPoints} from '../wallet/ledger';
import {RULE_V3,V2_MIN_PARTICIPANTS,V2_FALLBACK_TERMS,V2_CANCELLATION_TERMS,V3_AMOUNT_TERMS} from '../auctions/rules';

const key=z.string().uuid(),reason=z.string().trim().min(5).max(500),uid=z.string().min(1).max(128);
const schemas={
 broadcast:z.object({key,reason,text:z.string().trim().min(1).max(700),auctionCode:z.string().regex(/^[1-9]\d{0,8}$/).optional(),imageId:z.string().uuid().optional(),confirmation:z.literal('SEND')}).strict(),
 invite:z.object({key,email:z.email().max(254).transform(s=>s.toLowerCase()),role:z.enum(staffRoles),reason}).strict(),
 staff:z.object({key,userId:uid,role:z.enum(staffRoles),active:z.boolean(),reason}).strict(),
 suspend:z.object({key,userId:uid,suspended:z.boolean(),reason}).strict(),
 support:z.object({key,id:z.string().uuid(),status:z.enum(['OPEN','INVESTIGATING','RESOLVED']),reason,expectedUpdatedAt:z.iso.datetime().optional()}).strict(),
 supportWithdraw:z.object({key,id:z.string().uuid(),expectedUpdatedAt:z.iso.datetime(),reason}).strict(),
 deliveryDone:z.object({key,auctionId:z.string().uuid(),version:z.number().int().min(0),reason}).strict(),
 broadcastStop:z.object({key,id:z.string().uuid(),reason}).strict(),
 fulfillment:z.object({key,auctionId:z.string().uuid(),version:z.number().int().min(0),state:z.enum(['PENDING','CLAIMED','PACKING','SHIPPED','DELIVERED','DISPUTED']),tracking:z.string().trim().max(160),reason,assignedTo:uid.nullable().optional()}).strict(),
 retry:z.object({key,id:z.string().uuid(),reason}).strict(),
 testStart:z.object({key,label:z.string().trim().min(3).max(80),reason}).strict(),
 testFinish:z.object({key,id:z.string().uuid(),reason}).strict(),
 testClean:z.object({key,id:z.string().uuid(),confirmation:z.literal('CLEAN TEST RUN'),reason}).strict(),
};
export type OpsAction=keyof typeof schemas;
const commandPermission:Record<OpsAction,Permission>={supportWithdraw:'support',deliveryDone:'fulfillment',broadcastStop:'jobs',broadcast:'jobs',invite:'team',staff:'team',suspend:'support',support:'support',fulfillment:'fulfillment',retry:'jobs',testStart:'settings',testFinish:'settings',testClean:'settings'};
export const sectionPermission:Record<string,Permission>={users:'support',support:'support',results:'audit',fulfillment:'fulfillment',wallets:'wallets',notifications:'jobs',jobs:'jobs',analytics:'audit',audit:'audit',team:'team',settings:'settings'};
export const serialize=(v:unknown)=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
export function pageInput(params:URLSearchParams){return z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:z.string().trim().max(100).default(''),status:z.string().max(40).default(''),category:z.union([z.literal(''),z.string().uuid()]).default('')}).parse(Object.fromEntries(params))}
export async function opsMutation(client:PrismaClient,headers:Headers,action:OpsAction,raw:unknown){
 if(!Object.hasOwn(schemas,action))throw new AdminError(404,'Unknown staff command.');
 const input=schemas[action].parse(raw),actor=await requireAdmin(client,headers,{permission:commandPermission[action]}),hash=digest(JSON.stringify({action,input}));
 return client.$transaction(async tx=>{
  // Auction -> wallet (for bidding policy) -> staff. Team lock serializes grants.
  if(action==='fulfillment'||action==='deliveryDone')await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${(input as {auctionId:string}).auctionId} FOR UPDATE`;
  if(action==='invite'||action==='staff')await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:team',0))`;
  if('userId' in input)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${input.userId}`},0))`;
  const owner=await requireAdmin(tx,headers,{permission:commandPermission[action],lock:true,fresh:action==='invite'||action==='staff'||action==='broadcast'||action==='broadcastStop'||action.startsWith('test')});
  const operationKey=`${actor.id}:${input.key}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`admin:${operationKey}`},0))`;
  const old=await tx.adminAudit.findUnique({where:{operationKey}});if(old){if(old.requestHash!==hash)throw new AdminError(409,'Idempotency key changed.');return (old.details as {receipt:unknown}).receipt}
  let receipt:Record<string,unknown>={},target='';
  if(action==='broadcast'){
   const d=schemas.broadcast.parse(input);if(owner.role!=='OWNER')throw new AdminError(403,'Only the Owner can broadcast.');
   let href='/auctions/all';
   if(d.auctionCode){const a=await tx.auction.findUnique({where:{publicCode:Number(d.auctionCode)},select:{slug:true,publishedAt:true,status:true,endsAt:true,isDemo:true}});if(!a?.slug||!a.publishedAt||!['LIVE','SCHEDULED'].includes(a.status)||!a.endsAt||a.endsAt<=owner.now||a.isDemo&&process.env.APP_ENV==='production')throw new AdminError(422,'Choose a published active auction code.');href=`/auctions/${d.auctionCode}`}
   if(d.imageId&&!await tx.managedMedia.findUnique({where:{id:d.imageId},select:{id:true}}))throw new AdminError(422,'Upload a validated image first.');
   const audience=await tx.user.count({where:{telegramId:{not:null},staffMember:{is:null}}});
   const job=await queueGlobal(tx,`broadcast:${owner.id}:${d.key}`,'BROADCAST',{body:d.text,href,...(d.imageId?{imageId:d.imageId}:{})});
   receipt={id:job.id,audience,state:'PENDING'};target=job.id;
  }else if(action==='broadcastStop'){
   const d=schemas.broadcastStop.parse(input);if(owner.role!=='OWNER')throw new AdminError(403,'Only the Owner can stop a broadcast.');receipt=await stopBroadcast(tx,d.id);target=d.id;
  }else if(action==='invite'){
   const d=schemas.invite.parse(input);if(await tx.user.findUnique({where:{email:d.email}}))throw new AdminError(409,'Use a separate staff identity.');
   const mail=emailAdapter(),invitation=token();await tx.staffToken.updateMany({where:{email:d.email,kind:'INVITE',usedAt:null},data:{usedAt:owner.now}});
   await tx.staffToken.create({data:{tokenHash:digest(invitation),kind:'INVITE',email:d.email,role:d.role,expiresAt:new Date(owner.now.getTime()+86400000)}});
   const link=new URL('/admin/login',process.env.BETTER_AUTH_URL);link.hash=new URLSearchParams({invite:invitation}).toString();
   await mail.send({to:d.email,subject:'Your Lowwin staff invitation',text:`Accept within 24 hours: ${link}\nYour role is ${d.role}. Authenticator enrollment is required.`});receipt={invited:true,role:d.role};target='staff-invitation';
  }else if(action==='staff'){
   const d=schemas.staff.parse(input);if(d.userId===owner.id)throw new AdminError(403,'You cannot change your own grants.');
   const member=await tx.staffMember.findUniqueOrThrow({where:{userId:d.userId}});
   if(member.role==='OWNER'&&member.active&&(!d.active||d.role!=='OWNER')&&await tx.staffMember.count({where:{role:'OWNER',active:true}})<=1)throw new AdminError(409,'The last active Owner must remain.');
   await tx.staffMember.update({where:{userId:d.userId},data:{role:d.role,active:d.active}});await tx.session.deleteMany({where:{userId:d.userId}});receipt={userId:d.userId,role:d.role,active:d.active,sessionsRevoked:true};target=d.userId;
  }else if(action==='suspend'){
   const d=schemas.suspend.parse(input);if(await tx.staffMember.findUnique({where:{userId:d.userId}}))throw new AdminError(409,'Manage staff access through Team.');
   if(owner.role!=='OWNER'){const proposal=await tx.supportCase.create({data:{userId:d.userId,subject:d.suspended?'Suspension proposal':'Restore bidding proposal',message:d.reason}});receipt={userId:d.userId,proposed:true,caseId:proposal.id}}else{await tx.userRestriction.upsert({where:{userId:d.userId},create:{userId:d.userId,suspended:d.suspended,reason:d.reason},update:{suspended:d.suspended,reason:d.reason}});receipt={userId:d.userId,suspended:d.suspended}}target=d.userId;
  }else if(action==='support'){
   const d=schemas.support.parse(input);await tx.$queryRaw`SELECT id FROM "SupportCase" WHERE id=${d.id} FOR UPDATE`;
   const previous=await tx.supportCase.findUnique({where:{id:d.id}});if(!previous)throw new AdminError(404,'Support request not found.');
   if(d.expectedUpdatedAt&&previous.updatedAt.toISOString()!==d.expectedUpdatedAt)throw new AdminError(409,'This conversation changed. Refresh before replying.');
   await tx.supportCase.update({where:{id:d.id},data:{status:d.status,resolution:d.reason}});receipt={id:d.id,status:d.status};target=d.id;
  }else if(action==='supportWithdraw'){
   const d=schemas.supportWithdraw.parse(input);await tx.$queryRaw`SELECT id FROM "SupportCase" WHERE id=${d.id} FOR UPDATE`;
   const previous=await tx.supportCase.findUnique({where:{id:d.id}});if(!previous)throw new AdminError(404,'Support request not found.');
   if(previous.updatedAt.toISOString()!==d.expectedUpdatedAt)throw new AdminError(409,'This conversation changed. Refresh before withdrawing the reply.');
   if(!previous.resolution)throw new AdminError(409,'There is no reply to withdraw.');
   const row=await tx.supportCase.update({where:{id:d.id},data:{resolution:'',status:previous.status==='RESOLVED'?'OPEN':previous.status}});
   await tx.adminAudit.create({data:{actorId:owner.id,action:'SUPPORT_REPLY_WITHDRAWN',target:d.id,details:{previousReply:previous.resolution,previousStatus:previous.status,reason:d.reason}}});
   receipt={id:d.id,status:row.status,withdrawn:true};target=d.id;
  }else if(action==='deliveryDone'){
   const d=schemas.deliveryDone.parse(input),settled=await tx.auctionSettlement.findUnique({where:{auctionId:d.auctionId}}),previous=await tx.fulfillmentCase.findUnique({where:{auctionId:d.auctionId}});
   if(settled?.outcome!=='WINNER'||!settled.winnerUserId)throw new AdminError(409,'A settled winner is required.');
   if(owner.role!=='OWNER'&&previous?.assignedTo!==owner.id)throw new AdminError(403,'You may complete only your assigned deliveries.');
   if((previous?.version??0)!==d.version)throw new AdminError(409,'Delivery changed. Refresh before completing it.');
   if(previous?.state==='DELIVERED')throw new AdminError(409,'This item is already delivered.');
   const data={state:'DELIVERED',note:d.reason,deliveredAt:owner.now,contactDeleteAt:new Date(owner.now.getTime()+30*86400000)};
   const row=await tx.fulfillmentCase.upsert({where:{auctionId:d.auctionId},create:{auctionId:d.auctionId,userId:settled.winnerUserId,...data},update:{...data,version:{increment:1}}});
   receipt={auctionId:row.auctionId,state:row.state,version:row.version};target=row.auctionId;
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
  }else if(action==='testStart'){
   const d=schemas.testStart.parse(input);if(owner.role!=='OWNER')throw new AdminError(403,'Only the Owner can create a private test run.');if(!(demoBidAllowed()||stagingDemoEnabled()))throw new AdminError(409,'Private test runs require the isolated local test or pinned staging capability.');
   const category=await tx.category.findFirst({where:{visible:true,requiresEligibilityReview:false},orderBy:{id:'asc'}});if(!category)throw new AdminError(409,'Create one standard category before starting a test run.');
   const runId=randomUUID(),marker=runId.slice(0,8),now=owner.now,productId=randomUUID(),auctionId=randomUUID();
   await tx.testRun.create({data:{id:runId,state:'RUNNING',label:d.label,actorId:owner.id}});
   await tx.product.create({data:{id:productId,slug:`test-run-${marker}`,title:`TEST ${d.label}`,description:'Private disposable auction. No real item, payment, delivery or external notification.',condition:'TEST ONLY',categoryId:category.id,isDemo:true,visible:true,testRunId:runId,images:{create:{path:'/catalog/phone.svg',alt:'Private test auction illustration',sourceType:'ORIGINAL'}}}});
   await tx.auction.create({data:{id:auctionId,code:`TEST-${marker.toUpperCase()}`,slug:`test-run-${marker}`,productId,categoryId:category.id,status:'LIVE',startsAt:new Date(now.getTime()-60000),endsAt:new Date(now.getTime()+15*60000),publishedAt:now,isDemo:true,isSettlementFixture:true,testRunId:runId,fulfillmentSummary:'TEST ONLY · no delivery',fulfillmentRegion:'TEST ONLY',presentation:{title:`TEST ${d.label}`,description:'Private disposable auction. No real item or delivery.',condition:'TEST ONLY',images:[{path:'/catalog/phone.svg',alt:'Private test auction illustration',sourceType:'ORIGINAL'}]},terms:{create:{ruleVersion:RULE_V3,minParticipants:V2_MIN_PARTICIPANTS,minPoints:'1',maxPoints:'100',stepPoints:'0.01',entryFeePoints:'1',maxDistinctBids:100,noWinnerTerms:V2_FALLBACK_TERMS+' '+V3_AMOUNT_TERMS,cancellationTerms:V2_CANCELLATION_TERMS,fulfillmentSnapshot:'TEST ONLY',publishedEndsAt:new Date(now.getTime()+15*60000),maxExtensionMinutes:60,allowPaidShortening:true,shortenNoticeMinutes:5}},feeRevisions:{create:{version:1,feePoints:'1',effectiveAt:now,actorId:owner.id,reason:'Private test run initial fee'}}}});
   const actors=[];for(let index=0;index<2;index++){const userId=`demo-showcase-${marker}-${index}`;await tx.user.create({data:{id:userId,name:`TEST player ${index+1}`}});await tx.testRunActor.create({data:{testRunId:runId,userId,label:`Player ${index+1}`}});await creditTestRunPoints(tx,userId,'100',`demo-showcase:${runId}:${index}`);actors.push({userId,label:`Player ${index+1}`,balance:'100'})}
   await submitBidInTransaction(tx,{userId:actors[0].userId,auctionSlug:`test-run-${marker}`,amount:'1.01',feeVersion:1,key:randomUUID()});await submitBidInTransaction(tx,{userId:actors[1].userId,auctionSlug:`test-run-${marker}`,amount:'1.02',feeVersion:1,key:randomUUID()});
   await tx.notificationInbox.createMany({data:actors.map((testActor,index)=>({key:`test-run:${runId}:simulated:${index}`,userId:testActor.userId,kind:'TEST_SIMULATED',title:'TEST notification',body:'Simulated only. No Telegram message was sent.',href:`/auctions/test-run-${marker}`,testRunId:runId}))});
   receipt={id:runId,state:'RUNNING',auctionId,auctionCode:`TEST-${marker.toUpperCase()}`,actors,notifications:'SIMULATED'};target=runId;
  }else if(action==='testFinish'){
   const d=schemas.testFinish.parse(input);if(owner.role!=='OWNER'||!(demoBidAllowed()||stagingDemoEnabled()))throw new AdminError(403,'Private test capability is required.');const run=await tx.testRun.findUniqueOrThrow({where:{id:d.id},include:{auctions:true}});if(run.state!=='RUNNING')throw new AdminError(409,'Only a running test can be finished.');
   for(const auction of run.auctions){await tx.auction.update({where:{id:auction.id},data:{endsAt:new Date(owner.now.getTime()-1)}});await closeAuctionInTransaction(tx,auction.id)}await tx.testRun.update({where:{id:run.id},data:{state:'FINISHED',finishedAt:owner.now}});receipt={id:run.id,state:'FINISHED',auctions:run.auctions.length};target=run.id;
  }else if(action==='testClean'){
   const d=schemas.testClean.parse(input);if(owner.role!=='OWNER'||!(demoBidAllowed()||stagingDemoEnabled()))throw new AdminError(403,'Private test capability is required.');const run=await tx.testRun.findUniqueOrThrow({where:{id:d.id}});if(!['FINISHED','FAILED'].includes(run.state))throw new AdminError(409,'Finish the test run before cleanup.');await tx.$executeRaw`SELECT cleanup_test_run(${run.id})`;receipt={id:run.id,state:'CLEANED',deleted:true};target=run.id;
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
 if(section==='fulfillment'&&path[1]==='staff'){if(actor.role!=='OWNER')throw new AdminError(403,'Only the Owner assigns deliveries.');const where:Prisma.StaffMemberWhereInput={active:true,role:{in:['OWNER','FULFILLMENT']},...(q?{user:{OR:[{name:{contains:q,mode:'insensitive'}},{email:{contains:q,mode:'insensitive'}}]}}:{})};return result(await client.staffMember.findMany({where,select:{userId:true,user:{select:{name:true,email:true}}},orderBy:{userId:'asc'},skip,take}),await client.staffMember.count({where}));}
 if(section==='team'){const where:Prisma.StaffMemberWhereInput=q?{user:{email:{contains:q,mode:'insensitive'}}}:{};return result(await client.staffMember.findMany({where,select:{userId:true,role:true,active:true,createdAt:true,user:{select:{email:true}}},orderBy:{userId:'asc'},skip,take}),await client.staffMember.count({where}))}
 if(section==='users'||section==='support')return serialize(await peopleRead(client,actor,path,{page,q,status}));
 if(section==='results'){const where:Prisma.AuctionSettlementWhereInput={auction:{testRunId:null,...(q?{OR:[{code:{contains:q,mode:'insensitive'}},{product:{title:{contains:q,mode:'insensitive'}}}]}:{})},...(status?{outcome:status}:{})};return result(await client.auctionSettlement.findMany({where,select:{ruleVersion:true,auctionId:true,outcome:true,completedAt:true,winningPoints:true,winner:{select:{id:true,name:true}},auction:{select:{code:true,isDemo:true,presentation:true,product:{select:{title:true,images:{select:{path:true,alt:true},take:1}}}}}},orderBy:[{completedAt:'desc'},{id:'asc'}],skip,take}),await client.auctionSettlement.count({where}))}
 if(section==='fulfillment'){
  if(path[1]){const row=await client.fulfillmentCase.findUnique({where:{auctionId:path[1]}});if(!row||actor.role!=='OWNER'&&row.assignedTo!==actor.id)throw new AdminError(404,'Assigned fulfillment not found.');const {contactCipher,...safe}=row;await client.adminAudit.create({data:{actorId:actor.id,action:'FULFILLMENT_CONTACT_READ',target:row.auctionId,details:{}}});return {...safe,contact:contactCipher?JSON.parse(openContact(contactCipher)):null}}
  return serialize(await peopleRead(client,actor,path,{page,q,status}));
 }
 if(section==='wallets'){
  if(path[1]==='operations'&&path[2]){const op=await client.operation.findUniqueOrThrow({where:{id:path[2]},select:{id:true,scope:true,createdAt:true,journal:{select:{id:true,kind:true,createdAt:true,postings:{select:{accountId:true,delta:true}}}}}});return serialize(op)}
  if(path[1]){const wallet=await client.wallet.findUniqueOrThrow({where:{id:path[1]},select:{id:true,userId:true,user:{select:{name:true}},accounts:{select:{id:true,kind:true,balance:true}},holds:{select:{auctionId:true,points:true}}}});const where={userId:wallet.userId};return serialize({...wallet,operations:await client.operation.findMany({where,select:{id:true,scope:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take}),total:await client.operation.count({where}),page})}
  const where:Prisma.WalletWhereInput=q?{OR:[{userId:{contains:q}},{user:{name:{contains:q,mode:'insensitive'}}}]}:{};return result(await client.wallet.findMany({where,select:{id:true,userId:true,user:{select:{name:true}},accounts:{select:{kind:true,balance:true}},holds:{select:{points:true}}},orderBy:{id:'asc'},skip,take}),await client.wallet.count({where}));
 }
 if(section==='notifications')return serialize(await broadcastHistory(client,{page,q}));
 if(section==='jobs'){const where:Prisma.OutboxWhereInput={...(status?{state:status}:{}),...(q?{kind:{contains:q,mode:'insensitive'}}:{})};return result(await client.outbox.findMany({where,select:{id:true,kind:true,state:true,attempts:true,nextAttemptAt:true,lastError:true,createdAt:true,sentAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take}),await client.outbox.count({where}))}
 if(section==='audit'&&path[1]){const row=await client.adminAudit.findUniqueOrThrow({where:{id:path[1]},select:{id:true,actorId:true,action:true,target:true,createdAt:true,details:true}});const staff=await client.user.findUnique({where:{id:row.actorId},select:{name:true,email:true}});const detail=row.details as Record<string,unknown>;return serialize({...row,actorLabel:staff?.email??staff?.name??'Former staff member',details:{reason:typeof detail.reason==='string'?detail.reason:'No reason recorded'}})}
 if(section==='audit'){const where:Prisma.AdminAuditWhereInput={...(q?{action:{contains:q,mode:'insensitive'}}:{})};const rows=await client.adminAudit.findMany({where,select:{id:true,actorId:true,action:true,target:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip,take});const actors=await client.user.findMany({where:{id:{in:rows.map(r=>r.actorId)}},select:{id:true,name:true,email:true}});return result(rows.map(r=>({...r,actorLabel:actors.find(a=>a.id===r.actorId)?.email??'Former staff member'})),await client.adminAudit.count({where}))}
 if(section==='analytics'){const from=params.get('from'),to=params.get('to');const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);const range={...(from?{gte:new Date(date.parse(from))}:{}),...(to?{lt:new Date(new Date(date.parse(to)).getTime()+86400000)}:{})};if(from&&to&&from>to)throw new AdminError(422,'Start date must precede end date.');return serialize({outcomes:await client.auctionSettlement.groupBy({by:['outcome'],where:{completedAt:range,auction:{testRunId:null}},_count:{id:true}}),participants:Number((await client.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(DISTINCT b."userId") AS count FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId" WHERE a."testRunId" IS NULL ${from?Prisma.sql`AND b."acceptedAt">=${new Date(from)}`:Prisma.empty} ${to?Prisma.sql`AND b."acceptedAt"<${new Date(new Date(to).getTime()+86400000)}`:Prisma.empty}`))[0].count),acceptedBids:await client.bid.count({where:{acceptedAt:range,auction:{testRunId:null}}}),demoBids:await client.bid.count({where:{acceptedAt:range,auction:{testRunId:null,isDemo:true}}}),points:await client.ledgerAccount.groupBy({by:['kind'],_sum:{balance:true}}),delivery:await client.outbox.groupBy({by:['state'],where:{createdAt:range,testRunId:null},_count:{id:true}})})}
 if(section==='settings'){let email='Unavailable — configure a production provider';try{emailAdapter();email=process.env.EMAIL_TRANSPORT==='resend'?'Resend configured — delivery is not verified by this page':'Local test sink only'}catch{}return serialize({email,payments:paymentHealth().reason,contactRetention:'Encrypted delivery contact is deleted 30 days after delivery. Resolve disputes before resuming deletion.',securityReview:'Independent staff-auth security review remains a release check.',testModeAvailable:actor.role==='OWNER'&&(demoBidAllowed()||stagingDemoEnabled()),testRuns:actor.role==='OWNER'?await client.testRun.findMany({orderBy:[{createdAt:'desc'},{id:'asc'}],take:10,include:{_count:{select:{auctions:true,actors:true,inbox:true,outbox:true}}}}):[]})}
 throw new AdminError(404,'Admin resource not found.');
}
