import type {Prisma,PrismaClient} from '@prisma/client';
import {walletBidsEnabled} from './policy';

type WalletReader=Pick<PrismaClient,'$queryRaw'>;
/** One MVCC snapshot pairs the balance with the real wallet-state revision.
 * Every ledger/hold writer advances WalletHoldGuard under its database lock. */
export async function readWalletProjection(client:WalletReader,userId:string){
 const rows=await client.$queryRaw<Array<{available:Prisma.Decimal|null;held:Prisma.Decimal|null;revision:string}>>`
  SELECT a.balance AS available,h.balance AS held,COALESCE(g.revision,0)::text AS revision
  FROM "Wallet" w
  LEFT JOIN "LedgerAccount" a ON a."walletId"=w.id AND a.kind='AVAILABLE'
  LEFT JOIN "LedgerAccount" h ON h."walletId"=w.id AND h.kind='HELD'
  LEFT JOIN "WalletHoldGuard" g ON g."walletId"=w.id
  WHERE w."userId"=${userId}
 `;
 const row=rows[0];
 if(row&&(row.available===null||row.held===null))throw Error('Wallet projections are incomplete.');
 return {available:row?.available?.toString()??'0',held:row?.held?.toString()??'0',revision:row?.revision??'0'};
}

export type WalletBalance={available:string;held:string;revision?:string;bidsEnabled?:boolean;currency:'ETB';topUp:{enabled:false;reason:'NOT_CONFIGURED'}};

/** Opening the header never initializes, credits or changes a wallet. */
export async function readWalletBalance(client:WalletReader,userId:string):Promise<WalletBalance>{
 return {...await readWalletProjection(client,userId),bidsEnabled:walletBidsEnabled(),currency:'ETB',topUp:{enabled:false,reason:'NOT_CONFIGURED'}};
}
