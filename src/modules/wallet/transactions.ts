import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {paymentSummaryState} from '@/lib/payment-summary';
import type {TransactionRow,TransactionsPage,WalletTransactionDetail} from '@/lib/transactions';
import {PrivateApiError} from '../auth/private-api';

export const transactionsQuerySchema=z.object({page:z.coerce.number().int().min(1).max(1000).default(1),type:z.enum(['ALL','TOP_UP','BID']).default('ALL'),q:z.string().trim().max(100).default('')}).strict();
const pageSize=20;
type Row={id:string;source:'chapa'|'wallet';type:'TOP_UP'|'BID';title:string;titleAm:string|null;amount:string;completed:boolean;providerStatus:string|null;verificationState:string|null;paymentMethod:string|null;createdAt:Date;mode:string|null;fundsPreserved:boolean;auctionCode:string|null;auctionSlug:string|null;bidNumber:string|null;grossFee:string|null;journalId:string|null};
const title=Prisma.sql`COALESCE(NULLIF(a.presentation->>'title',''),p.title,'Auction')`;
const titleAm=Prisma.sql`COALESCE(NULLIF(a.presentation->>'titleAm',''),p."titleAm")`;
// Same immutable receipt calculation as the admin payment projection. A coupon
// reduces the committed fee; malformed or excessive snapshot values never do.
const netFee=Prisma.sql`CASE WHEN o.result#>>'{charge,netFeePoints}' ~ '^(0|[1-9][0-9]*)([.][0-9]{1,2})?$' THEN LEAST((o.result#>>'{charge,netFeePoints}')::numeric,b."feePoints") ELSE b."feePoints" END`;
function walletRows(userId:string,chapaConfigured:boolean){
 return Prisma.sql`SELECT b.id,'wallet'::text AS source,'BID'::text AS type,${title} AS title,${titleAm} AS "titleAm",(${netFee})::text AS amount,true AS completed,NULL::text AS "providerStatus",NULL::text AS "verificationState",'Wallet'::text AS "paymentMethod",b."acceptedAt" AS "createdAt",NULL::text AS mode,false AS "fundsPreserved",a."publicCode"::text AS "auctionCode",a.slug AS "auctionSlug",b.amount::text AS "bidNumber",b."feePoints"::text AS "grossFee",j.id AS "journalId"
 FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId" LEFT JOIN "Product" p ON p.id=a."productId"
 JOIN "Operation" o ON o.id=b."operationId" AND o.scope='BID' AND o."userId"=b."userId"
 JOIN "Journal" j ON j."operationId"=o.id AND j.kind='BID_FEE'
 WHERE b."userId"=${userId} AND NOT a."isDemo" AND a."testRunId" IS NULL
 ${chapaConfigured?Prisma.sql`AND NOT EXISTS(SELECT 1 FROM "ChapaCheckout" c WHERE c."userId"=b."userId" AND (c."bidId"=b.id OR c.receipt->'bids' @> jsonb_build_array(jsonb_build_object('id',b.id))))`:Prisma.empty}
 AND NOT EXISTS(SELECT 1 FROM "ArifPayCheckout" c WHERE c."userId"=b."userId" AND c."bidId"=b.id AND c."creditJournalId" IS NOT NULL AND c.status='BID_ACCEPTED')`;
}
function chapaRows(userId:string){
 return Prisma.sql`SELECT c.id,'chapa'::text AS source,c.purpose AS type,CASE WHEN c.purpose='TOP_UP' THEN 'Wallet top-up' ELSE ${title} END AS title,CASE WHEN c.purpose='TOP_UP' THEN NULL ELSE ${titleAm} END AS "titleAm",(c."amountCents"::numeric/100)::text AS amount,(c."creditJournalId" IS NOT NULL) AS completed,c."providerStatus",c."verificationState",c."paymentMethod",c."createdAt",c.mode,(c."creditJournalId" IS NOT NULL AND c.purpose='BID' AND c.status<>'BID_ACCEPTED') AS "fundsPreserved",a."publicCode"::text AS "auctionCode",a.slug AS "auctionSlug",NULL::text AS "bidNumber",NULL::text AS "grossFee",NULL::text AS "journalId"
 FROM "ChapaCheckout" c LEFT JOIN "Auction" a ON a.id=c."auctionId" LEFT JOIN "Product" p ON p.id=a."productId" WHERE c."userId"=${userId} AND c.purpose IN ('TOP_UP','BID')`;
}
function project(row:Row):TransactionRow{
 return {id:row.id,source:row.source,type:row.type,title:row.title,titleAm:row.titleAm,amount:new Prisma.Decimal(row.amount).toString(),direction:row.completed?(row.type==='TOP_UP'||row.fundsPreserved?'incoming':'outgoing'):'none',summary:paymentSummaryState({completed:row.completed,providerStatus:row.providerStatus,verificationState:row.verificationState}),paymentMethod:row.paymentMethod,createdAt:row.createdAt.toISOString(),...(row.source==='chapa'?{mode:row.mode==='test'?'test' as const:'live' as const,fundsPreserved:row.fundsPreserved}:{})};
}
/** A single owner-scoped, globally ordered page. Never load provider evidence,
 * entire receipt histories, contact details, or perform a query for each row. */
