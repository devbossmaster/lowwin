import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { digest } from './crypto';
import {createAuth} from '../auth/server';
export async function staffRateLimit(client:PrismaClient,action:string,request:Request) {
  const body=await request.clone().json().catch(()=>({}));
  // A browser can append arbitrary cookies or rotate incomplete sessions. MFA
  // limits follow the verified account, never the raw Cookie header or proxy IP.
  const session=['enroll','mfa','logout'].includes(action)?await createAuth(client).api.getSession({headers:request.headers}):null;
  const identity=session?`user:${session.user.id}`:typeof body.email==='string'?body.email.trim().toLowerCase():String(body.token??'anonymous');
  const key=`staff:${action}:${digest(identity)}`;
  // The unique key serializes concurrent increments in one statement. Keep the
  // original fixed-window start until 15 minutes have elapsed; use only DB time.
  const [{count}]=await client.$queryRaw<{count:number}[]>`
    INSERT INTO "rateLimit" (id,key,count,"lastRequest")
    VALUES (${randomUUID()},${key},1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
    ON CONFLICT (key) DO UPDATE SET
      count=CASE WHEN EXCLUDED."lastRequest"-"rateLimit"."lastRequest"<900000 THEN "rateLimit".count+1 ELSE 1 END,
      "lastRequest"=CASE WHEN EXCLUDED."lastRequest"-"rateLimit"."lastRequest"<900000 THEN "rateLimit"."lastRequest" ELSE EXCLUDED."lastRequest" END
    RETURNING count`;
  return count<=(action==='forgot'?5:12);
}
