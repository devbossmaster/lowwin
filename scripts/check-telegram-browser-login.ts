import nextEnv from '@next/env';
import {browserLoginConfig,telegramLoginSettings} from '../src/modules/auth/telegram-login';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';

const migration='202611130002_telegram_browser_login';
async function matchesCurrentBotFatherSecret(expected:string){
 if(!process.stdin.isTTY){console.error(JSON.stringify({error:'INTERACTIVE_TERMINAL_REQUIRED',hint:'Use WEB interactive terminal for the hidden secret comparison. Never paste the secret into a command or chat.'}));process.exitCode=1;return undefined}
 const muted=new Writable({write(_chunk,_encoding,done){done()}}),abort=new AbortController();
 const reader=createInterface({input:process.stdin,output:muted,terminal:true,historySize:0});
 reader.on('SIGINT',()=>abort.abort());
 process.stderr.write('Paste the CURRENT BotFather Login Widget Client Secret (hidden), then Enter: ');
 try{const entered=await reader.question('',{signal:abort.signal}),actual=Buffer.from(entered,'utf8'),configured=Buffer.from(expected,'utf8');return actual.length>0&&actual.length===configured.length&&timingSafeEqual(actual,configured)}
 catch{return undefined}
 finally{reader.close();process.stderr.write('\n')}
}
async function main(){
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--schema','--request','--compare-secret','--help'].includes(arg))){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage:'npx --no-install tsx scripts/check-telegram-browser-login.ts --request',hint:'Use ordinary hyphens; supported flags are --schema, --request and --compare-secret.'}));process.exitCode=1;return}
 if(args.includes('--help')){console.log('npx --no-install tsx scripts/check-telegram-browser-login.ts [--schema] [--request] [--compare-secret]\nRedacted configuration, optional read-only schema check and offline token-request construction. --compare-secret uses a hidden interactive prompt to compare the current BotFather secret with WEB. No Telegram request, login, printed secrets or customer records.');return}
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>{},error:()=>{}});
 const config=browserLoginConfig(),settings=telegramLoginSettings({...process.env,TELEGRAM_LOGIN_ENABLED:'true'});
 const required=['TELEGRAM_LOGIN_CLIENT_ID','TELEGRAM_LOGIN_CLIENT_SECRET','TELEGRAM_BOT_TOKEN','BETTER_AUTH_URL'];
 const require=createRequire(import.meta.url),revision=process.env.SOURCE_COMMIT??process.env.COOLIFY_BUILD_COMMIT??process.env.GIT_COMMIT;
 const versions=Object.fromEntries(['better-auth-telegram','better-auth','@better-auth/core'].map(name=>{
  let directory=dirname(require.resolve(name));
  for(let depth=0;depth<4;depth++,directory=dirname(directory))try{const info=JSON.parse(readFileSync(join(directory,'package.json'),'utf8')) as {name?:string;version?:string};if(info.name===name&&typeof info.version==='string'&&/^\d+\.\d+\.\d+(?:[-+.][A-Za-z0-9.-]+)?$/.test(info.version))return [name,info.version]}catch{}
  return [name,'unreported'];
 }));
 const secret=process.env.TELEGRAM_LOGIN_CLIENT_SECRET??'';
 const secretMatchesBotFather=args.includes('--compare-secret')?await matchesCurrentBotFatherSecret(secret):undefined;
 if(args.includes('--compare-secret')&&secretMatchesBotFather===undefined){process.exitCode=1;return}
 let tokenRequest:Awaited<ReturnType<typeof import('../src/modules/auth/telegram-oidc-token-request').telegramOIDCTokenRequestDiagnostics>>|undefined;
 if(args.includes('--request')&&settings){
  const {telegramOIDCTokenRequestDiagnostics}=await import('../src/modules/auth/telegram-oidc-token-request');
  tokenRequest=await telegramOIDCTokenRequestDiagnostics(settings);
 }
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
 const ready=config.enabled&&config.configured&&secretMatchesBotFather!==false&&(!args.includes('--schema')||schema.status==='ok');
 console.log(JSON.stringify({...config,missing:required.filter(key=>!process.env[key]),clientId:settings?.clientId??null,clientIdMatchesBot:!!process.env.TELEGRAM_LOGIN_CLIENT_ID&&process.env.TELEGRAM_LOGIN_CLIENT_ID===process.env.TELEGRAM_BOT_TOKEN?.split(':')[0],callback:settings?.callback??null,integration:'better-auth-telegram',versions,revision:revision&&/^[0-9a-f]{7,40}$/i.test(revision)?revision:'unreported',credentials:{secretPresent:!!secret,secretHasWhitespace:/\s/.test(secret),secretHasOuterQuotes:/^["']|["']$/.test(secret),secretEqualsBotToken:!!secret&&secret===process.env.TELEGRAM_BOT_TOKEN,secretEqualsAuthSecret:!!secret&&secret===process.env.BETTER_AUTH_SECRET,...(secretMatchesBotFather!==undefined?{secretMatchesBotFather}:{})},credentialVerification:'not-performed',...(tokenRequest?{tokenRequest}:{}),schema,ready},null,2));
 if(!ready)process.exitCode=1;
}
void main().catch(()=>{console.error(JSON.stringify({error:'CHECK_UNAVAILABLE'}));process.exitCode=1});
