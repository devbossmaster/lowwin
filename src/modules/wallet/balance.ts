import type {PrismaClient} from '@prisma/client';

/** Opening the header never initializes, credits or changes a wallet. */
export async function readWalletBalance(client:PrismaClient,userId:string){
 const accounts=await client.ledgerAccount.findMany({where:{wallet:{userId},kind:{in:['AVAILABLE','HELD']}},select:{kind:true,balance:true}});
 const available=accounts.find(account=>account.kind==='AVAILABLE'),held=accounts.find(account=>account.kind==='HELD');
 if(accounts.length&&(!available||!held))throw Error('Wallet projections are incomplete.');
 return {available:available?.balance.toString()??'0',held:held?.balance.toString()??'0',currency:'ETB' as const,topUp:{enabled:false as const,reason:'NOT_CONFIGURED' as const}};
}
export type WalletBalance=Awaited<ReturnType<typeof readWalletBalance>>;
