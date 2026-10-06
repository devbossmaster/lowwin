import {readOverview,auctionList,displayAuctionStatus} from './workspace-read';
import {queueGlobal} from '../notifications/campaigns';
import {RULE_V4,V4_NUMBER_TERMS,V2_MIN_PARTICIPANTS,V2_FALLBACK_TERMS,V4_CANCELLATION_TERMS,isSubmissionFeeOnly} from '../auctions/rules';
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
import {clearPublicDataCache} from '../cache/public-data';
import {retireAuctionEndingAlerts,retireAuctionPromotions} from '../notifications/service';

const id=z.string().uuid(),key=z.string().uuid(),version=z.number().int().min(0),text=(n:number)=>z.string().trim().min(1).max(n);
const points=z.string().regex(/^(0|[1-9]\d{0,8})(?:\.\d{1,2})?$/),localized=(n:number)=>z.string().trim().max(n).optional().default('');
export const draftBodySchema=z.object({productId:id,startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),minPoints:points,maxPoints:points.optional(),stepPoints:points,entryFeePoints:points,fulfillmentSummary:text(500),fulfillmentSummaryAm:localized(500),fulfillmentRegion:text(160),fulfillmentRegionAm:localized(160),featured:z.boolean().default(false),maxExtensionMinutes:z.number().int().min(0).max(43200).default(10080),allowPaidShortening:z.boolean().default(false),shortenNoticeMinutes:z.number().int().min(5).max(10080).default(1440)}).strict();
const schemas={
  category:z.object({key,id:id.optional(),version,name:text(80),nameAm:text(80),slug:text(80).regex(/^[a-z0-9-]+$/),description:text(600),descriptionAm:text(600),visible:z.boolean(),requiresEligibilityReview:z.boolean()}).strict(),
  product:z.object({key,id:id.optional(),version,title:text(120),titleAm:localized(120),slug:text(100).regex(/^[a-z0-9-]+$/),description:text(1500),descriptionAm:localized(1500),condition:text(100),conditionAm:localized(100),categoryId:id,isDemo:z.boolean(),visible:z.boolean(),imageIds:z.array(id).max(8)}).strict(),
  media:z.object({key,mime:z.enum(['image/png','image/jpeg','image/webp']),data:z.string().max(2800000).regex(/^[A-Za-z0-9+/]+={0,2}$/),sourceType:z.enum(['ORIGINAL','LICENSED','SUPPLIED']).default('SUPPLIED'),sourceCredit:z.string().trim().max(300).default(''),rightsConfirmed:z.literal(true).optional()}).strict(),
  content:z.object({key,id:z.enum(['home','faq']),version,body:z.unknown()}).strict(),
  draft:z.object({key,auctionId:id.optional(),version,body:draftBodySchema}).strict(),
  publish:z.object({key,auctionId:id,version}).strict(),
  fee:z.object({key,auctionId:id,version,feePoints:points,reason:text(1000)}).strict(),
  deadline:z.object({key,auctionId:id,version,endsAt:z.iso.datetime(),reason:text(1000)}).strict(),
  presentation:z.object({key,auctionId:id,version,title:text(120),titleAm:localized(120),description:text(1500),descriptionAm:localized(1500),condition:text(100),conditionAm:localized(100),imageIds:z.array(id).min(1).max(8),reason:text(1000)}).strict(),
  deleteDraft:z.object({key,auctionId:id,confirmation:text(100),reason:text(1000)}).strict(),
  deleteProduct:z.object({key,id,version,confirmation:text(120),reason:text(1000)}).strict(),
  removeCancelled:z.object({key,auctionId:id,version,confirmation:text(100),reason:text(1000)}).strict(),
  cancel:z.object({key,auctionId:id,reason:text(1000),confirmation:text(100),impactHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  replace:z.object({key,auctionId:id}).strict(),
};
export type AdminAction=keyof typeof schemas;
export const homeContentSchema=z.object({headline:text(90),lead:text(350),headlineAm:text(90).optional(),leadAm:text(350).optional()}).strict();
export const faqContentSchema=z.object({items:z.array(z.object({question:text(160),answer:text(1500),questionAm:text(160).optional(),answerAm:text(1500).optional()}).strict()).max(30)}).strict();
const asJson=(value:unknown)=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item)) as Prisma.InputJsonValue;
async function lockAuction(tx:Prisma.TransactionClient,auctionId:string){const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;if(!rows.length)throw new AdminError(404,'Auction not found.')}
export async function cancellationImpact(tx:Prisma.TransactionClient,auctionId:string) {
  const auction=await tx.auction.findUniqueOrThrow({where:{id:auctionId},select:{id:true,code:true,status:true,publishedAt:true,acceptedBidCount:true,terms:{select:{ruleVersion:true}},settlement:{select:{id:true}},result:{select:{id:true}}}});
  if(!auction.publishedAt||!['LIVE','SCHEDULED'].includes(auction.status)||auction.settlement||auction.result)throw new AdminError(409,'Only an unsettled published auction can be cancelled.');
  const [fees,holds]=await Promise.all([tx.bid.groupBy({by:['userId'],where:{auctionId},_sum:{feePoints:true},_count:{id:true}}),tx.auctionHold.findMany({where:{auctionId},select:{points:true,wallet:{select:{userId:true}}}})]);
  const participants=new Map<string,{userId:string;heldPoints:string;feeRefund:string;acceptedBids:number}>();
  for(const row of fees)participants.set(row.userId,{userId:row.userId,heldPoints:'0',feeRefund:isSubmissionFeeOnly(auction.terms?.ruleVersion)?'0':(row._sum.feePoints??0n).toString(),acceptedBids:row._count.id});
  for(const hold of holds){const previous=participants.get(hold.wallet.userId)??{userId:hold.wallet.userId,heldPoints:'0',feeRefund:'0',acceptedBids:0};previous.heldPoints=hold.points.toString();participants.set(previous.userId,previous)}
  const rows=[...participants.values()].sort((a,b)=>a.userId<b.userId?-1:a.userId>b.userId?1:0);
  const impact={auctionId,code:auction.code,affectedBidders:fees.length,acceptedBids:auction.acceptedBidCount,heldPoints:rows.reduce((sum,row)=>sum.add(row.heldPoints),new Prisma.Decimal(0)).toString(),feeRefund:rows.reduce((sum,row)=>sum.add(row.feeRefund),new Prisma.Decimal(0)).toString(),participants:rows};
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
  const min=new Prisma.Decimal(body.minPoints),step=new Prisma.Decimal(body.stepPoints);
  if(!min.eq(1)||!step.eq('0.01'))errors.push('Minimum bid number must be 1.00 with 0.01 steps.');
  return {auction,body,product,errors,now};
}
export async function adminMutation(client:PrismaClient,headers:Headers,action:AdminAction,raw:unknown) {
  if(!Object.hasOwn(schemas,action))throw new AdminError(404,'Unknown admin command.');
  const highRisk=['cancel','publish','fee','deadline','presentation','removeCancelled'].includes(action);
  const input=schemas[action].parse(raw),owner=await requireAdmin(client,headers,{permission:highRisk?'cancel':'catalog'}),hash=digest(JSON.stringify({action,input}));
  // All auction writes acquire the auction row BEFORE staff/idempotency and wallet
  // locks. The unchanged cancellation command then locks wallet keys in stable order.
  const receipt=await client.$transaction(async tx=>{
    if('auctionId' in input&&input.auctionId)await lockAuction(tx,input.auctionId);
    const operationKey=`${owner.id}:${input.key}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`admin:${operationKey}`},0))`;
    const actor=await requireAdmin(tx,headers,{lock:true,fresh:highRisk,permission:highRisk?'cancel':'catalog'});
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
      const endsAt=new Date(body.endsAt);
      await tx.auctionTerms.create({data:{auctionId:data.auctionId,ruleVersion:RULE_V4,minParticipants:V2_MIN_PARTICIPANTS,minPoints:new Prisma.Decimal(body.minPoints),maxPoints:null,stepPoints:new Prisma.Decimal(body.stepPoints),entryFeePoints:new Prisma.Decimal(body.entryFeePoints),maxDistinctBids:100,noWinnerTerms:V2_FALLBACK_TERMS+" "+V4_NUMBER_TERMS,cancellationTerms:V4_CANCELLATION_TERMS,fulfillmentSnapshot:body.fulfillmentSummary,publishedEndsAt:endsAt,maxExtensionMinutes:body.maxExtensionMinutes,allowPaidShortening:body.allowPaidShortening,shortenNoticeMinutes:body.shortenNoticeMinutes}});
      await tx.auctionFeeRevision.create({data:{auctionId:data.auctionId,version:1,feePoints:new Prisma.Decimal(body.entryFeePoints),effectiveAt:checked.now,actorId:actor.id,reason:'Initial submission fee',operationKey:`${operationKey}:fee`}});
      const presentation={title:p.title,titleAm:p.titleAm,description:p.description,descriptionAm:p.descriptionAm,condition:p.condition,conditionAm:p.conditionAm,images:p.images.map(image=>({path:image.path,alt:image.alt,sourceType:image.sourceType,sourceCredit:image.sourceCredit}))};
      const auction=await tx.auction.update({where:{id:data.auctionId},data:{productId:p.id,categoryId:p.categoryId,isDemo:p.isDemo,isSettlementFixture:p.isDemo&&demoBidAllowed(process.env),startsAt:new Date(body.startsAt),endsAt,publishedAt:checked.now,status:'SCHEDULED',featured:body.featured,fulfillmentSummary:body.fulfillmentSummary,fulfillmentSummaryAm:body.fulfillmentSummaryAm||null,fulfillmentRegion:body.fulfillmentRegion,fulfillmentRegionAm:body.fulfillmentRegionAm||null,presentation:asJson(presentation)}});target=auction.id;await queueGlobal(tx,`global:published:${data.auctionId}`,'AUCTION_PUBLISHED',{auctionId:data.auctionId});
      receipt={auctionId:target,code:auction.code,status:auction.status,isDemo:auction.isDemo};
    }else if(action==='fee'){
      const data=schemas.fee.parse(input),auction=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1},settlement:{select:{id:true}},result:{select:{id:true}}}});
      if(auction.controlVersion!==data.version)throw new AdminError(409,'Auction controls changed. Reload before saving.');
      if(!auction.terms||!auction.publishedAt||!auction.endsAt||auction.endsAt<=actor.now||!['LIVE','SCHEDULED'].includes(auction.status)||auction.settlement||auction.result)throw new AdminError(409,'Fees can change only for an open, unsettled published auction.');
      const current=auction.feeRevisions[0];if(!current)throw new AdminError(409,'The published fee schedule is missing.');
      const nextFee=new Prisma.Decimal(data.feePoints);if(!isSubmissionFeeOnly(auction.terms.ruleVersion)&&!nextFee.isZero())throw new AdminError(422,'This auction uses legacy bid holds. Create a fee-only replacement before adding a submission fee.');if(nextFee.eq(current.feePoints))throw new AdminError(422,'Enter a different submission fee.');
      const nextVersion=current.version+1,controlVersion=auction.controlVersion+1;
      const revision=await tx.auctionFeeRevision.create({data:{auctionId:auction.id,version:nextVersion,feePoints:nextFee,effectiveAt:actor.now,actorId:actor.id,reason:data.reason,operationKey}});
      await tx.auctionControlRevision.create({data:{auctionId:auction.id,version:controlVersion,kind:'FEE',before:{version:current.version,feePoints:current.feePoints.toString()},after:{version:revision.version,feePoints:revision.feePoints.toString(),effectiveAt:actor.now.toISOString()},actorId:actor.id,reason:data.reason,operationKey}});
      await tx.auction.update({where:{id:auction.id},data:{controlVersion}});target=auction.id;receipt={auctionId:auction.id,controlVersion,feeVersion:revision.version,feePoints:revision.feePoints.toString(),effectiveAt:actor.now.toISOString()};
    }else if(action==='deadline'){
      const data=schemas.deadline.parse(input),auction=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{terms:true,settlement:{select:{id:true}},result:{select:{id:true}}}});
      if(auction.controlVersion!==data.version)throw new AdminError(409,'Auction controls changed. Reload before saving.');
      if(!auction.terms||!auction.publishedAt||!auction.endsAt||auction.endsAt<=actor.now||!['LIVE','SCHEDULED'].includes(auction.status)||auction.settlement||auction.result)throw new AdminError(409,'The deadline can change only for an open, unsettled published auction.');
      const next=new Date(data.endsAt),previous=auction.endsAt;if(next.getTime()===previous.getTime())throw new AdminError(422,'Enter a different deadline.');
      if(next.getTime()<actor.now.getTime()+5*60000)throw new AdminError(422,'The new deadline must be at least five minutes in the future.');
      if(auction.startsAt&&next<=auction.startsAt)throw new AdminError(422,'The new deadline must be after the auction starts.');
      const publishedEnd=auction.terms.publishedEndsAt??previous,maxEnd=new Date(publishedEnd.getTime()+auction.terms.maxExtensionMinutes*60000);
      if(next>maxEnd)throw new AdminError(422,`The published policy permits extension only until ${maxEnd.toISOString()}.`);
      if(next<previous&&auction.acceptedBidCount>0){if(!auction.terms.allowPaidShortening)throw new AdminError(422,'The published policy does not permit shortening after bids.');const notice=auction.terms.shortenNoticeMinutes*60000;if(next.getTime()<actor.now.getTime()+notice)throw new AdminError(422,`Bidders must retain at least ${auction.terms.shortenNoticeMinutes} minutes of notice.`)}
      const controlVersion=auction.controlVersion+1;
      const retired=await retireAuctionEndingAlerts(tx,auction.id,actor.now);
      await tx.auctionControlRevision.create({data:{auctionId:auction.id,version:controlVersion,kind:'DEADLINE',before:{endsAt:previous.toISOString()},after:{endsAt:next.toISOString()},actorId:actor.id,reason:data.reason,operationKey}});
      await tx.auction.update({where:{id:auction.id},data:{endsAt:next,controlVersion,nextCloseAttemptAt:null,closeErrorCode:null}});target=auction.id;receipt={auctionId:auction.id,controlVersion,endsAt:next.toISOString(),...retired};
    }else if(action==='presentation'){
      const data=schemas.presentation.parse(input),auction=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{product:{include:{images:{orderBy:{sortOrder:'asc'}}}},settlement:{select:{id:true}},result:{select:{id:true}}}});
      if(auction.controlVersion!==data.version)throw new AdminError(409,'Auction controls changed. Reload before saving.');
      if(!auction.publishedAt||!['LIVE','SCHEDULED'].includes(auction.status)||auction.settlement||auction.result||!auction.product)throw new AdminError(409,'Presentation can change only for an open, unsettled published auction.');
      if(new Set(data.imageIds).size!==data.imageIds.length)throw new AdminError(422,'Duplicate images are not allowed.');
      const media=await tx.managedMedia.findMany({where:{id:{in:data.imageIds}},select:{id:true,sourceType:true,sourceCredit:true}});if(media.length!==data.imageIds.length)throw new AdminError(422,'Use uploaded validated images.');
      const current=auction.presentation??{title:auction.product.title,titleAm:auction.product.titleAm,description:auction.product.description,descriptionAm:auction.product.descriptionAm,condition:auction.product.condition,conditionAm:auction.product.conditionAm,images:auction.product.images.map(image=>({path:image.path,alt:image.alt,sourceType:image.sourceType,sourceCredit:image.sourceCredit}))};
      const presentation={title:data.title,titleAm:data.titleAm||null,description:data.description,descriptionAm:data.descriptionAm||null,condition:data.condition,conditionAm:data.conditionAm||null,images:data.imageIds.map(mediaId=>{const image=media.find(item=>item.id===mediaId)!;return {path:`/api/media/${image.id}`,alt:data.title,sourceType:image.sourceType,sourceCredit:image.sourceCredit}})};
      const controlVersion=auction.controlVersion+1;
      await tx.auctionControlRevision.create({data:{auctionId:auction.id,version:controlVersion,kind:'PRESENTATION',before:asJson(current),after:asJson(presentation),actorId:actor.id,reason:data.reason,operationKey}});
      await tx.auction.update({where:{id:auction.id},data:{presentation:asJson(presentation),controlVersion}});target=auction.id;receipt={auctionId:auction.id,controlVersion,presentation};
    }else if(action==='deleteDraft'){
      const data=schemas.deleteDraft.parse(input),auction=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{draft:true,_count:{select:{bids:true,holds:true,feeRevisions:true,controlRevisions:true}}}});
      if(data.confirmation!==auction.code)throw new AdminError(422,'Type the exact auction code to delete this draft.');
      if(auction.status!=='DRAFT'||auction.publishedAt||!auction.draft||auction._count.bids||auction._count.holds||auction._count.feeRevisions||auction._count.controlRevisions)throw new AdminError(409,'Only an unused unpublished draft can be deleted.');
      await tx.auctionDraft.delete({where:{auctionId:auction.id}});await tx.auction.delete({where:{id:auction.id}});target=auction.id;receipt={auctionId:auction.id,deleted:true,reason:data.reason};
    }else if(action==='deleteProduct'){
      const data=schemas.deleteProduct.parse(input);await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${data.id} FOR UPDATE`;const product=await tx.product.findUniqueOrThrow({where:{id:data.id},include:{_count:{select:{auctions:true}}}});
      if(product.version!==data.version)throw new AdminError(409,'Product changed. Reload before deleting.');if(data.confirmation!==product.title)throw new AdminError(422,'Type the exact product title to delete it.');if(product._count.auctions)throw new AdminError(409,'Products linked to any auction remain as audit evidence. Hide the product or create a replacement.');
      await tx.productImage.deleteMany({where:{productId:product.id}});await tx.product.delete({where:{id:product.id}});target=product.id;receipt={productId:product.id,deleted:true,reason:data.reason};
    }else if(action==='removeCancelled'){
      const data=schemas.removeCancelled.parse(input),auction=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{settlement:{select:{outcome:true}}}});
      if(auction.controlVersion!==data.version)throw new AdminError(409,'Auction controls changed. Reload before saving.');if(data.confirmation!==auction.code)throw new AdminError(422,'Type the exact auction code to remove its public page.');if(auction.status!=='CANCELLED'||auction.settlement?.outcome!=='CANCELLED')throw new AdminError(409,'Only a committed cancelled auction can be removed from public discovery.');
      const controlVersion=auction.controlVersion+1;await tx.auctionControlRevision.create({data:{auctionId:auction.id,version:controlVersion,kind:'PRESENTATION',before:{publicSlug:auction.slug,featured:auction.featured},after:{publicSlug:null,featured:false},actorId:actor.id,reason:data.reason,operationKey}});await tx.auction.update({where:{id:auction.id},data:{slug:null,featured:false,controlVersion}});target=auction.id;receipt={auctionId:auction.id,removedFromPublic:true,reason:data.reason};
    }else if(action==='cancel'){
      const data=schemas.cancel.parse(input),impact=await cancellationImpact(tx,data.auctionId);
      if(data.confirmation!==impact.code)throw new AdminError(422,'Type the exact auction code to confirm cancellation.');
      if(data.impactHash!==impact.impactHash)throw new AdminError(409,'Cancellation impact changed. Review the new preview before confirming.');
      const settled=await cancelAuctionInTransaction(tx,{auctionId:data.auctionId,actor:{id:actor.id,permission:'auction:cancel'},reason:data.reason,key:data.key});
      const retired=await retireAuctionPromotions(tx,data.auctionId,actor.now);
      target=data.auctionId;receipt={auctionId:target,code:impact.code,status:settled.outcome,heldReleased:impact.heldPoints,feesRefunded:impact.feeRefund,affectedBidders:impact.affectedBidders,...retired};
    }else if(action==='replace'){
      const data=schemas.replace.parse(input),original=await tx.auction.findUniqueOrThrow({where:{id:data.auctionId},include:{terms:true,draft:true}});
      if(original.status!=='CANCELLED'||!original.terms||!original.productId)throw new AdminError(409,'Cancel the published auction before creating its replacement.');
      const suffix=randomUUID().slice(0,12),now=actor.now,body={productId:original.productId,startsAt:new Date(now.getTime()+3600000).toISOString(),endsAt:new Date(now.getTime()+86400000).toISOString(),minPoints:original.terms.minPoints.toString(),stepPoints:original.terms.stepPoints.toString(),entryFeePoints:original.terms.entryFeePoints.toString(),fulfillmentSummary:original.fulfillmentSummary!,fulfillmentSummaryAm:original.fulfillmentSummaryAm??'',fulfillmentRegion:original.fulfillmentRegion!,fulfillmentRegionAm:original.fulfillmentRegionAm??'',featured:original.featured,maxExtensionMinutes:original.terms.maxExtensionMinutes,allowPaidShortening:original.terms.allowPaidShortening,shortenNoticeMinutes:original.terms.shortenNoticeMinutes};
      const replacement=await tx.auction.create({data:{code:`LW-${suffix.toUpperCase()}`,slug:`lowin-${suffix}`,isDemo:original.isDemo,draft:{create:{body}}}});target=replacement.id;receipt={auctionId:target,replaces:original.id};
    }
    await tx.adminAudit.create({data:{actorId:actor.id,action:action.toUpperCase(),target,operationKey,requestHash:hash,details:{receipt:asJson(receipt)}}});return receipt;
  },{timeout:120000,maxWait:15000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  if(['category','product','deleteProduct','content','publish','fee','deadline','presentation','removeCancelled','cancel'].includes(action))await clearPublicDataCache();
  return receipt;
}
export async function adminRead(client:PrismaClient,headers:Headers,path:string[],params=new URLSearchParams()) {
  if(sectionPermission[path[0]])return opsRead(client,headers,path,params);
  const actor=await requireAdmin(client,headers);
  if(path[0]==='support')throw new AdminError(404,'Admin resource not found.');
  if(path[0]==='me')return {role:actor.role,permissions:permissions(actor.role),expiresAt:actor.expiresAt,mfaAt:actor.mfaAt};
  if(path[0]!=='dashboard'){const permission=path[0]==='reconciliation'||path[2]==='proof'?'audit':path[2]==='impact'?'cancel':'catalog';assertPermission(actor.role,permission)}
  if(path[0]==='dashboard')return readOverview(client,actor);
  if(path[0]==='categories')return client.category.findMany({orderBy:{name:'asc'}});
  if(path[0]==='products'&&path[1])return client.product.findUniqueOrThrow({where:{id:id.parse(path[1])},include:{images:true,category:{select:{name:true}}}});
  if(path[0]==='products'){const {page,q,status,category}=pageInput(params),where={...(q?{title:{contains:q,mode:'insensitive' as const}}:{}),...(category?{categoryId:category}:{}),...(status==='VISIBLE'?{visible:true}:status==='HIDDEN'?{visible:false}:{})},total=await client.product.count({where});return {items:await client.product.findMany({where,include:{images:true,category:{select:{name:true}},_count:{select:{auctions:{where:{publishedAt:{not:null}}}}}},orderBy:[{title:'asc'},{id:'asc'}],take:25,skip:(page-1)*25}),total,page,totalPages:Math.ceil(total/25)}}
  if(path[0]==='content')return client.siteContent.findMany();
  if(path[0]==='reconciliation')return {drift:asJson(await reconcile(client)),checkedAt:actor.now.toISOString()};
  if(path[0]==='auctions'&&!path[1])return auctionList(client,actor.now,pageInput(params));
  if(path[0]==='auctions'&&path[1]){
    const auctionId=id.parse(path[1]);
    if(path[2]==='impact')return client.$transaction(async tx=>{await lockAuction(tx,auctionId);await requireAdmin(tx,headers);return cancellationImpact(tx,auctionId)});
    if(path[2]==='preflight')return client.$transaction(async tx=>{const {auction,body,product,errors,now}=await publicationPreflight(tx,auctionId);return {auctionId,code:auction.code,version:auction.draft!.version,body,product,errors,serverNow:now.toISOString(),ready:errors.length===0}});
    if(path[2]==='proof'){
      const settlement=await client.auctionSettlement.findUnique({where:{auctionId},include:{movements:true,winner:{select:{id:true,name:true}},auction:{select:{status:true,code:true,slug:true,presentation:true,product:{select:{title:true,images:{select:{path:true,alt:true},take:1}}}}}}});
      if(!settlement||!['CLOSED','CANCELLED'].includes(settlement.auction.status))throw new AdminError(409,'Proof and participant journals are available only after close or cancellation.');
      const operationIds=settlement.movements.flatMap(m=>[m.chargeOperationId,m.releaseOperationId,m.refundOperationId].filter((value):value is string=>!!value));
      const [journals,holds,wallets]=await Promise.all([client.journal.findMany({where:{operationId:{in:operationIds}},include:{postings:{include:{account:{select:{name:true,kind:true}}}}}}),client.auctionHold.findMany({where:{auctionId}}),client.wallet.findMany({where:{id:{in:settlement.movements.map(m=>m.walletId)}},select:{id:true,accounts:{select:{kind:true,balance:true}}}})]);
      const participants=await client.user.findMany({where:{id:{in:settlement.movements.map(m=>m.userId)}},select:{id:true,name:true}});
      return asJson({settlement,journals,holds,wallets,participants});
    }
    if(path[2])throw new AdminError(404,'Admin resource not found.');
    const auction=await client.auction.findUniqueOrThrow({where:{id:auctionId},select:{id:true,code:true,slug:true,status:true,isDemo:true,startsAt:true,endsAt:true,publishedAt:true,featured:true,controlVersion:true,presentation:true,fulfillmentSummary:true,fulfillmentSummaryAm:true,fulfillmentRegion:true,fulfillmentRegionAm:true,closeErrorCode:true,closeAttempts:true,nextCloseAttemptAt:true,product:{include:{images:true,category:true}},terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}]},controlRevisions:{orderBy:[{createdAt:'desc'},{version:'desc'}]},draft:true,settlement:{select:{ruleVersion:true,outcome:true,completedAt:true,winningPoints:true,decision:true,winner:{select:{id:true,name:true}}}},result:{select:{outcome:true,isDemo:true}}}});const counts=await client.$queryRaw<{participants:bigint;bids:bigint}[]>`SELECT COUNT(DISTINCT "userId") AS participants, COUNT(*) AS bids FROM "Bid" WHERE "auctionId"=${auctionId}`;return asJson({...auction,displayStatus:displayAuctionStatus(auction,actor.now),participants:Number(counts[0].participants),acceptedBids:Number(counts[0].bids),serverNow:actor.now.toISOString()});
  }
  throw new AdminError(404,'Admin resource not found.');
}
