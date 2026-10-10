import nextEnv from '@next/env';
import {PrismaClient} from '@prisma/client';
import {runtimeDatabaseUrl} from '../src/lib/database-config';
import {databaseErrorSummary} from '../src/lib/database-error';

const loaded=nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production');
for(const file of loaded.loadedEnvFiles) {
  if((file.contents.match(/^\s*(?:export\s+)?DATABASE_URL\s*=/gm)??[]).length>1) {
    throw new Error(`Duplicate DATABASE_URL entries in ${file.path}. Keep one authoritative value.`);
  }
}
const checkInbox=process.argv.includes('--bot-inbox');
const checkTimings=process.argv.includes('--timings');
let datasourceUrl=runtimeDatabaseUrl(process.env.DATABASE_URL);
if(!datasourceUrl)throw new Error('DATABASE_URL is required');
const url=new URL(datasourceUrl);
if(checkInbox){url.searchParams.set('connection_limit','1');url.searchParams.set('pool_timeout','20');datasourceUrl=url.toString()}
const db=new PrismaClient({datasourceUrl});
const started=performance.now();
let stage='connection';
const deadline=setTimeout(()=>{console.error(JSON.stringify({database:stage==='connection'?'unavailable':'reachable',stage,code:'CHECK_TIMEOUT'}));process.exit(1)},25000);
try {
  // Read-only: no user/session creation, migrations, seeds or credential output.
  await db.$queryRaw`SELECT 1`;
  const firstReadMs=Math.round(performance.now()-started),warmReadMs:number[]=[];
  if(checkTimings){
    stage='warm-reads';
    for(let index=0;index<4;index++){
      const sample=performance.now();await db.$queryRaw`SELECT 1`;
      warmReadMs.push(Math.round(performance.now()-sample));
    }
  }
  if(checkInbox){
    stage='transaction';
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT 1`;
      stage='inbox';
      // LIMIT 0 checks the worker's columns and SELECT/UPDATE permissions,
      // without fetching payloads, claiming rows or processing Telegram updates.
      await tx.$queryRaw`SELECT "updateId",payload,attempts,"botId" FROM "BotUpdate"
        WHERE "processedAt" IS NULL AND "nextAttemptAt"<=now() AND attempts<8
        ORDER BY "updateId" FOR UPDATE SKIP LOCKED LIMIT 0`;
    },{maxWait:15000,timeout:20000});
  }
  console.log(JSON.stringify({database:'reachable',...(checkInbox?{inbox:'query-ok'}:{}),host:url.hostname,port:url.port||'5432',elapsedMs:Math.round(performance.now()-started),
    ...(checkTimings?{firstReadMs,warmReadMs,productionCaching:process.env.APP_ENV==='production',redisConfigured:!!process.env.REDIS_URL?.trim()}:{}),
  }));
}catch(error) {
  console.error(JSON.stringify({database:stage==='connection'?'unavailable':'reachable',stage,host:url.hostname,port:url.port||'5432',...databaseErrorSummary(error)}));
  process.exitCode=1;
}finally {await db.$disconnect();clearTimeout(deadline)}
