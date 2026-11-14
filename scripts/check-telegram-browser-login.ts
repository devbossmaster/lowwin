import nextEnv from '@next/env';
import {browserLoginConfig,telegramLoginSettings} from '../src/modules/auth/telegram-login';

const migration='202611130002_telegram_browser_login';
async function main(){
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--schema','--help'].includes(arg))){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage:'npx --no-install tsx scripts/check-telegram-browser-login.ts --schema',hint:'Use two ordinary hyphens before schema; do not append other terminal text.'}));process.exitCode=1;return}
 if(args.includes('--help')){console.log('npx --no-install tsx scripts/check-telegram-browser-login.ts [--schema]\nRedacted configuration and optional read-only schema check. No Telegram request, login, secrets or customer records.');return}
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>{},error:()=>{}});
 const config=browserLoginConfig(),settings=telegramLoginSettings({...process.env,TELEGRAM_LOGIN_ENABLED:'true'});
 const required=['TELEGRAM_LOGIN_CLIENT_ID','TELEGRAM_LOGIN_CLIENT_SECRET','TELEGRAM_BOT_TOKEN','BETTER_AUTH_URL'];
 let schema:{status:string;expectedMigration:string;applied?:boolean;sessionSource?:boolean;contactProof?:boolean}={status:'not-requested',expectedMigration:migration};
 if(args.includes('--schema')){
  const [{PrismaClient},{runtimeDatabaseUrl}]=await Promise.all([import('@prisma/client'),import('../src/lib/database-config')]);
  // Migration history is intentionally unavailable to the runtime role.
  // Use the configured migration connection for this read-only operator check.
  const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DIRECT_URL||process.env.DATABASE_URL),log:[]});
  try{schema=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   const rows=await tx.$queryRaw<Array<{applied:boolean;sessionSource:boolean;contactProof:boolean}>>`SELECT EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name=${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='session' AND c.conname='session_telegram_auth_source' AND c.convalidated) AS "sessionSource",EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='TelegramOwnContact' AND c.conname='telegram_contact_proof_source' AND c.convalidated) AS "contactProof"`;
   const row=rows[0];return {status:row?.applied&&row.sessionSource&&row.contactProof?'ok':'migration-required',expectedMigration:migration,...row};
  },{maxWait:5000,timeout:10000})}catch(error){const details=error as {code?:string;meta?:{code?:string}};schema={status:details.code==='42501'||details.meta?.code==='42501'?'migration-connection-required':'unavailable',expectedMigration:migration}}finally{await db.$disconnect()}
 }
 const ready=config.enabled&&config.configured&&(!args.includes('--schema')||schema.status==='ok');
 console.log(JSON.stringify({...config,missing:required.filter(key=>!process.env[key]),clientIdMatchesBot:!!process.env.TELEGRAM_LOGIN_CLIENT_ID&&process.env.TELEGRAM_LOGIN_CLIENT_ID===process.env.TELEGRAM_BOT_TOKEN?.split(':')[0],callback:settings?.callback??null,integration:'better-auth-telegram',credentialVerification:'not-performed',schema,ready},null,2));
 if(!ready)process.exitCode=1;
}
void main().catch(()=>{console.error(JSON.stringify({error:'CHECK_UNAVAILABLE'}));process.exitCode=1});
