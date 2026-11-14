/** Process-local, bounded timings. Never retain recipient IDs, message content,
 * SQL, tokens or database URLs. Durations include connection-pool waiting. */
import type {PrismaClient} from '@prisma/client';
export type NotificationStage='claim'|'preparation'|'mediaPreparation'|'rate'|'gate'|'http'|'acknowledgement';
type Samples={count:number;total:number;max:number;values:number[]};
const stages=new Map<NotificationStage,Samples>();
let accepted=0,uncertain=0,started=performance.now();
export function recordNotificationTiming(stage:NotificationStage,ms:number){
 if(!Number.isFinite(ms)||ms<0)return;
 let sample=stages.get(stage);if(!sample){sample={count:0,total:0,max:0,values:[]};stages.set(stage,sample)}
 sample.count++;sample.total+=ms;sample.max=Math.max(sample.max,ms);
 if(sample.values.length<512)sample.values.push(ms);else sample.values[(sample.count-1)%512]=ms;
}
export async function timeNotification<T>(stage:NotificationStage,operation:()=>Promise<T>){const began=performance.now();try{return await operation()}finally{recordNotificationTiming(stage,performance.now()-began)}}
export function recordNotificationAccepted(){accepted++}
export function recordNotificationUncertain(){uncertain++}
export function notificationTimingSnapshot(reset=false){
 const elapsedMs=performance.now()-started;
 const result={windowMs:Math.round(elapsedMs),accepted,acknowledgementUncertain:uncertain,sendsPerSecond:+(accepted/Math.max(1,elapsedMs)*1000).toFixed(2),stages:Object.fromEntries([...stages].map(([stage,sample])=>{
  const sorted=[...sample.values].sort((a,b)=>a-b),quantile=(q:number)=>+(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))]??0).toFixed(1);
  return [stage,{count:sample.count,meanMs:+(sample.total/sample.count).toFixed(1),p50Ms:quantile(.5),p95Ms:quantile(.95),maxMs:+sample.max.toFixed(1),retainedSamples:sorted.length}];
 }))};
 if(reset){stages.clear();accepted=0;uncertain=0;started=performance.now()}
 return result;
}

/** Once per reporting window, outside delivery transactions. Pool activity is
 * explicitly database-wide; configured worker caps are reported separately. */
export async function notificationDatabaseSnapshot(client:PrismaClient){
 const [queue]=await client.$queryRaw<{pending:bigint;due:bigint;inFlight:bigint;retrying:bigint;oldestDueAgeMs:number}[]>`
  SELECT COUNT(*) AS pending,
   COUNT(*) FILTER(WHERE "nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))) AS due,
   COUNT(*) FILTER(WHERE "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC')) AS "inFlight",
   COUNT(*) FILTER(WHERE attempts>0 AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))) AS retrying,
   COALESCE(MAX(EXTRACT(EPOCH FROM (clock_timestamp() AT TIME ZONE 'UTC')-"createdAt")*1000) FILTER(WHERE "nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))),0)::float AS "oldestDueAgeMs"
   FROM "Outbox" WHERE state='PENDING' AND kind NOT IN ('GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS')`;
 const [activity]=await client.$queryRaw<{connections:bigint;active:bigint;idleInTransaction:bigint;waiting:bigint;oldestTransactionMs:number}[]>`
  SELECT COUNT(*) AS connections,COUNT(*) FILTER(WHERE state='active') AS active,
   COUNT(*) FILTER(WHERE state='idle in transaction') AS "idleInTransaction",
   COUNT(*) FILTER(WHERE state='active' AND wait_event IS NOT NULL) AS waiting,
   COALESCE(MAX(EXTRACT(EPOCH FROM clock_timestamp()-xact_start)*1000),0)::float AS "oldestTransactionMs"
  FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`;
 return {queue:Object.fromEntries(Object.entries(queue).map(([key,value])=>[key,typeof value==='bigint'?Number(value):Math.round(value)])),databaseActivity:{scope:'database-wide',...Object.fromEntries(Object.entries(activity).map(([key,value])=>[key,typeof value==='bigint'?Number(value):Math.round(value)]))}};
}
