import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
export type IdentityRequestLimit={scope:string;identity:string;maximum:number;windowMs?:number};
/** One atomic statement for related limits in an existing transaction. Counts
 * still roll back with that transaction; every first dispatch consumes its
 * original daily budget. Deterministic key order avoids crossed row locks. */
export async function allowIdentityRequests(client:PrismaClient|Prisma.TransactionClient,limits:readonly IdentityRequestLimit[]){
 if(!limits.length)return true;
 if(limits.length>8)throw new Error('Too many identity limits');
 const rows=limits.map(limit=>{
  const windowMs=limit.windowMs??60000;
  if(!Number.isSafeInteger(limit.maximum)||limit.maximum<1||limit.maximum>1000000||!Number.isSafeInteger(windowMs)||windowMs<1)throw new Error('Invalid identity limit');
  return {id:randomUUID(),key:`app:${limit.scope}:${createHash('sha256').update(limit.identity).digest('hex')}`,maximum:limit.maximum,windowMs};
 });
 if(new Set(rows.map(row=>row.key)).size!==rows.length)throw new Error('Duplicate identity limit');
 const [result]=await client.$queryRaw<{allowed:boolean}[]>(Prisma.sql`
  WITH limits(id,key,maximum,window_ms) AS (VALUES ${Prisma.join(rows.map(row=>Prisma.sql`(${row.id},${row.key},${row.maximum}::integer,${row.windowMs}::bigint)`))}), counted AS (
   INSERT INTO "rateLimit" AS current (id,key,count,"lastRequest")
   SELECT id,key,1,(extract(epoch FROM clock_timestamp())*1000)::bigint FROM limits ORDER BY key
   ON CONFLICT (key) DO UPDATE SET
    count=CASE WHEN current."lastRequest" < EXCLUDED."lastRequest"-(SELECT window_ms FROM limits WHERE key=EXCLUDED.key) THEN 1 ELSE LEAST(current.count+1,(SELECT maximum+1 FROM limits WHERE key=EXCLUDED.key)) END,
    "lastRequest"=CASE WHEN current."lastRequest" < EXCLUDED."lastRequest"-(SELECT window_ms FROM limits WHERE key=EXCLUDED.key) THEN EXCLUDED."lastRequest" ELSE current."lastRequest" END
   RETURNING key,count
  ) SELECT bool_and(counted.count<=limits.maximum) AS allowed FROM counted JOIN limits USING(key)`);
 return result?.allowed===true;
}
/** A conditional source can share the statement that authenticates the identity. */
export function countIdentityRequest(key:Prisma.Sql,maximum:number,windowMs:number,source=Prisma.empty){
 return Prisma.sql`
  INSERT INTO "rateLimit" (id,key,count,"lastRequest")
  SELECT ${randomUUID()},${key},1,(extract(epoch FROM clock_timestamp())*1000)::bigint ${source}
  ON CONFLICT (key) DO UPDATE SET
    count=CASE WHEN "rateLimit"."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-${windowMs} THEN 1 ELSE LEAST("rateLimit".count+1,${maximum+1}) END,
    "lastRequest"=CASE WHEN "rateLimit"."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-${windowMs} THEN (extract(epoch FROM clock_timestamp())*1000)::bigint ELSE "rateLimit"."lastRequest" END
  RETURNING count`;
}

export const userMutationLimit={scope:'mutation',maximum:60,windowMs:60000} as const;

/** Durable atomic limit keyed only by a server-verified identity, never a forwarded IP. */
export async function allowIdentityRequest(client:PrismaClient|Prisma.TransactionClient,scope:string,identity:string,maximum:number,windowMs=60000) {
 const key=`app:${scope}:${createHash('sha256').update(identity).digest('hex')}`;
 const [row]=await client.$queryRaw<{count:number}[]>(countIdentityRequest(Prisma.sql`${key}`,maximum,windowMs));
 return row.count<=maximum;
}
