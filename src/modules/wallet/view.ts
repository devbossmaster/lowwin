import { Prisma, type PrismaClient } from '@prisma/client';
export async function getWalletView(client:PrismaClient,userId:string,page=1) {
  const [wallet,journals,total]=await client.$transaction([
    client.wallet.findUnique({where:{userId},include:{accounts:true}}),
    client.journal.findMany({where:{operation:{userId}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:20,include:{postings:{include:{account:true}}}}),
    client.journal.count({where:{operation:{userId}}}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  const available=wallet?.accounts.find(account=>account.kind==='AVAILABLE')?.balance??0n;
  const held=wallet?.accounts.find(account=>account.kind==='HELD')?.balance??0n;
  return {page,total,totalPages:Math.ceil(total/20),wallet:{available:available.toString(),held:held.toString()},activity:journals.map(journal=>({
    id:journal.id,kind:journal.kind,at:journal.createdAt.toISOString(),
    availableDelta:journal.postings.filter(posting=>posting.account.walletId===wallet?.id&&posting.account.kind==='AVAILABLE').reduce((sum,posting)=>sum+posting.delta,0n).toString(),
    heldDelta:journal.postings.filter(posting=>posting.account.walletId===wallet?.id&&posting.account.kind==='HELD').reduce((sum,posting)=>sum+posting.delta,0n).toString(),
  }))};
}
