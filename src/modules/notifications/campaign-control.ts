import type {Outbox,Prisma} from '@prisma/client';
import {historyDeliveryKinds} from './history-scope';

export const CAMPAIGN_STOPPED='CAMPAIGN_STOPPED';
export const campaignLockKey=(rootKey:string)=>`broadcast:${rootKey}`;

export function campaignRootKey(row:Pick<Outbox,'kind'|'key'|'payload'>){
 const payload=row.payload as {rootKey?:string;deliveryKind?:string}|null;
 if(row.kind==='AUCTION_FINALIZED')return row.key;
 const kind=row.kind==='GLOBAL_CAMPAIGN'?payload?.deliveryKind:row.kind;
 if(!kind||!historyDeliveryKinds.includes(kind))return null;
 if(payload?.rootKey)return payload.rootKey;
 const recipientSuffix=row.key.lastIndexOf(':user:');
 return row.kind==='BROADCAST'&&recipientSuffix>=0?row.key.slice(0,recipientSuffix):row.key;
}

export async function campaignStopped(tx:Prisma.TransactionClient,rootKey:string){
 return (await tx.outbox.findUnique({where:{key:rootKey},select:{lastError:true}}))?.lastError===CAMPAIGN_STOPPED;
}
