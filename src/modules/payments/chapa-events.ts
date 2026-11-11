import type {PrismaClient} from '@prisma/client';
import {chapaAvailability,chapaTransport,type ChapaTransport} from './chapa-provider';
import {chapaV1Availability,chapaV1Transport} from './chapa-v1-provider';
import {verifyChapaCheckout} from './chapa';

/** Only durable authenticated delivery hints enter this queue. A configured
 * legacy proof is not payload integrity; only merchant verification establishes funds.
 * No pending-checkout scan or initialization is performed by this worker. */
export async function processChapaEvent(client:PrismaClient,id:string,transport?:ChapaTransport){
 const snapshot=await client.chapaWebhookEvent.findUnique({where:{id},select:{apiVersion:true,mode:true}});if(!snapshot)return false;
 const apiVersion=snapshot.apiVersion;
 const health=apiVersion===1?chapaV1Availability():chapaAvailability();if(!health.recoveryEnabled||snapshot.mode!==health.mode)return false;
 const now=new Date(),lease=new Date(Date.now()+30000);
 const claimed=await client.chapaWebhookEvent.updateMany({where:{id,apiVersion,mode:health.mode,status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseUntil:lease,attempts:{increment:1}}});
 if(!claimed.count)return false;
 const event=await client.chapaWebhookEvent.findUniqueOrThrow({where:{id}});
 let verified=false,credited=false;
 try{
  if(!event.checkoutId){verified=true;return true}
  const current=await client.chapaCheckout.findUniqueOrThrow({where:{id:event.checkoutId}});
  if((current.apiVersion??2)!==apiVersion||current.mode!==event.mode)return false;
  if(current.creditJournalId){verified=credited=true;return true}
  if(current.leaseUntil&&current.leaseUntil>new Date())return false;
  const confirmation=await verifyChapaCheckout(client,current.id,undefined,undefined,transport??(apiVersion===1?chapaV1Transport:chapaTransport),'webhook');
  const result=await client.chapaCheckout.findUniqueOrThrow({where:{id:current.id}});
  // A verified but still pending payment needs another bounded lookup. An early
  // provider read must not consume the only notification before SUCCESS exists.
  const terminal=result.providerStatus&&['SUCCESS','FAILED','CANCELLED','INCOMPLETE','BLOCKED'].includes(result.providerStatus);
  credited=!!result.creditJournalId;
  const unavailable=!!confirmation&&'verificationUnavailable'in confirmation&&confirmation.verificationUnavailable===true;
  verified=credited||!unavailable&&result.verificationState==='VERIFIED'&&!result.leaseUntil&&!!terminal;
  return verified;
 }catch{return false}
 finally{
  const where={id,status:'QUEUED',leaseUntil:lease};
  if(!credited&&event.nextAttemptAt>now){
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
export async function processChapaEvents(client:PrismaClient,limit=20,transport?:ChapaTransport){
 const legacy=chapaAvailability(),v1=chapaV1Availability();
 const configurations=[...(legacy.recoveryEnabled?[{apiVersion:2,mode:legacy.mode}]:[]),...(v1.recoveryEnabled?[{apiVersion:1,mode:v1.mode}]:[])];
 if(!configurations.length)return {checked:0};
 const rows=await client.chapaWebhookEvent.findMany({where:{AND:[{OR:configurations}],status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:[{nextAttemptAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});
 let checked=0;for(const row of rows){await processChapaEvent(client,row.id,transport);checked++}return {checked};
}
