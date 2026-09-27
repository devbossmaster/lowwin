import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ensureWallet } from './ledger';
import { adjustAuctionHoldInTransaction } from './holds';

/** Internal composition only. The caller holds the auction lock and ALL wallet
 * advisory keys in ascending user-id order. Never commit a participant alone. */
export async function settleWalletInTransaction(tx:Prisma.TransactionClient,input:{
  settlementId:string;auctionId:string;userId:string;charge:bigint;refund:bigint;feeJournalIds:string[];
}) {
  const {settlementId,auctionId,userId,charge,refund,feeJournalIds}=input;
  const wallet=await ensureWallet(tx,userId);
  const accounts=await tx.ledgerAccount.findMany({where:{walletId:wallet.id}});
  const available=accounts.find(account=>account.kind==='AVAILABLE')!;
  const held=accounts.find(account=>account.kind==='HELD')!;
  const hold=await tx.auctionHold.findUnique({where:{walletId_auctionId:{walletId:wallet.id,auctionId}}});
  const holdBefore=hold?.points??0n;
  if(charge<0n||refund<0n||holdBefore<charge)throw new Error('SETTLEMENT_HOLD_MISMATCH');
  const reference=`settlement:${settlementId}:auction:${auctionId}`;
  let chargeOperationId:string|null=null,releaseOperationId:string|null=null,refundOperationId:string|null=null;
  if(charge>0n){
    chargeOperationId=randomUUID();
    const target=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:settlement'}});
    const result={settlementId,auctionId,chargedPoints:charge.toString()};
    await tx.operation.create({data:{id:chargeOperationId,userId,scope:'AUCTION_WIN_CHARGE',key:settlementId,requestHash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result}});
    await tx.auctionHold.update({where:{id:hold!.id},data:{points:holdBefore-charge}});
    await tx.journal.create({data:{operationId:chargeOperationId,kind:'AUCTION_WIN_CHARGE',reference,postings:{create:[{accountId:held.id,delta:-charge},{accountId:target.id,delta:charge}]}}});
  }
  const release=holdBefore-charge;
  if(release>0n){
    const adjustment=await adjustAuctionHoldInTransaction(tx,{userId,auctionId,direction:'RELEASE',points:release.toString(),key:`settlement:${settlementId}`,reference});
    releaseOperationId=adjustment.operationId;
  }
  if(refund>0n){
    refundOperationId=randomUUID();
    const fees=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:fees'}});
    const result={settlementId,auctionId,refundedFees:refund.toString(),feeJournalIds};
    await tx.operation.create({data:{id:refundOperationId,userId,scope:'AUCTION_FEE_REFUND',key:settlementId,requestHash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result}});
    await tx.journal.create({data:{operationId:refundOperationId,kind:'AUCTION_FEE_REFUND',reference,postings:{create:[{accountId:fees.id,delta:-refund},{accountId:available.id,delta:refund}]}}});
  }
  return {id:randomUUID(),userId,walletId:wallet.id,holdBefore,chargedPoints:charge,releasedPoints:release,refundedFees:refund,chargeOperationId,releaseOperationId,refundOperationId};
}
