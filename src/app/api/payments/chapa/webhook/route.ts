import {db} from '@/lib/db';
import {randomUUID} from 'node:crypto';
import {readRequestBytes,RequestBodyError} from '@/lib/request-body';
import {privateHeaders} from '@/modules/auth/private-api';
import {chapaAvailability,chapaHash,isChapaHostedSessionReference,parseChapaWebhook,verifyChapaWebhook} from '@/modules/payments/chapa-provider';
import {processChapaEvent} from '@/modules/payments/chapa-events';
export const runtime='nodejs';
export async function POST(request:Request){
 const health=chapaAvailability();if(!health.recoveryEnabled)return Response.json({accepted:false},{status:503,headers:privateHeaders});
 try{
  const bytes=await readRequestBytes(request,65536);if(!verifyChapaWebhook(bytes,request.headers.get('x-chapa-signature')))return Response.json({accepted:false},{status:401,headers:privateHeaders});
  const hint=parseChapaWebhook(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));if(!hint||hint.mode&&hint.mode!==health.mode)return Response.json({accepted:false},{status:400,headers:privateHeaders});
  // Only allowlisted, non-PII hints are retained. Signature is checked against
  // exact raw bytes; no browser/callback/webhook success can create money.
  const job=await db.$transaction(async tx=>{
   const id=randomUUID(),configurationFingerprint=chapaHash(process.env.CHAPA_WEBHOOK_SECRET!),bodyHash=chapaHash(bytes);
   const order=hint.type==='payment'&&hint.merchantReference?await tx.chapaCheckout.findUnique({where:{merchantReference:hint.merchantReference}}):null;
   // Older intents stored a hosted session token as their reference.
   // Permit only a recovery hint here; verification must establish the final
   // payment reference before its balanced receipt can replace that token.
   const hostedSession=order&&isChapaHostedSessionReference(order.checkoutUrl,order.chapaReference,health.mode);
   const valid=!!order&&order.mode===health.mode&&(!hint.chapaReference||!order.chapaReference||hint.chapaReference===order.chapaReference||hostedSession)&&(!hint.amountCents||hint.amountCents===order.amountCents.toString())&&(!hint.currency||hint.currency===order.currency);
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
