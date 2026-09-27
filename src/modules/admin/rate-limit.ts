import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { digest } from './crypto';
import {createAuth} from '../auth/server';
export async function staffRateLimit(client:PrismaClient,action:string,request:Request) {
  const body=await request.clone().json().catch(()=>({}));
  // A browser can append arbitrary cookies or rotate incomplete sessions. MFA
  // limits follow the verified account, never the raw Cookie header or proxy IP.
  const session=['enroll','mfa','step-up','logout'].includes(action)?await createAuth(client).api.getSession({headers:request.headers}):null;
  const identity=session?`user:${session.user.id}`:typeof body.email==='string'?body.email.trim().toLowerCase():String(body.token??'anonymous');
  const key=`staff:${action}:${digest(identity)}`;
  return client.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`,ms=BigInt(now.getTime());
    const old=await tx.rateLimit.findUnique({where:{key}}),count=old&&ms-old.lastRequest<900000n?old.count+1:1;
    await tx.rateLimit.upsert({where:{key},create:{id:randomUUID(),key,count,lastRequest:ms},update:{count,lastRequest:count===1?ms:old!.lastRequest}});
    return count<=(action==='forgot'?5:12);
  });
}
