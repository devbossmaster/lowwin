import {Prisma,type PrismaClient} from '@prisma/client';
import {walletBidsEnabled} from './policy';
import {depositBonusStorageReady} from './deposit-bonus';

type WalletReader=Pick<PrismaClient,'$queryRaw'>;
/** One MVCC snapshot pairs the balance with the real wallet-state revision.
 * Every ledger/hold writer advances WalletHoldGuard under its database lock. */
export async function readWalletProjection(client:WalletReader,userId:string){
 const ready=await depositBonusStorageReady(client);
 const bonusJoin=ready?Prisma.sql`LEFT JOIN LATERAL (
  SELECT COALESCE(sum(l."amountCents"-COALESCE(u.used,0)),0)/100::numeric AS amount,min(l."expiresAt") AS "expiresAt"
  FROM "DepositBonusLot" l LEFT JOIN LATERAL(SELECT sum("amountCents") AS used FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId") u ON true
  WHERE l."userId"=w."userId" AND l."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND l."amountCents">COALESCE(u.used,0)
  AND NOT EXISTS(SELECT 1 FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId")
 ) bonus ON true`:Prisma.sql`LEFT JOIN LATERAL(SELECT 0::numeric AS amount,NULL::timestamp AS "expiresAt") bonus ON true`;
 const rows=await client.$queryRaw<Array<{available:Prisma.Decimal|null;held:Prisma.Decimal|null;revision:string;cashAvailable?:Prisma.Decimal;bonusAvailable?:Prisma.Decimal;bonusExpiresAt?:Date|null}>>`
  SELECT a.balance+COALESCE(bonus.amount,0) AS available,a.balance AS "cashAvailable",COALESCE(bonus.amount,0) AS "bonusAvailable",bonus."expiresAt" AS "bonusExpiresAt",h.balance AS held,COALESCE(g.revision,0)::text AS revision
  FROM "Wallet" w
  LEFT JOIN "LedgerAccount" a ON a."walletId"=w.id AND a.kind='AVAILABLE'
  LEFT JOIN "LedgerAccount" h ON h."walletId"=w.id AND h.kind='HELD'
  LEFT JOIN "WalletHoldGuard" g ON g."walletId"=w.id
  ${bonusJoin}
  WHERE w."userId"=${userId}
 `;
 const row=rows[0];
 if(row&&(row.available===null||row.held===null))throw Error('Wallet projections are incomplete.');
 return {available:row?.available?.toString()??'0',held:row?.held?.toString()??'0',cashAvailable:(row?.cashAvailable??row?.available)?.toString()??'0',bonusAvailable:row?.bonusAvailable?.toString()??'0',bonusExpiresAt:row?.bonusExpiresAt?.toISOString()??null,revision:row?.revision??'0'};
}

export type WalletBalance={available:string;held:string;cashAvailable:string;bonusAvailable:string;bonusExpiresAt:string|null;revision?:string;bidsEnabled?:boolean;currency:'ETB';topUp:{enabled:false;reason:'NOT_CONFIGURED'}};

/** Opening the header never initializes, credits or changes a wallet. */
export async function readWalletBalance(client:WalletReader,userId:string):Promise<WalletBalance>{
 return {...await readWalletProjection(client,userId),bidsEnabled:walletBidsEnabled(),currency:'ETB',topUp:{enabled:false,reason:'NOT_CONFIGURED'}};
}
