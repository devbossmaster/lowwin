import {Prisma,type PrismaClient} from '@prisma/client';
import {AdminError} from './errors';
import type {CampaignPayload} from '../notifications/campaigns';

export const STOPPED='CAMPAIGN_STOPPED';
export async function stopBroadcast(tx:Prisma.TransactionClient,id:string){
 const row=await tx.outbox.findUnique({where:{id}}),p=row?.payload as CampaignPayload|undefined;
 if(!row||row.kind!=='GLOBAL_CAMPAIGN'||p?.deliveryKind!=='BROADCAST'||p.rootKey!==row.key||!row.key.startsWith('broadcast:'))throw new AdminError(404,'Broadcast not found.');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${row.key}`},0))`;
 // Content stays immutable. The root marker also blocks future expansion/retries.
 await tx.outbox.update({where:{id},data:{state:'SKIPPED',lastError:STOPPED}});
 const remaining=await tx.outbox.updateMany({where:{key:{startsWith:row.key+':'},state:'PENDING'},data:{state:'SKIPPED',lastError:STOPPED}});
 return {id,stopped:true,remainingStopped:remaining.count};
}
export async function broadcastHistory(client:PrismaClient,{page,q}:{page:number;q:string}){
 const where=Prisma.sql`kind='GLOBAL_CAMPAIGN' AND payload->>'deliveryKind'='BROADCAST' AND payload->>'rootKey'=key AND starts_with(key,'broadcast:') ${q?Prisma.sql`AND (payload->>'body' ILIKE ${'%'+q+'%'} OR key ILIKE ${'%'+q+'%'})`:Prisma.empty}`;
 const [roots,count]=await Promise.all([client.$queryRaw<{id:string;key:string;payload:CampaignPayload;createdAt:Date;lastError:string|null}[]>(Prisma.sql`SELECT id,key,payload,"createdAt","lastError" FROM "Outbox" WHERE ${where} ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET ${(page-1)*25}`),client.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) AS count FROM "Outbox" WHERE ${where}`)]);
 const progress=roots.length?await client.$queryRaw<{id:string;sent:bigint;pending:bigint;skipped:bigint;failed:bigint;batches:bigint}[]>(Prisma.sql`SELECT r.id,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='SENT') AS sent,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='PENDING') AS pending,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='SKIPPED') AS skipped,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='FAILED') AS failed,
 COUNT(*) FILTER(WHERE o.kind='GLOBAL_CAMPAIGN' AND o.state='PENDING') AS batches
 FROM "Outbox" r LEFT JOIN "Outbox" o ON o.id=r.id OR starts_with(o.key,r.key||':') WHERE r.id IN (${Prisma.join(roots.map(r=>r.id))}) GROUP BY r.id`):[];
 const slugs=roots.map(r=>r.payload.href?.split('/')[2]).filter((s):s is string=>!!s&&s!=='all'&&!/^\d+$/.test(s));
 const auctions=slugs.length?await client.auction.findMany({where:{slug:{in:slugs}},select:{slug:true,publicCode:true}}):[];
 const items=roots.map(r=>{const counts=progress.find(c=>c.id===r.id)!,sent=Number(counts.sent),pending=Number(counts.pending),skipped=Number(counts.skipped),failed=Number(counts.failed),batches=Number(counts.batches),code=r.payload.href?.split('/')[2];return {id:r.id,text:r.payload.body??'',imageId:r.payload.imageId??null,auctionCode:code&&/^\d+$/.test(code)?code:String(auctions.find(a=>a.slug===code)?.publicCode??''),createdAt:r.createdAt,sent,pending,skipped,failed,state:r.lastError===STOPPED?'STOPPED':pending||batches?sent?'SENDING':'QUEUED':failed?'NEEDS_ATTENTION':'COMPLETED',canStop:r.lastError!==STOPPED&&!!(pending||batches)}});
 return {items,total:Number(count[0].count),page,totalPages:Math.ceil(Number(count[0].count)/25)};
}
