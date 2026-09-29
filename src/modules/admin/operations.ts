import {RULE_V2,V2_MIN_PARTICIPANTS,V2_FALLBACK_TERMS,V2_CANCELLATION_TERMS} from '../auctions/rules';
import { randomUUID } from 'node:crypto';
import { Prisma,type PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import {opsRead,sectionPermission,pageInput} from './ops';
import {assertPermission,permissions} from './permissions';
import { requireAdmin } from './boundary';
import { AdminError } from './errors';
import { digest } from './crypto';
import { cancelAuctionInTransaction } from '../auctions/settlement';
import { demoBidAllowed } from '../auctions/bids';
import { reconcile } from '../wallet/ledger';

const id=z.string().uuid(),key=z.string().uuid(),version=z.number().int().min(0),text=(n:number)=>z.string().trim().min(1).max(n);
const points=z.string().regex(/^(0|[1-9]\d{0,8})$/);
export const draftBodySchema=z.object({productId:id,startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),minPoints:points,maxPoints:points,stepPoints:points,entryFeePoints:points,fulfillmentSummary:text(500),fulfillmentRegion:text(160),featured:z.boolean().default(false)}).strict();
const schemas={
  category:z.object({key,id:id.optional(),version,name:text(80),slug:text(80).regex(/^[a-z0-9-]+$/),description:text(600),visible:z.boolean(),requiresEligibilityReview:z.boolean()}).strict(),
  product:z.object({key,id:id.optional(),version,title:text(120),slug:text(100).regex(/^[a-z0-9-]+$/),description:text(1500),condition:text(100),categoryId:id,isDemo:z.boolean(),visible:z.boolean(),imageIds:z.array(id).max(8)}).strict(),
  media:z.object({key,mime:z.enum(['image/png','image/jpeg','image/webp']),data:z.string().max(2800000).regex(/^[A-Za-z0-9+/]+={0,2}$/),sourceType:z.enum(['ORIGINAL','LICENSED','SUPPLIED']),sourceCredit:text(300),rightsConfirmed:z.literal(true)}).strict(),
  content:z.object({key,id:z.enum(['home','faq']),version,body:z.unknown()}).strict(),
  draft:z.object({key,auctionId:id.optional(),version,body:draftBodySchema}).strict(),
  publish:z.object({key,auctionId:id,version}).strict(),
  cancel:z.object({key,auctionId:id,reason:text(1000),confirmation:text(100),impactHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  replace:z.object({key,auctionId:id}).strict(),
};
export type AdminAction=keyof typeof schemas;
export const homeContentSchema=z.object({headline:text(90),lead:text(350),headlineAm:text(90).optional(),leadAm:text(350).optional()}).strict();
export const faqContentSchema=z.object({items:z.array(z.object({question:text(160),answer:text(1500),questionAm:text(160).optional(),answerAm:text(1500).optional()}).strict()).max(30)}).strict();
const asJson=(value:unknown)=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)) as Prisma.InputJsonValue;
async function lockAuction(tx:Prisma.TransactionClient,auctionId:string){const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;if(!rows.length)throw new AdminError(404,'Auction not found.')}
export async function cancellationImpact(tx:Prisma.TransactionClient,auctionId:string) {
  const auction=await tx.auction.findUniqueOrThrow({where:{id:auctionId},select:{id:true,code:true,status:true,publishedAt:true,acceptedBidCount:true,settlement:{select:{id:true}},result:{select:{id:true}}}});
  if(!auction.publishedAt||!['LIVE','SCHEDULED'].includes(auction.status)||auction.settlement||auction.result)throw new AdminError(409,'Only an unsettled published auction can be cancelled.');
  const [fees,holds]=await Promise.all([tx.bid.groupBy({by:['userId'],where:{auctionId},_sum:{feePoints:true},_count:{id:true}}),tx.auctionHold.findMany({where:{auctionId},select:{points:true,wallet:{select:{userId:true}}}})]);
  const participants=new Map<string,{userId:string;heldPoints:string;feeRefund:string;acceptedBids:number}>();
  for(const row of fees)participants.set(row.userId,{userId:row.userId,heldPoints:'0',feeRefund:(row._sum.feePoints??0n).toString(),acceptedBids:row._count.id});
  for(const hold of holds){const previous=participants.get(hold.wallet.userId)??{userId:hold.wallet.userId,heldPoints:'0',feeRefund:'0',acceptedBids:0};previous.heldPoints=hold.points.toString();participants.set(previous.userId,previous)}
  const rows=[...participants.values()].sort((a,b)=>a.userId<b.userId?-1:a.userId>b.userId?1:0);
  const impact={auctionId,code:auction.code,affectedBidders:fees.length,acceptedBids:auction.acceptedBidCount,heldPoints:rows.reduce((sum,row)=>sum+BigInt(row.heldPoints),0n).toString(),feeRefund:rows.reduce((sum,row)=>sum+BigInt(row.feeRefund),0n).toString(),participants:rows};
  return {...impact,impactHash:digest(JSON.stringify(impact))};
}
export async function publicationPreflight(tx:Prisma.TransactionClient,auctionId:string) {
  const auction=await tx.auction.findUniqueOrThrow({where:{id:auctionId},include:{draft:true}});
  if(auction.publishedAt||auction.status!=='DRAFT'||!auction.draft)throw new AdminError(409,'Only an unpublished draft can be edited or published.');
  const body=draftBodySchema.parse(auction.draft.body),product=await tx.product.findUnique({where:{id:body.productId},include:{category:true,images:{orderBy:{sortOrder:'asc'}}}});
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const errors:string[]=[];
  if(auction.isDemo&&product&&!product.isDemo)errors.push('A DEMO replacement must retain DEMO inventory.');
  if(!product||!product.visible||!product.category.visible)errors.push('Choose a visible product and category.');
  if(!product?.images.length)errors.push('Attach at least one validated product image.');
  if(product?.category.requiresEligibilityReview)errors.push('This category requires an eligibility workflow that is not available yet.');
  if(product?.isDemo&&!demoBidAllowed(process.env))errors.push('DEMO publication requires an isolated local/test database.');
  const start=new Date(body.startsAt),end=new Date(body.endsAt);
  if(start.getTime()<now.getTime()+60000)errors.push('Schedule the start at least one minute in the future.');
  if(end<=start||end.getTime()-start.getTime()>30*86400000)errors.push('End must follow start, within 30 days.');
  const min=BigInt(body.minPoints),max=BigInt(body.maxPoints),step=BigInt(body.stepPoints);
  if(min<1n||max<min||step<1n||(step>0n&&(max-min)%step!==0n))errors.push('ETB range must be positive and align with the step.');
  return {auction,body,product,errors,now};
}
export async function adminMutation(client:PrismaClient,headers:Headers,action:AdminAction,raw:unknown) {
  if(!Object.hasOwn(schemas,action))throw new AdminError(404,'Unknown admin command.');
  const input=schemas[action].parse(raw),owner=await requireAdmin(client,headers,{permission:action==='cancel'||action==='publish'?'cancel':'catalog'}),hash=digest(JSON.stringify({action,input}));
  // All auction writes acquire the auction row BEFORE staff/idempotency and wallet
  // locks. The unchanged cancellation command then locks wallet keys in stable order.
  return client.$transaction(async tx=>{
    if('auctionId' in input&&input.auctionId)await lockAuction(tx,input.auctionId);
    const operationKey=`${owner.id}:${input.key}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`admin:${operationKey}`},0))`;
    const actor=await requireAdmin(tx,headers,{lock:true,fresh:action==='cancel',permission:action==='cancel'||action==='publish'?'cancel':'catalog'});
    const previous=await tx.adminAudit.findUnique({where:{operationKey}});
    if(previous){if(previous.requestHash!==hash)throw new AdminError(409,'Idempotency key was used with different input.');return (previous.details as {receipt:unknown}).receipt}
    let receipt:unknown,target='';
    if(action==='category'){
      const data=schemas.category.parse(input);const {key:_,id:categoryId,version:expected,...fields}=data;
      if(categoryId){await tx.$queryRaw`SELECT id FROM "Category" WHERE id=${categoryId} FOR UPDATE`;const current=await tx.category.findUniqueOrThrow({where:{id:categoryId}});if(current.version!==expected)throw new AdminError(409,'Category changed. Reload before saving.');if(await tx.auction.count({where:{categoryId,publishedAt:{not:null}}}))throw new AdminError(409,'Published inventory is frozen. Create a replacement category.');receipt=await tx.category.update({where:{id:categoryId},data:{...fields,version:{increment:1}}})}
      else {if(expected!==0)throw new AdminError(409,'New category must use version zero.');receipt=await tx.category.create({data:fields})}target=(receipt as {id:string}).id;
    }else if(action==='media'){
      const data=schemas.media.parse(input),bytes=Buffer.from(data.data,'base64');if(bytes.length>2097152)throw new AdminError(422,'Images must be at most 2 MiB.');
      const actual=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
      if(actual!==data.mime)throw new AdminError(422,'Image content and declared type do not match. SVG and scripts are not accepted.');
      let clean:Buffer;try{clean=await sharp(bytes,{limitInputPixels:16000000,animated:false}).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).png().toBuffer()}catch{throw new AdminError(422,'Image could not be decoded safely.')}
      if(clean.length>2097152)throw new AdminError(422,'Re-encoded image exceeds 2 MiB.');
      const media=await tx.managedMedia.create({data:{bytes:Uint8Array.from(clean),mime:'image/png',sourceType:data.sourceType,sourceCredit:data.sourceCredit},select:{id:true,mime:true,sourceType:true,sourceCredit:true}});target=media.id;receipt={...media,path:`/api/media/${media.id}`};
    }else if(action==='product'){
      const data=schemas.product.parse(input),{key:_,id:productId,version:expected,imageIds,...fields}=data;
      if(new Set(imageIds).size!==imageIds.length)throw new AdminError(422,'Duplicate images are not allowed.');
      const media=await tx.managedMedia.findMany({where:{id:{in:imageIds}},select:{id:true,sourceType:true,sourceCredit:true}});if(media.length!==imageIds.length)throw new AdminError(422,'Use uploaded validated images.');
      if(productId){await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;const current=await tx.product.findUniqueOrThrow({where:{id:productId}});if(current.version!==expected)throw new AdminError(409,'Product changed. Reload before saving.');if(current.isDemo&&!fields.isDemo)throw new AdminError(409,'DEMO inventory cannot become real inventory.');if(await tx.auction.count({where:{productId,publishedAt:{not:null}}}))throw new AdminError(409,'Published inventory is frozen. Create a replacement product.');await tx.product.update({where:{id:productId},data:{...fields,version:{increment:1}}});await tx.productImage.deleteMany({where:{productId}});target=productId}
      else {if(expected!==0)throw new AdminError(409,'New product must use version zero.');target=(await tx.product.create({data:fields})).id}
      for(const [sortOrder,mediaId] of imageIds.entries()){const image=media.find(item=>item.id===mediaId)!;await tx.productImage.create({data:{productId:target,path:`/api/media/${image.id}`,alt:fields.title,sourceType:image.sourceType,sourceCredit:image.sourceCredit,sortOrder}})}
      receipt=await tx.product.findUniqueOrThrow({where:{id:target},include:{images:true}});
    }else if(action==='content'){
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:content',0))`;
      const data=schemas.content.parse(input),body=data.id==='home'?homeContentSchema.parse(data.body):faqContentSchema.parse(data.body),current=await tx.siteContent.findUnique({where:{id:data.id}});
      if((current?.version??0)!==data.version)throw new AdminError(409,'Content changed. Reload before saving.');
      receipt=await tx.siteContent.upsert({where:{id:data.id},create:{id:data.id,body:asJson(body)},update:{body:asJson(body),version:{increment:1}}});target=data.id;
    }else if(action==='draft'){
      const data=schemas.draft.parse(input);
      if(data.auctionId){const auction=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{draft:true}});if(auction.publishedAt||auction.status!=='DRAFT')throw new AdminError(409,'Published auctions are immutable. Cancel and replace.');if(auction.draft?.version!==data.version)throw new AdminError(409,'Draft changed. Reload before saving.');await tx.auctionDraft.update({where:{auctionId:data.auctionId},data:{body:asJson(data.body),version:{increment:1}}});target=data.auctionId}
      else {if(data.version!==0)throw new AdminError(409,'New draft must use version zero.');const suffix=randomUUID().slice(0,12);const row=await tx.auction.create({data:{code:`LW-${suffix.toUpperCase()}`,slug:`lowin-${suffix}`,draft:{create:{body:asJson(data.body)}}}});target=row.id}
      receipt={auctionId:target,draft:await tx.auctionDraft.findUniqueOrThrow({where:{auctionId:target}})};
    }else if(action==='publish'){
      const data=schemas.publish.parse(input),draft=await tx.auctionDraft.findUniqueOrThrow({where:{auctionId:data.auctionId}}),body=draftBodySchema.parse(draft.body);
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${body.productId} FOR UPDATE`;
      const item=await tx.product.findUniqueOrThrow({where:{id:body.productId}});await tx.$queryRaw`SELECT id FROM "Category" WHERE id=${item.categoryId} FOR UPDATE`;
      const checked=await publicationPreflight(tx,data.auctionId);if(checked.auction.draft?.version!==data.version)throw new AdminError(409,'Draft changed. Repeat preflight.');if(checked.errors.length)throw new AdminError(422,checked.errors.join(' '));const p=checked.product!;
      await tx.auctionTerms.create({data:{auctionId:data.auctionId,ruleVersion:RULE_V2,minParticipants:V2_MIN_PARTICIPANTS,minPoints:BigInt(body.minPoints),maxPoints:BigInt(body.maxPoints),stepPoints:BigInt(body.stepPoints),entryFeePoints:BigInt(body.entryFeePoints),maxDistinctBids:100,noWinnerTerms:V2_FALLBACK_TERMS,cancellationTerms:V2_CANCELLATION_TERMS,fulfillmentSnapshot:body.fulfillmentSummary}});
      const auction=await tx.auction.update({where:{id:data.auctionId},data:{productId:p.id,categoryId:p.categoryId,isDemo:p.isDemo,isSettlementFixture:p.isDemo&&demoBidAllowed(process.env),startsAt:new Date(body.startsAt),endsAt:new Date(body.endsAt),publishedAt:checked.now,status:'SCHEDULED',featured:body.featured,fulfillmentSummary:body.fulfillmentSummary,fulfillmentRegion:body.fulfillmentRegion}});target=auction.id;receipt={auctionId:target,code:auction.code,status:auction.status,isDemo:auction.isDemo};
    }else if(action==='cancel'){
      const data=schemas.cancel.parse(input),impact=await cancellationImpact(tx,data.auctionId);
      if(data.confirmation!==impact.code)throw new AdminError(422,'Type the exact auction code to confirm cancellation.');
      if(data.impactHash!==impact.impactHash)throw new AdminError(409,'Cancellation impact changed. Review the new preview before confirming.');
      const settled=await cancelAuctionInTransaction(tx,{auctionId:data.auctionId,actor:{id:actor.id,permission:'auction:cancel'},reason:data.reason,key:data.key});
      target=data.auctionId;receipt={auctionId:target,code:impact.code,status:settled.outcome,heldReleased:impact.heldPoints,feesRefunded:impact.feeRefund,affectedBidders:impact.affectedBidders};
    }else if(action==='replace'){
      const data=schemas.replace.parse(input),original=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{terms:true,draft:true}});
      if(original.status!=='CANCELLED'||!original.terms||!original.productId)throw new AdminError(409,'Cancel the published auction before creating its replacement.');
      const suffix=randomUUID().slice(0,12),now=actor.now,body={productId:original.productId,startsAt:new Date(now.getTime()+3600000).toISOString(),endsAt:new Date(now.getTime()+86400000).toISOString(),minPoints:original.terms.minPoints.toString(),maxPoints:original.terms.maxPoints.toString(),stepPoints:original.terms.stepPoints.toString(),entryFeePoints:original.terms.entryFeePoints.toString(),fulfillmentSummary:original.fulfillmentSummary!,fulfillmentRegion:original.fulfillmentRegion!,featured:original.featured};
      const replacement=await tx.auction.create({data:{code:`LW-${suffix.toUpperCase()}`,slug:`lowin-${suffix}`,isDemo:original.isDemo,draft:{create:{body}}}});target=replacement.id;receipt={auctionId:target,replaces:original.id};
    }
    await tx.adminAudit.create({data:{actorId:actor.id,action:action.toUpperCase(),target,operationKey,requestHash:hash,details:{receipt:asJson(receipt)}}});return receipt;
  },{timeout:120000,maxWait:15000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export async function adminRead(client:PrismaClient,headers:Headers,path:string[],params=new URLSearchParams()) {
  if(sectionPermission[path[0]])return opsRead(client,headers,path,params);
  const actor=await requireAdmin(client,headers);
  if(path[0]==='me')return {role:actor.role,permissions:permissions(actor.role),expiresAt:actor.expiresAt,mfaAt:actor.mfaAt};
  if(path[0]!=='dashboard'){const permission=path[0]==='reconciliation'||path[2]==='proof'?'audit':path[2]==='impact'?'cancel':'catalog';assertPermission(actor.role,permission)}
  if(path[0]==='dashboard'){
    if(actor.role!=='OWNER'&&actor.role!=='AUDITOR')return {counts:{},incidents:[],reconciliation:null,permissions:permissions(actor.role)}
    const [drafts,scheduled,due,closed,incidents,drift]=await Promise.all([client.auction.count({where:{status:'DRAFT'}}),client.auction.count({where:{status:{in:['LIVE','SCHEDULED']},endsAt:{gt:actor.now}}}),client.auction.count({where:{status:{in:['LIVE','SCHEDULED']},endsAt:{lte:actor.now},result:{is:null},settlement:{is:null}}}),client.auctionSettlement.count(),client.auction.findMany({where:{closeErrorCode:{not:null},settlement:{is:null}},select:{id:true,code:true,closeAttempts:true,closeErrorCode:true,nextCloseAttemptAt:true},take:20,orderBy:{endsAt:'asc'}}),reconcile(client)]);
    return {counts:{drafts,scheduled,due,closed},incidents,reconciliation:{healthy:drift.length===0,issues:drift.length}};
  }
  if(path[0]==='categories')return client.category.findMany({orderBy:{name:'asc'}});
  if(path[0]==='products'&&path[1])return client.product.findUniqueOrThrow({where:{id:id.parse(path[1])},include:{images:true,category:{select:{name:true}}}});
  if(path[0]==='products'){const {page,q,status}=pageInput(params),where={...(q?{title:{contains:q,mode:'insensitive' as const}}:{}),...(status==='VISIBLE'?{visible:true}:status==='HIDDEN'?{visible:false}:{})},total=await client.product.count({where});return {items:await client.product.findMany({where,include:{images:true,category:{select:{name:true}},_count:{select:{auctions:{where:{publishedAt:{not:null}}}}}},orderBy:[{title:'asc'},{id:'asc'}],take:25,skip:(page-1)*25}),total,page,totalPages:Math.ceil(total/25)}}
  if(path[0]==='content')return client.siteContent.findMany();
  if(path[0]==='reconciliation')return {drift:asJson(await reconcile(client))};
  if(path[0]==='auctions'&&!path[1]){const {page,q,status}=pageInput(params),where:Prisma.AuctionWhereInput={...(q?{OR:[{code:{contains:q,mode:'insensitive'}},{product:{title:{contains:q,mode:'insensitive'}}}]}:{}),...(status==='PENDING'?{status:{in:['LIVE','SCHEDULED']},endsAt:{lte:actor.now},settlement:{is:null}}:status?{status}: {})},total=await client.auction.count({where});return {items:await client.auction.findMany({where,select:{id:true,code:true,slug:true,status:true,startsAt:true,endsAt:true,publishedAt:true,isDemo:true,settlement:{select:{outcome:true}},product:{select:{title:true}},draft:{select:{version:true}},closeErrorCode:true},orderBy:[{publishedAt:'desc'},{id:'asc'}],take:25,skip:(page-1)*25}),total,page,totalPages:Math.ceil(total/25)}}
  if(path[0]==='auctions'&&path[1]){
    const auctionId=id.parse(path[1]);
    if(path[2]==='impact')return client.$transaction(async tx=>{await lockAuction(tx,auctionId);await requireAdmin(tx,headers);return cancellationImpact(tx,auctionId)});
    if(path[2]==='preflight')return client.$transaction(async tx=>{const {auction,body,product,errors,now}=await publicationPreflight(tx,auctionId);return {auctionId,code:auction.code,version:auction.draft!.version,body,product,errors,serverNow:now.toISOString(),ready:errors.length===0}});
    if(path[2]==='proof'){
      const settlement=await client.auctionSettlement.findUnique({where:{auctionId},include:{movements:true,auction:{select:{status:true}}}});
      if(!settlement||!['CLOSED','CANCELLED'].includes(settlement.auction.status))throw new AdminError(409,'Proof and participant journals are available only after close or cancellation.');
      const operationIds=settlement.movements.flatMap(m=>[m.chargeOperationId,m.releaseOperationId,m.refundOperationId].filter((value):value is string=>!!value));
      const [journals,holds,wallets]=await Promise.all([client.journal.findMany({where:{operationId:{in:operationIds}},include:{postings:{include:{account:{select:{name:true,kind:true}}}}}}),client.auctionHold.findMany({where:{auctionId}}),client.wallet.findMany({where:{id:{in:settlement.movements.map(m=>m.walletId)}},select:{id:true,accounts:{select:{kind:true,balance:true}}}})]);
      return asJson({settlement,journals,holds,wallets});
    }
    if(path[2])throw new AdminError(404,'Admin resource not found.');
    const auction=await client.auction.findUniqueOrThrow({where:{id:auctionId},select:{id:true,code:true,slug:true,status:true,isDemo:true,startsAt:true,endsAt:true,publishedAt:true,fulfillmentSummary:true,fulfillmentRegion:true,closeErrorCode:true,closeAttempts:true,nextCloseAttemptAt:true,product:{include:{images:true,category:true}},terms:true,draft:true,settlement:{select:{outcome:true,completedAt:true,winningPoints:true}},result:{select:{outcome:true,isDemo:true}}}});return asJson(auction);
  }
  throw new AdminError(404,'Admin resource not found.');
}
