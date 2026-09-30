import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import {PrismaClient} from '@prisma/client';
// Explicit source, never mutate deployment configuration or print secret values.
const source=process.argv[2];if(!source)throw Error('Pass the existing environment file to audit read-only');
const env=parse(readFileSync(resolve(source))),url=new URL(env.DATABASE_URL??'');
url.searchParams.set('connection_limit','1');url.searchParams.set('connect_timeout','10');url.searchParams.set('pool_timeout','10');
const client=new PrismaClient({datasourceUrl:url.href});
const report:Record<string,unknown>={at:new Date().toISOString(),targetHost:url.hostname,environment:env.APP_ENV??'unset',liveFundingFlag:env.PAYMENTS_LIVE_ENABLED==='true',verifyEtSchemaReady:env.VERIFY_ET_SCHEMA_READY==='true',services:{emailTransport:env.EMAIL_TRANSPORT??'unavailable',verifyEtKeyPresent:!!env.VERIFY_ET_API_KEY,verifyEtWebhookSecretPresent:!!env.VERIFY_ET_WEBHOOK_SECRET}};
const deadline=setTimeout(()=>{console.error('Read-only audit exceeded 45 seconds; external checks remain unverified.');process.exit(1)},45000);
try{
 const started=performance.now();
 report.role=await client.$queryRaw`SELECT current_user AS role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
 report.connectMs=Math.round(performance.now()-started);
 report.connections=await client.$queryRaw`SELECT state,count(*)::int AS connections FROM pg_stat_activity WHERE datname=current_database() GROUP BY state`;
 report.privateTableSecurity=await client.$queryRaw`SELECT c.relname AS table_name,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,pg_get_userbyid(c.relowner)=current_user AS owned_by_runtime FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('user','session','Bid','AuctionHold','Journal','Posting','AuctionSettlement','TopUpIntent','TelegramOwnContact') ORDER BY c.relname`;
 const applied=await client.$queryRaw<{migration_name:string;finished:boolean}[]>`SELECT migration_name,finished_at IS NOT NULL AND rolled_back_at IS NULL AS finished FROM "_prisma_migrations" ORDER BY started_at`;
 report.migrations={failed:applied.filter(m=>!m.finished).map(m=>m.migration_name),pending:readdirSync('prisma/migrations',{withFileTypes:true}).filter(f=>f.isDirectory()&&!applied.some(m=>m.finished&&m.migration_name===f.name)).map(f=>f.name)};
}catch(error){report.databaseError=(error as {code?:string;errorCode?:string}).code??(error as {errorCode?:string}).errorCode??'UNAVAILABLE';process.exitCode=1}
finally{await client.$disconnect()}
if(env.TELEGRAM_BOT_TOKEN){
 try{
  const results=[];
  for(const method of ['getMe','getWebhookInfo','getChatMenuButton']){
   const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{signal:AbortSignal.timeout(6000)});const body=await r.json();
   if(!r.ok||!body.ok)throw Error('Telegram API unavailable');const data=body.result;
   results.push(method==='getMe'?{method,username:data.username}:method==='getWebhookInfo'?{method,url:data.url,pending:data.pending_update_count,lastErrorAt:data.last_error_date??null}:{method,url:data.web_app?.url??null});
  }report.telegram=results;
 }catch{report.telegram='UNVERIFIED';process.exitCode=1}
}
clearTimeout(deadline);mkdirSync('test-results/release',{recursive:true});writeFileSync('test-results/release/external-readonly-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
