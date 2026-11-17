import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {ensureWallet,seedPlatformAccounts} from './ledger';
import {adjustAuctionHoldInTransaction} from './holds';

type Refund={id:string;settlementId:string;userId:string;cashPoints:Prisma.Decimal;bonusPoints:Prisma.Decimal;holdPoints:Prisma.Decimal;auctionId:string;isDemo:boolean;testRunId:string|null};
/** A claimed row, ledger commit and completion marker share one transaction.
 * Crashes roll all three back. No Telegram/provider HTTP belongs here. */
export async function processAuctionRefund(client:PrismaClient,auctionId?:string){
 return client.$transaction(async tx=>{
  const rows=await tx.$queryRaw<Refund[]>`SELECT r.*,s."auctionId",a."isDemo",a."testRunId" FROM "AuctionRefund" r JOIN "AuctionSettlement" s ON s.id=r."settlementId" JOIN "Auction" a ON a.id=s."auctionId" WHERE r.status='PENDING' AND (${auctionId??null}::text IS NULL OR s."auctionId"=${auctionId??null}) ORDER BY r."createdAt",r.id FOR UPDATE OF a,r SKIP LOCKED LIMIT 1`;
  const r=rows[0];if(!r)return {status:'idle' as const};
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${r.userId}`},0))`;
  const wallet=await ensureWallet(tx,r.userId);await seedPlatformAccounts(tx);
  const [{now}]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  let operationId:string|null=null,releaseOperationId:string|null=null;
  if(r.holdPoints.gt(0))releaseOperationId=(await adjustAuctionHoldInTransaction(tx,{auctionId:r.auctionId,userId:r.userId,direction:'RELEASE',points:r.holdPoints.toString(),key:`v5-refund:${r.id}`,reference:`auction-refund:${r.id}`})).operationId;
  if(r.cashPoints.add(r.bonusPoints).gt(0)){
   const uses=await tx.$queryRaw<Array<{id:string;checkoutId:string;amountCents:bigint;expiresAt:Date}>>`SELECT u.id,u."checkoutId",u."amountCents",l."expiresAt" FROM "DepositBonusUse" u JOIN "DepositBonusLot" l ON l."checkoutId"=u."checkoutId" JOIN "Bid" b ON b.id=u."bidId" WHERE b."auctionId"=${r.auctionId} AND b."userId"=${r.userId} ORDER BY u.id`;
   const restored=uses.filter(u=>u.expiresAt>now).reduce((n,u)=>n+u.amountCents,0n),expired=uses.filter(u=>u.expiresAt<=now).reduce((n,u)=>n+u.amountCents,0n);
   if(!new Prisma.Decimal((restored+expired).toString()).div(100).eq(r.bonusPoints))throw Error('REFUND_BONUS_PROOF_MISMATCH');
   operationId=randomUUID();const result={refundId:r.id,settlementId:r.settlementId,auctionId:r.auctionId,cash:r.cashPoints.toString(),bonus:r.bonusPoints.toString(),bonusRestoredCents:String(restored),bonusExpiredCents:String(expired)};
   await tx.operation.create({data:{id:operationId,userId:r.userId,scope:'AUCTION_FEE_REFUND',key:r.id,requestHash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result}});
   const accounts=await tx.ledgerAccount.findMany({where:{OR:[{name:'platform:fees'},{name:'platform:issuance'},{walletId:wallet.id}]} } ),id=(name:string)=>{const account=accounts.find(a=>a.name===name);if(!account)throw Error('MISSING_REFUND_ACCOUNT');return account.id};
   const postings=[{accountId:id('platform:fees'),delta:r.cashPoints.add(r.bonusPoints).negated()},...(r.cashPoints.gt(0)?[{accountId:id(`user:${r.userId}:available`),delta:r.cashPoints}]:[]),...(restored?[{accountId:id(`user:${r.userId}:bonus`),delta:new Prisma.Decimal(String(restored)).div(100)}]:[]),...(expired?[{accountId:id('platform:issuance'),delta:new Prisma.Decimal(String(expired)).div(100)}]:[])];
   await tx.journal.create({data:{operationId,kind:'AUCTION_FEE_REFUND',reference:`auction-refund:${r.id}`,postings:{create:postings}}});
   for(const u of uses)await tx.$executeRaw`INSERT INTO "DepositBonusRefund" (id,"refundId","bonusUseId","checkoutId","userId","amountCents","creditedCents","expiredCents","createdAt") VALUES (${randomUUID()},${r.id},${u.id},${u.checkoutId},${r.userId},${u.amountCents},${u.expiresAt>now?u.amountCents:0n},${u.expiresAt<=now?u.amountCents:0n},(${now} AT TIME ZONE 'UTC'))`;
  }
  await tx.$executeRaw`UPDATE "AuctionRefund" SET status='COMPLETED',"operationId"=${operationId},"releaseOperationId"=${releaseOperationId},"completedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=${r.id} AND status='PENDING'`;
  if(r.cashPoints.add(r.bonusPoints).gt(0)&&!r.isDemo&&!r.testRunId)await tx.outbox.createMany({data:[{key:`auction-refund:${r.id}:committed`,kind:'AUCTION_FEE_REFUNDED',settlementId:r.settlementId,payload:{refundId:r.id,auctionId:r.auctionId,settlementId:r.settlementId,recipientUserId:r.userId}}],skipDuplicates:true});
  return {status:'refunded' as const,refundId:r.id,auctionId:r.auctionId};
 },{maxWait:10000,timeout:30000});
}

export async function auctionRefundProgress(client:PrismaClient|Prisma.TransactionClient,auctionId:string,userId?:string){
 const [row]=await client.$queryRaw<Array<{pending:bigint;completed:bigint;cash:string;bonus:string;bonusRestored:string;bonusExpired:string}>>`SELECT count(*) FILTER(WHERE r.status='PENDING') AS pending,count(*) FILTER(WHERE r.status='COMPLETED') AS completed,COALESCE(sum(r."cashPoints") FILTER(WHERE r.status='COMPLETED'),0)::text AS cash,COALESCE(sum(r."bonusPoints") FILTER(WHERE r.status='COMPLETED'),0)::text AS bonus,COALESCE(sum(b.restored) FILTER(WHERE r.status='COMPLETED'),0)::text AS "bonusRestored",COALESCE(sum(b.expired) FILTER(WHERE r.status='COMPLETED'),0)::text AS "bonusExpired" FROM "AuctionRefund" r JOIN "AuctionSettlement" s ON s.id=r."settlementId" LEFT JOIN LATERAL(SELECT sum("creditedCents")/100 AS restored,sum("expiredCents")/100 AS expired FROM "DepositBonusRefund" WHERE "refundId"=r.id)b ON true WHERE s."auctionId"=${auctionId} AND (${userId??null}::text IS NULL OR r."userId"=${userId??null})`;
 return {pending:Number(row.pending),completed:Number(row.completed),cash:new Prisma.Decimal(row.cash).toString(),bonus:new Prisma.Decimal(row.bonus).toString(),bonusRestored:new Prisma.Decimal(row.bonusRestored).toString(),bonusExpired:new Prisma.Decimal(row.bonusExpired).toString(),status:row.pending?'pending' as const:'completed' as const};
}
