import {Prisma,type TopUpIntent} from '@prisma/client';
import {ensureWallet,seedPlatformAccounts} from '../wallet/ledger';
import {hash} from './provider';

type Transfer={reference:string;aliases:string[];amountCents:bigint;points:Prisma.Decimal;receiverSuffix:string;transferredAt:Date;evidenceHash:string};
// Both provider verification and staff review use the same immutable claim and
// balanced journal. Transfer locks are shared with automatic verification.
export async function creditTransfer(tx:Prisma.TransactionClient,t:TopUpIntent,transfer:Transfer){
 const channel=t.channel!;
 const aliases=[...new Set([transfer.reference,...transfer.aliases])].sort();
 for(const alias of aliases)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer:${channel}:${alias}`},0))`;
 const [claim,alias,adminCredit]=await Promise.all([tx.paymentClaim.findFirst({where:{channel,reference:{in:aliases}}}),tx.paymentTransferAlias.findFirst({where:{channel,alias:{in:aliases}}}),tx.adminWalletCredit.findFirst({where:{channel,reference:{in:aliases}}})]);
 if(claim||alias||adminCredit)return null;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${t.userId}`},0))`;
 await ensureWallet(tx,t.userId);await seedPlatformAccounts(tx);
 const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${t.userId}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}});
 const operation=await tx.operation.create({data:{userId:t.userId,scope:'TOPUP_CREDIT',key:t.id,requestHash:hash(`${t.id}:${transfer.reference}:${transfer.points}`),result:{intentId:t.id,credited:transfer.points.toString(),amountCents:transfer.amountCents.toString(),policyVersion:t.policyVersion}}});
 const journal=await tx.journal.create({data:{operationId:operation.id,kind:'TOPUP_CREDIT',reference:`topup:${t.id}`,postings:{create:[{accountId:issuance.id,delta:transfer.points.negated()},{accountId:available.id,delta:transfer.points}]}}});
 const saved=await tx.paymentClaim.create({data:{channel,reference:transfer.reference,intentId:t.id,userId:t.userId,amountCents:transfer.amountCents,points:transfer.points,receiverSuffix:transfer.receiverSuffix,transferredAt:transfer.transferredAt,operationId:operation.id,journalId:journal.id,evidenceHash:transfer.evidenceHash}});
 await tx.paymentTransferAlias.createMany({data:aliases.map(alias=>({channel,alias,claimId:saved.id}))});
 return journal.id;
}
