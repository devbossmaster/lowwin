import {db} from '@/lib/db';
import {randomUUID} from 'node:crypto';
import {readRequestBytes,RequestBodyError} from '@/lib/request-body';
import {privateHeaders} from '@/modules/auth/private-api';
import {authenticateChapaWebhook,chapaAvailability,chapaHash,chapaWebhookAmountMatches,chapaWebhookConfigurationFingerprint,isChapaHostedSessionReference,parseChapaWebhook} from '@/modules/payments/chapa-provider';
import {processChapaEvent} from '@/modules/payments/chapa-events';
import type {ChapaWebhookEvent} from '@prisma/client';
export const runtime='nodejs';
export async function POST(request:Request){
 const health=chapaAvailability();if(!health.recoveryEnabled)return Response.json({accepted:false},{status:503,headers:privateHeaders});
 try{
  const bytes=await readRequestBytes(request,65536),authentication=authenticateChapaWebhook(bytes,request.headers);if(!authentication)return Response.json({accepted:false},{status:401,headers:privateHeaders});
  const hint=parseChapaWebhook(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));if(!hint||hint.mode&&hint.mode!==health.mode)return Response.json({accepted:false},{status:400,headers:privateHeaders});
  const legacy=authentication==='legacy_secret';
  if(legacy&&(hint.type!=='payment'||!hint.merchantReference||hint.mode!==health.mode||hint.currency!==health.currency))return Response.json({accepted:false},{status:400,headers:privateHeaders});
  // Only allowlisted, non-PII hints are retained. The legacy shared-secret
  // proof does not protect payload integrity; nothing in a hint creates money.
  const job=await db.$transaction(async tx=>{
   const id=randomUUID(),configurationFingerprint=chapaWebhookConfigurationFingerprint(),bodyHash=chapaHash(bytes);
   const order=hint.type==='payment'&&hint.merchantReference?await tx.chapaCheckout.findUnique({where:{merchantReference:hint.merchantReference}}):null;
   // Older intents stored a hosted session token as their reference.
   // Permit only a recovery hint here; verification must establish the final
   // payment reference before its balanced receipt can replace that token.
   const hostedSession=order&&isChapaHostedSessionReference(order.checkoutUrl,order.chapaReference,health.mode);
   const valid=!!order&&order.mode===health.mode&&(!hint.chapaReference||!order.chapaReference||hint.chapaReference===order.chapaReference||hostedSession)&&chapaWebhookAmountMatches(hint,order.amountCents)&&(!hint.currency||hint.currency===order.currency);
   if(legacy){
    // Never accumulate legacy records for arbitrary references or paid orders.
    if(!valid||order!.creditJournalId)return null;
    // Serialize against other hints and financial credit on the canonical
    // attempt. Different forged/changed raw bodies cannot grow the job queue.
    const [current]=await tx.$queryRaw<{creditJournalId:string|null}[]>`SELECT "creditJournalId" FROM "ChapaCheckout" WHERE id=${order!.id} FOR UPDATE`;
    if(!current||current.creditJournalId)return null;
    // Include the immutable merchant reference to use the existing index. A
    // canonical legacy job is reused even when later hints have different bytes.
    const previous=await tx.chapaWebhookEvent.findFirst({where:{checkoutId:order!.id,merchantReference:order!.merchantReference,mode:health.mode,configurationFingerprint},orderBy:{receivedAt:'desc'},select:{id:true}});
    if(previous){
     const [job]=await tx.$queryRaw<ChapaWebhookEvent[]>`SELECT * FROM "ChapaWebhookEvent" WHERE id=${previous.id} FOR UPDATE`;
     if(job){
      const now=new Date();
      if(job.status==='QUEUED'&&job.attempts<5&&job.nextAttemptAt>now)return null;
      if(job.leaseUntil&&job.leaseUntil>now){
       // Leave the in-flight lease intact. The worker preserves this deferred
       // request rather than overwriting it with an earlier terminal response.
       await tx.chapaWebhookEvent.updateMany({where:{id:job.id},data:{nextAttemptAt:new Date(now.getTime()+60000)}});
       return null;
      }
      if(job.status==='QUEUED'&&job.attempts<5)return job.id;
      const nextAttemptAt=new Date(Math.max(now.getTime(),(job.completedAt??job.receivedAt).getTime()+60000,job.nextAttemptAt.getTime()));
      await tx.chapaWebhookEvent.updateMany({where:{id:job.id},data:{status:'QUEUED',attempts:0,leaseUntil:null,completedAt:null,nextAttemptAt}});
      return nextAttemptAt<=now?job.id:null;
     }
    }
   }
   const inserted=await tx.chapaWebhookEvent.createMany({data:[{id,mode:health.mode,configurationFingerprint,bodyHash,merchantReference:hint.merchantReference,chapaReference:hint.chapaReference,event:hint.event,checkoutId:valid?order!.id:null,status:valid?'QUEUED':'IGNORED'}],skipDuplicates:true});
   if(!inserted.count)return null;
   if(!valid)return null;
   // A delivery can be older than our last verified state. Queue a fresh
   // authoritative lookup without replacing that state with a webhook hint.
   await tx.chapaCheckout.updateMany({where:{id:order!.id,creditJournalId:null},data:{nextCheckAt:new Date(),reason:'PROVIDER_EVENT_RECEIVED'}});
   return id;
  });
  // Durable receipt precedes provider HTTP. A temporary verification failure
  // leaves a bounded event job for the worker, even after the modal closes.
  if(job)await processChapaEvent(db,job).catch(()=>false);
  return Response.json({accepted:true},{headers:privateHeaders});
 }catch(error){return Response.json({accepted:false},{status:error instanceof RequestBodyError?error.status:error instanceof SyntaxError?400:503,headers:privateHeaders})}
}
