import {vi} from 'vitest';
import {Prisma,type Outbox,type PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';

/** In-memory transport/content unit fixture. Durable SQL locking and ownership
 * are exercised separately against isolated PostgreSQL. */
export function notificationDispatchFixture(jobs:Outbox[],now=new Date()){
 const logical=new Map<string,{key:string;leaseToken:string;sentAt:Date|null}>();
 const apply=(where:Record<string,unknown>,data:Record<string,unknown>)=>{
  const selected=jobs.filter(job=>(where.id===undefined||job.id===where.id)&&(where.state===undefined||job.state===where.state)&&(where.leaseToken===undefined||job.leaseToken===where.leaseToken));
  for(const job of selected){const attempts=typeof data.attempts==='object'?job.attempts+1:data.attempts;Object.assign(job,data,attempts===undefined?{}:{attempts})}return selected;
 };
 const user={telegramId:'900000001',name:'Player name',role:'member',staffMember:null},chat={telegramId:user.telegramId,chatId:user.telegramId,blocked:false};
 const tx={
  $executeRaw:vi.fn(async()=>0),adminAudit:{findFirst:vi.fn(async()=>null)},
  $queryRaw:vi.fn(async(query:TemplateStringsArray|Prisma.Sql,...tagValues:unknown[])=>{
   const sql=('strings' in query?query.strings:query).join(''),values:unknown[]=Array.isArray(query)?tagValues:(query as Prisma.Sql).values;
   if(sql.includes('ELSE NULL END AS reason'))return [{now,leaseUntil:new Date(now.getTime()+120000),reason:null}];
   if(sql.includes('clock_timestamp() AS now'))return [{now}];
   if(sql.includes('SELECT u."telegramId"'))return [{...user,...await tx.user.findUnique(),...await tx.botChat.findUnique()}];
   if(sql.includes('SELECT u.id'))return [{id:'player'}];
   if(sql.includes('INSERT INTO "TelegramDeliveryLease"')){const key=String(values[0]);if(logical.has(key))return [];logical.set(key,{key,leaseToken:String(values[3]),sentAt:null});return [{key}]}
   if(sql.includes('INSERT INTO "TelegramMediaCache"'))return [{botId:'123456789'}];
   if(sql.includes('UPDATE "Outbox"')){const selected=jobs.filter(job=>values.includes(job.id));for(const job of selected)Object.assign(job,{leaseToken:String(values[0]),leaseUntil:new Date(Date.now()+120000),claimedAt:new Date()});return selected}
   if(sql.includes('FROM "Outbox"')){
    const expansion=sql.includes('kind IN')&&!sql.includes('kind NOT IN');
    return jobs.filter(job=>job.state==='PENDING'&&job.nextAttemptAt<=new Date()&&!job.leaseToken&&(expansion?['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS'].includes(job.kind):!['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS'].includes(job.kind))&&(!sql.includes('AND kind=')||values.includes(job.kind))).slice(0,1);
   }
   return [];
  }),
  user:{findUnique:vi.fn(async()=>user)},botChat:{findUnique:vi.fn(async()=>chat),updateMany:vi.fn()},
  outbox:{update:vi.fn(async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>apply(where,data)[0]),updateMany:vi.fn(async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>({count:apply(where,data).length})),findFirst:vi.fn(async({where}:{where:Record<string,unknown>})=>jobs.find(job=>job.id===where.id&&job.state===where.state&&job.leaseToken===where.leaseToken)??null),findUnique:vi.fn(async()=>null)},
  telegramMessage:{upsert:vi.fn(async()=>({id:randomUUID()})),findFirst:vi.fn(async()=>null)},
  telegramDeliveryLease:{findFirst:vi.fn(async()=>({key:'owned'})),findUnique:vi.fn(async({where}:{where:{key:string}})=>logical.get(where.key)),updateMany:vi.fn(async({where,data}:{where:{key:string};data:object})=>{Object.assign(logical.get(where.key)!,data);return {count:1}}),deleteMany:vi.fn(async()=>({count:0}))},
  telegramMediaCache:{findUnique:vi.fn(async()=>null),updateMany:vi.fn(async()=>({count:1}))},
  notificationInbox:{upsert:vi.fn()},notificationPreference:{findUnique:vi.fn(async()=>({inApp:true}))},
 };
 return {tx,client:Object.assign(tx,{$transaction:async(callback:(value:unknown)=>unknown)=>callback(tx)}) as unknown as PrismaClient};
}
