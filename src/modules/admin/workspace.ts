import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from './boundary';
import {AdminError} from './errors';
import {arifPayAvailability} from '../payments/arifpay-provider';
import {chapaAvailability} from '../payments/chapa-provider';
import {readPlayerTable,readChapaTable,readWinnerTable} from './master-table-read';
function eatDayStart(now:Date){const d=new Date(now.getTime()+3*3600000);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-3*3600000)}
const filters=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:z.string().trim().max(100).default(''),status:z.string().regex(/^[A-Z_]*$/).max(40).default(''),sort:z.enum(['newest','oldest','amount']).default('newest'),view:z.enum(['completed','unfinished','review','failed','all']).optional(),purpose:z.enum(['','TOP_UP','BID']).default('')});
export async function tableExists(client:PrismaClient,name:string){const [r]=await client.$queryRaw<{ready:boolean}[]>`SELECT to_regclass(${`public."${name}"`}) IS NOT NULL AS ready`;return r.ready}
export function gatewayStatus(raw:Record<string,string|undefined>=process.env){
 const arif=arifPayAvailability(raw),chapa=chapaAvailability(raw),selected=raw.PAYMENT_GATEWAY==='ARIFPAY'?'ArifPay':raw.PAYMENT_GATEWAY==='CHAPA'?'Chapa':null;
 const state=selected===null?'Not selected':selected==='Chapa'?chapa.enabled?`${chapa.mode==='test'?'Test':'Live'} checkout enabled`:chapa.recoveryEnabled?'Recovery only':chapa.configured?'Disabled':'Not configured':arif.enabled?'Live checkout enabled':arif.recoveryEnabled?'Recovery only':raw.ARIFPAY_API_KEY?'Disabled':'Not configured';
 return {selected,state,arifPay:{implemented:true,enabled:arif.enabled,recoveryEnabled:arif.recoveryEnabled},chapa:{implemented:true,configured:chapa.configured,enabled:chapa.enabled,recoveryEnabled:chapa.recoveryEnabled,mode:chapa.mode},callbackChecks:'Provider evidence is verified server-side. Browser return pages are not proof of payment.'};
}
export async function financialSummary(client:PrismaClient,now:Date){
 const chapa=await tableExists(client,'ChapaCheckout');
 // Do not parse SQL naming ChapaCheckout until its additive migration exists.
 // Direct BID receipts are fee payments, not a second wallet-deposit total.
 const chapaDeposits=chapa?Prisma.sql`(SELECT trunc(COALESCE(SUM(c."amountCents"),0)::numeric/100,2) FROM "ChapaCheckout" c JOIN "Journal" j ON j.id=c."creditJournalId" AND j.kind='CHAPA_RECEIPT' JOIN "Operation" o ON o.id=j."operationId" AND o.scope='CHAPA_RECEIPT' AND o."userId"=c."userId" AND o.key=c.id WHERE c.mode='live' AND c.purpose='TOP_UP' AND c.status='CREDITED' AND c.currency='ETB' AND j."createdAt"<=${now} AND o.result->>'checkoutId'=c.id AND o.result->>'mode'='live' AND o.result->>'currency'='ETB' AND o.result->>'amountCents'=c."amountCents"::text)`:Prisma.sql`0::numeric`;
 const [r]=await client.$queryRaw<{grossFees:string;discounts:string;refunds:string;netFees:string;deposits:string;available:string;held:string;count:number;todayEtb:string}[]>(Prisma.sql`
 WITH fees AS (SELECT COALESCE(SUM(b."feePoints"),0) AS gross,COALESCE(SUM(b."feePoints") FILTER(WHERE b."acceptedAt">=${eatDayStart(now)}),0) AS today,COUNT(*)::int AS count FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId" WHERE NOT a."isDemo" AND a."testRunId" IS NULL AND b."acceptedAt"<=${now}),
 adjustments AS (SELECT COALESCE(SUM(-p.delta) FILTER(WHERE j.kind='REFERRAL_DISCOUNT'),0) AS discount,COALESCE(SUM(-p.delta) FILTER(WHERE j.kind IN ('AUCTION_FEE_REFUND','AUCTION_RESET_COMPENSATION')),0) AS refund FROM "Journal" j JOIN "Operation" o ON o.id=j."operationId" JOIN "Posting" p ON p."journalId"=j.id JOIN "LedgerAccount" la ON la.id=p."accountId" JOIN "Auction" a ON a.id=o.result->>'auctionId' WHERE la.name='platform:fees' AND NOT a."isDemo" AND a."testRunId" IS NULL),
 liabilities AS (SELECT COALESCE(SUM(balance) FILTER(WHERE kind='AVAILABLE'),0) AS available,COALESCE(SUM(balance) FILTER(WHERE kind='HELD'),0) AS held FROM "LedgerAccount" WHERE "walletId" IS NOT NULL)
 SELECT fees.gross::text AS "grossFees",adjustments.discount::text AS discounts,adjustments.refund::text AS refunds,(fees.gross-adjustments.discount-adjustments.refund)::text AS "netFees",fees.today::text AS "todayEtb",fees.count,((SELECT trunc(COALESCE(SUM(c."amountCents"),0)/100,2) FROM "PaymentClaim" c JOIN "TopUpIntent" t ON t.id=c."intentId" WHERE t.status='CREDITED' AND t."caseState"<>'REVERSED')+${chapaDeposits})::text AS deposits,liabilities.available::text,liabilities.held::text FROM fees,adjustments,liabilities`);
 return r;
}
export async function workspaceRead(client:PrismaClient,headers:Headers,section:string,params:URLSearchParams){
 if(!['players','transactions','winners','media'].includes(section))throw new AdminError(404,'Workspace resource not found.');
 const actor=await requireAdmin(client,headers),f=filters.parse(Object.fromEntries(params));
 const allowed=section==='media'?['OWNER','CATALOG_MANAGER']:section==='players'?['OWNER','SUPPORT','AUDITOR','PAYMENTS_OPERATOR']:section==='winners'?['OWNER','FULFILLMENT','AUDITOR']:['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT'];
 if(!allowed.includes(actor.role))throw new AdminError(403,'Your staff role cannot access this workspace.');
 if(section==='players')return readPlayerTable(client,actor,f);
 if(section==='winners')return readWinnerTable(client,actor,f);
 if(section==='transactions')return {...await readChapaTable(client,actor,f),gateway:gatewayStatus()};
 const where={purpose:'CATALOG',...(f.q?{sourceCredit:{contains:f.q,mode:'insensitive' as const}}:{})};
 const [items,total]=await Promise.all([client.managedMedia.findMany({where,select:{id:true,mime:true,sourceType:true,sourceCredit:true,createdAt:true},orderBy:[{createdAt:f.sort==='oldest'?'asc':'desc'},{id:f.sort==='oldest'?'asc':'desc'}],skip:(f.page-1)*25,take:25}),client.managedMedia.count({where})]);
 return {items,total,page:f.page,totalPages:Math.ceil(total/25),serverNow:actor.now.toISOString()};
}