export async function getTransactions(client:PrismaClient,userId:string,input:unknown={}):Promise<TransactionsPage>{
 const query=transactionsQuerySchema.parse(input),chapaConfigured=process.env.CHAPA_SCHEMA_READY==='true'||process.env.CHAPA_V1_SCHEMA_READY==='true';
 const selected:Prisma.Sql[]=[];
 if(chapaConfigured)selected.push(chapaRows(userId));
 if(query.type!=='TOP_UP')selected.push(walletRows(userId,chapaConfigured));
 if(!selected.length)return {items:[],page:query.page,nextPage:null};
 const pattern='%'+query.q.replace(/[\\%_]/g,'\\$&')+'%';
 const rows=await client.$queryRaw<Row[]>(Prisma.sql`WITH transactions AS (${Prisma.join(selected,' UNION ALL ')}) SELECT * FROM transactions
 WHERE true ${query.type==='ALL'?Prisma.empty:Prisma.sql`AND type=${query.type}`}
 ${query.q?Prisma.sql`AND (title ILIKE ${pattern} OR COALESCE("titleAm",'') ILIKE ${pattern} OR id ILIKE ${pattern} OR COALESCE("auctionCode",'') ILIKE ${pattern} OR amount ILIKE ${pattern})`:Prisma.empty}
 ORDER BY "createdAt" DESC,id DESC,source ASC LIMIT ${pageSize+1} OFFSET ${(query.page-1)*pageSize}`);
 return {items:rows.slice(0,pageSize).map(project),page:query.page,nextPage:rows.length>pageSize?query.page+1:null};
}
export async function getWalletTransaction(client:PrismaClient,userId:string,id:string):Promise<WalletTransactionDetail>{
 const value=z.uuid().parse(id),rows=await client.$queryRaw<Row[]>(Prisma.sql`WITH transactions AS (${walletRows(userId,process.env.CHAPA_SCHEMA_READY==='true'||process.env.CHAPA_V1_SCHEMA_READY==='true')}) SELECT * FROM transactions WHERE id=${value} LIMIT 1`),row=rows[0];
 if(!row)throw new PrivateApiError(404,'Transaction not found.');
 return {item:{...project(row),auctionCode:row.auctionCode,auctionSlug:row.auctionSlug,bidNumber:row.bidNumber!,grossFee:row.grossFee!,discountPoints:new Prisma.Decimal(row.grossFee!).sub(row.amount).toString(),currency:'ETB',status:'BID_ACCEPTED',references:{bidId:row.id,journalId:row.journalId!}}};
}
