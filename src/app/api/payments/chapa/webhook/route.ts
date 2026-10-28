import {db} from '@/lib/db';
import {readRequestBytes,RequestBodyError} from '@/lib/request-body';
import {privateHeaders} from '@/modules/auth/private-api';
import {chapaAvailability,chapaHash,parseChapaWebhook,verifyChapaWebhook} from '@/modules/payments/chapa-provider';
export const runtime='nodejs';
export async function POST(request:Request){
 const health=chapaAvailability();if(!health.recoveryEnabled)return Response.json({accepted:false},{status:503,headers:privateHeaders});
 try{
  const bytes=await readRequestBytes(request,65536);if(!verifyChapaWebhook(bytes,request.headers.get('x-chapa-signature')))return Response.json({accepted:false},{status:401,headers:privateHeaders});
  const hint=parseChapaWebhook(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));if(!hint||hint.mode&&hint.mode!==health.mode)return Response.json({accepted:false},{status:400,headers:privateHeaders});
  // Only allowlisted, non-PII hints are retained. Signature is checked against
  // exact raw bytes; no browser/callback/webhook success can create money.
  await db.$transaction(async tx=>{
   const configurationFingerprint=chapaHash(process.env.CHAPA_WEBHOOK_SECRET!);const inserted=await tx.chapaWebhookEvent.createMany({data:[{mode:health.mode,configurationFingerprint,bodyHash:chapaHash(bytes),merchantReference:hint.merchantReference,chapaReference:hint.chapaReference,event:hint.event}],skipDuplicates:true});if(!inserted.count)return;
   if(hint.type!=='payment'){await tx.adminAudit.create({data:{actorId:'chapa-webhook',action:'CHAPA_NONPAYMENT_EVENT_REVIEW',target:hint.chapaReference??hint.merchantReference??'unknown',details:{type:hint.type,event:hint.event,mode:health.mode}}});return}
   if(!hint.merchantReference)return;
   const order=await tx.chapaCheckout.findUnique({where:{merchantReference:hint.merchantReference}});if(!order||order.mode!==health.mode)return;
   if(hint.chapaReference&&order.chapaReference&&hint.chapaReference!==order.chapaReference||hint.amountCents&&hint.amountCents!==order.amountCents.toString()||hint.currency&&hint.currency!==order.currency)return;
   // A delivery can be older than our last verified state. Queue a fresh
   // authoritative lookup without replacing that state with a webhook hint.
   await tx.chapaCheckout.updateMany({where:{id:order.id,creditJournalId:null},data:{nextCheckAt:new Date(),reason:'PROVIDER_EVENT_RECEIVED'}});
  });
  return Response.json({accepted:true},{headers:privateHeaders});
 }catch(error){return Response.json({accepted:false},{status:error instanceof RequestBodyError?error.status:error instanceof SyntaxError?400:503,headers:privateHeaders})}
}
