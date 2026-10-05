import {createHash,randomUUID} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
/** Durable atomic limit keyed only by a server-verified identity, never a forwarded IP. */
export async function allowIdentityRequest(client:PrismaClient|Prisma.TransactionClient,scope:string,identity:string,maximum:number,windowMs=60000) {
 const key=`app:${scope}:${createHash('sha256').update(identity).digest('hex')}`;
 const [row]=await client.$queryRaw<{count:number}[]>`
  INSERT INTO "rateLimit" (id,key,count,"lastRequest")
  VALUES (${randomUUID()},${key},1,(extract(epoch FROM clock_timestamp())*1000)::bigint)
  ON CONFLICT (key) DO UPDATE SET
    count=CASE WHEN "rateLimit"."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-${windowMs} THEN 1 ELSE LEAST("rateLimit".count+1,${maximum+1}) END,
    "lastRequest"=CASE WHEN "rateLimit"."lastRequest" < (extract(epoch FROM clock_timestamp())*1000)::bigint-${windowMs} THEN (extract(epoch FROM clock_timestamp())*1000)::bigint ELSE "rateLimit"."lastRequest" END
  RETURNING count`;
 return row.count<=maximum;
}
