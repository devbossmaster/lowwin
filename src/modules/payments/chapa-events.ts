import type {PrismaClient} from '@prisma/client';
import {chapaAvailability,chapaTransport,type ChapaTransport} from './chapa-provider';
import {unsupportedLegacyChapaCheckout,verifyChapaCheckout} from './chapa';
import {chapaLegacyRecoveryAvailability} from './chapa-legacy-recovery';

function recoveryModes(){const current=chapaAvailability(),legacy=chapaLegacyRecoveryAvailability();return [...new Set([...(current.recoveryEnabled?[current.mode]:[]),...(legacy.recoveryEnabled?[legacy.mode]:[])])]}
function reconcilesEvent(event:string,providerStatus:string|null){
 if(!providerStatus)return false;
 if(event==='payment.failed_or_cancelled')return providerStatus==='FAILED'||providerStatus==='CANCELLED';
 return event===`payment.${providerStatus.toLowerCase()}`;
}

/** Only durable authenticated delivery hints enter this queue. A configured
 * legacy proof is not payload integrity; only the original-version private lookup can establish funds.
 * No pending-checkout scan or initialization is performed by this worker. */
export async function processChapaEvent(client:PrismaClient,id:string,transport:ChapaTransport=chapaTransport){
 const modes=recoveryModes();if(!modes.length)return false;
 const now=new Date(),lease=new Date(Date.now()+30000);
 const claimed=await client.chapaWebhookEvent.updateMany({where:{id,mode:{in:modes},status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseUntil:lease,attempts:{increment:1}}});
 if(!claimed.count)return false;
 const event=await client.chapaWebhookEvent.findUniqueOrThrow({where:{id}});
 let verified=false,credited=false,unsupportedLegacy=false;
 try{
  if(!event.checkoutId){verified=true;return true}
  const current=await client.chapaCheckout.findUniqueOrThrow({where:{id:event.checkoutId}});
  if(current.creditJournalId){verified=credited=true;return true}
  if(unsupportedLegacyChapaCheckout(current)){unsupportedLegacy=true;return false}
  // An in-flight verifier must still receive this durable signal. Its fenced
  // coordinator retains a deferred check rather than dropping this delivery.
  const verification=await verifyChapaCheckout(client,current.id,undefined,undefined,transport,'webhook');
  const result=await client.chapaCheckout.findUniqueOrThrow({where:{id:current.id}});
  // A verified but still pending payment needs another bounded lookup. An early
  // provider read must not consume the only notification before SUCCESS exists.
  const terminal=result.providerStatus&&['SUCCESS','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'].includes(result.providerStatus);
  credited=!!result.creditJournalId;
  // A lookup outage preserves the last verified outcome. It cannot establish
  // that this newer event was reconciled; retain its durable retry instead.
  const unavailable=verification&&'verificationUnavailable'in verification&&verification.verificationUnavailable===true;
  // A success delivery can outrun a provider replica still returning FAILED.
  // That older terminal response cannot consume the newer completion signal.
  // A committed credit ends every hint; otherwise retain bounded retries until
  // the private outcome agrees with the event being reconciled.
  verified=credited||!unavailable&&result.verificationState==='VERIFIED'&&!result.leaseUntil&&!!terminal&&reconcilesEvent(event.event,result.providerStatus);
  return verified;
 }catch{return false}
 finally{
  const where={id,status:'QUEUED',leaseUntil:lease};
  if(unsupportedLegacy){
   // An unconfigured original version remains available for staff review.
   // Never replace its verification with the active version's transport.
   await client.chapaWebhookEvent.updateMany({where,data:{leaseUntil:null,status:'NEEDS_VERIFICATION',completedAt:null}});
  }else if(!credited&&event.nextAttemptAt>now){
   // A hint was coalesced after claiming this lease but before reading the job.
   await client.chapaWebhookEvent.updateMany({where,data:{leaseUntil:null,status:'QUEUED',attempts:0,completedAt:null}});
  }else{
   const completed=await client.chapaWebhookEvent.updateMany({where:{...where,...(!credited?{nextAttemptAt:event.nextAttemptAt}:{})},data:{leaseUntil:null,status:verified?'PROCESSED':event.attempts>=5?'NEEDS_VERIFICATION':'QUEUED',completedAt:verified?new Date():null,nextAttemptAt:new Date(Date.now()+Math.min(300000,5000*2**event.attempts))}});
   if(!credited&&!completed.count){
    // A later hint changed the due time while provider HTTP was in flight.
    // Release only our lease and retain that one deferred authoritative check.
    await client.chapaWebhookEvent.updateMany({where,data:{leaseUntil:null,status:'QUEUED',attempts:0,completedAt:null}});
   }
  }
 }
}
export async function processChapaEvents(client:PrismaClient,limit=20,transport:ChapaTransport=chapaTransport){
 const modes=recoveryModes();if(!modes.length)return {checked:0};
 const rows=await client.chapaWebhookEvent.findMany({where:{mode:{in:modes},status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:[{nextAttemptAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});
 let checked=0;for(const row of rows){await processChapaEvent(client,row.id,transport);checked++}return {checked};
}
