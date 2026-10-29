import type {PrismaClient} from '@prisma/client';
import {chapaAvailability,chapaTransport,type ChapaTransport} from './chapa-provider';
import {verifyChapaCheckout} from './chapa';

/** Only durable authenticated deliveries enter this queue. No pending-checkout
 * scan or initialization is performed by the event worker. */
export async function processChapaEvent(client:PrismaClient,id:string,transport:ChapaTransport=chapaTransport){
 const health=chapaAvailability();if(!health.recoveryEnabled)return false;
 const now=new Date(),lease=new Date(Date.now()+30000);
 const claimed=await client.chapaWebhookEvent.updateMany({where:{id,mode:health.mode,status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseUntil:lease,attempts:{increment:1}}});
 if(!claimed.count)return false;
 const event=await client.chapaWebhookEvent.findUniqueOrThrow({where:{id}});
 let verified=false;
 try{
  if(!event.checkoutId){verified=true;return true}
  const current=await client.chapaCheckout.findUniqueOrThrow({where:{id:event.checkoutId}});
  if(current.creditJournalId){verified=true;return true}
  if(current.leaseUntil&&current.leaseUntil>new Date())return false;
  await verifyChapaCheckout(client,current.id,undefined,undefined,transport,true);
  const result=await client.chapaCheckout.findUniqueOrThrow({where:{id:current.id}});
  verified=!!result.creditJournalId||result.verificationState==='VERIFIED'&&!result.leaseUntil;
  return verified;
 }catch{return false}
 finally{
  await client.chapaWebhookEvent.updateMany({where:{id,status:'QUEUED',leaseUntil:lease},data:{leaseUntil:null,status:verified?'PROCESSED':event.attempts>=5?'NEEDS_VERIFICATION':'QUEUED',completedAt:verified?new Date():null,nextAttemptAt:new Date(Date.now()+Math.min(300000,5000*2**event.attempts))}});
 }
}
export async function processChapaEvents(client:PrismaClient,limit=20,transport:ChapaTransport=chapaTransport){
 const health=chapaAvailability();if(!health.recoveryEnabled)return {checked:0};
 const rows=await client.chapaWebhookEvent.findMany({where:{mode:health.mode,status:'QUEUED',attempts:{lt:5},nextAttemptAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:[{nextAttemptAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});
 let checked=0;for(const row of rows){await processChapaEvent(client,row.id,transport);checked++}return {checked};
}
