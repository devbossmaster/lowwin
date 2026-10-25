import {randomUUID} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';

// Retain the existing cooldown key. The unique conflict serializes concurrent
// requests in one database statement without holding an interactive transaction.
export async function allowContactRequest(client:PrismaClient|Prisma.TransactionClient,userId:string){
 const rows=await client.$queryRaw<Array<{id:string}>>`
  INSERT INTO "rateLimit" (id,key,count,"lastRequest")
  VALUES (${randomUUID()},${`own-contact-request:${userId}`},1,floor(extract(epoch FROM statement_timestamp())*1000)::bigint)
  ON CONFLICT (key) DO UPDATE SET count=1,"lastRequest"=EXCLUDED."lastRequest"
  WHERE "rateLimit"."lastRequest"<=EXCLUDED."lastRequest"-60000
  RETURNING id`;
 return rows.length===1;
}
