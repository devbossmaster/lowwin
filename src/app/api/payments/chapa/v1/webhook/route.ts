import {randomUUID} from 'node:crypto';
import {after} from 'next/server';
import {db} from '@/lib/db';
import {readRequestBytes,RequestBodyError} from '@/lib/request-body';
import {privateHeaders} from '@/modules/auth/private-api';
import {chapaHash} from '@/modules/payments/chapa-provider';
import {authenticateChapaV1Webhook,chapaV1Availability,isV1Checkout,parseChapaV1Webhook} from '@/modules/payments/chapa-v1-provider';
import {processChapaEvent} from '@/modules/payments/chapa-events';
export const runtime='nodejs';
export async function POST(request:Request){
 const health=chapaV1Availability();if(!health.recoveryEnabled)return Response.json({accepted:false},{status:503,headers:privateHeaders});
 try{
  const bytes=await readRequestBytes(request,65536);if(!authenticateChapaV1Webhook(bytes,request.headers))return Response.json({accepted:false},{status:401,headers:privateHeaders});
  const payload:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  // A merchant may share this endpoint with authenticated refund/payout or
  // future event categories. Ignore them without retries or financial effects.
  if(payload&&typeof payload==='object'&&!Array.isArray(payload)&&typeof (payload as Record<string,unknown>).event==='string'&&!(payload as Record<string,string>).event.startsWith('charge.'))return Response.json({accepted:true},{headers:privateHeaders});
  const hint=parseChapaV1Webhook(payload);if(!hint||hint.mode!==health.mode||hint.currency!=='ETB')return Response.json({accepted:false},{status:400,headers:privateHeaders});
  const job=await db.$transaction(async tx=>{
   const order=await tx.chapaCheckout.findUnique({where:{merchantReference:hint.merchantReference}});if(!order||!isV1Checkout(order)||order.mode!==health.mode||order.credentialFingerprint!==health.credentialFingerprint||order.creditJournalId)return null;
   await tx.$queryRaw`SELECT id FROM "ChapaCheckout" WHERE id=${order.id} FOR UPDATE`;
   // The static v1 secret proof authenticates no payload bytes. Coalesce every
   // hint for one owned attempt instead of accumulating arbitrary body variants.
   const fingerprint=chapaHash(`v1:${process.env.CHAPA_V1_WEBHOOK_SECRET}`),previous=await tx.chapaWebhookEvent.findFirst({where:{checkoutId:order.id,configurationFingerprint:fingerprint},orderBy:{receivedAt:'desc'}});
   if(previous){
    const now=new Date();
    if(previous.leaseUntil&&previous.leaseUntil>now){
     // Preserve one follow-up hint if a newer outcome arrives during the
     // provider lookup. The worker releases only its own lease and requeues.
     await tx.chapaWebhookEvent.update({where:{id:previous.id},data:{nextAttemptAt:new Date(now.getTime()+60000)}});return null;
    }
    if(previous.status==='QUEUED')return previous.nextAttemptAt<=now?previous.id:null;
    const nextAttemptAt=new Date(Math.max(now.getTime(),(previous.completedAt??previous.receivedAt).getTime()+60000));
    await tx.chapaWebhookEvent.update({where:{id:previous.id},data:{status:'QUEUED',attempts:0,leaseUntil:null,completedAt:null,nextAttemptAt}});return nextAttemptAt<=now?previous.id:null;
   }
   const id=randomUUID();await tx.chapaWebhookEvent.create({data:{id,mode:health.mode,configurationFingerprint:fingerprint,bodyHash:chapaHash(bytes),merchantReference:order.merchantReference,event:hint.event,checkoutId:order.id,status:'QUEUED'}});return id;
  });
  if(job)after(async()=>{await processChapaEvent(db,job).catch(()=>false)});
  return Response.json({accepted:true},{headers:privateHeaders});
 }catch(error){return Response.json({accepted:false},{status:error instanceof RequestBodyError?error.status:error instanceof SyntaxError?400:503,headers:privateHeaders})}
}
