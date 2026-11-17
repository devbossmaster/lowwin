/** Synthetic, cryptographically verified OIDC callback and account bootstrap.
 * Creates/removes its own loopback database. Never calls Telegram or a bot.
 * TEST_DATABASE_URL=postgresql://.../anchor_test tsx scripts/benchmark-telegram-login.ts
 */
import {generateKeyPairSync,randomInt,randomUUID,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Client} from 'pg';
import assert from 'node:assert/strict';

const target=new URL(process.env.TEST_DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Explicit disposable loopback TEST_DATABASE_URL required');
const databaseName='lowwin_login_bench_'+randomUUID().replaceAll('-','').slice(0,12)+'_test';
const administrative=new URL(target);administrative.pathname='/postgres';
const database=new URL(target);database.pathname='/'+databaseName;
const admin=new Client({connectionString:administrative.href});await admin.connect();await admin.query(`CREATE DATABASE "${databaseName}"`);
const origin='http://localhost:3157'; // Fixture origin only; application canonical configuration is unchanged.
Object.assign(process.env,{DATABASE_URL:database.href,DIRECT_URL:database.href,TEST_DATABASE_URL:database.href,APP_ENV:'local',NODE_ENV:'test',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'local-oidc-benchmark-secret-at-least-thirty-two',TELEGRAM_BOT_TOKEN:'123456789:synthetic_benchmark_not_a_bot_token',TELEGRAM_BOT_USERNAME:'benchmark_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'local-oidc-benchmark-webhook-never-sent',PHONE_CONTACT_KEY_ID:'bench-oidc',PHONE_CONTACT_KEYS:JSON.stringify({'bench-oidc':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),TELEGRAM_LOGIN_ENABLED:'true',TELEGRAM_LOGIN_CLIENT_ID:'123456789',TELEGRAM_LOGIN_CLIENT_SECRET:'synthetic-oidc-benchmark-client-secret',REFERRAL_REWARDS_SCHEMA_READY:'false',DEV_IDENTITY_ENABLED:'false',CHAPA_ENABLED:'false',CHAPA_LIVE_ENABLED:'false',PAYMENTS_LIVE_ENABLED:'false'});
const nativeFetch=globalThis.fetch;
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'benchmark-fixture',alg:'RS256',use:'sig'};
const issued=new Map<string,{token:string;verifier:string}>(),providerCalls={token:0,jwks:0,userInfo:0};
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(url==='https://oauth.telegram.org/.well-known/jwks.json'){providerCalls.jwks++;return Response.json({keys:[jwk]})}
 if(url!=='https://oauth.telegram.org/token'){providerCalls.userInfo++;throw Error('Unexpected external HTTP in benchmark')}
 providerCalls.token++;const form=new URLSearchParams(String(init?.body)),entry=issued.get(form.get('code')??'');
 assert(entry);assert.equal(form.get('code_verifier'),entry.verifier);assert.equal(form.get('client_id'),'123456789');assert.equal(form.has('client_secret'),false);issued.delete(form.get('code')!);
 return Response.json({id_token:entry.token,access_token:'synthetic-not-a-real-token',token_type:'Bearer',expires_in:3600});
};
const clients:Array<{client:import('@prisma/client').PrismaClient;queries:()=>number}>=[];
const report:{at:string;scope:string;success:boolean;groups:unknown[];providerCalls:typeof providerCalls;databaseCleaned:boolean;limitations:string[];generatedAt?:string}={at:new Date().toISOString(),scope:'Full installed OIDC provider callback, JWT/JWKS, identity/contact binding, signed session and owned account bootstrap; synthetic provider HTTP',success:false,groups:[],providerCalls,databaseCleaned:false,limitations:['Excludes user approval time, actual Telegram HTTP, redirect transport, browser hydration and production database/proxy latency.','Cold means fresh auth/JWKS instance and reconnected Prisma pool at callback; warm means reused instance, cached JWKS and open pool.','These synthetic measurements do not establish a production p95 or guarantee the 1-2 second target.']};
try{
 const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,windowsHide:true,encoding:'utf8'});if(migration.status!==0)throw Error('Disposable migration failed');
 const {PrismaClient}=await import('@prisma/client'),{createAuth}=await import('../src/modules/auth/server'),{prepareTelegramOIDCIdentity}=await import('../src/modules/auth/telegram-oidc-identity'),{getMiniSession}=await import('../src/modules/auth/mini-access'),{readMiniAccount}=await import('../src/modules/auth/mini-account'),{measureTelegramAuth,timedTelegramAuthResponse}=await import('../src/modules/auth/telegram-timing');
 const connection=()=>{let queries=0;const client=new PrismaClient({datasourceUrl:database.href,log:[{emit:'event',level:'query'}]});client.$on('query',()=>{queries++});const entry={client,queries:()=>queries};clients.push(entry);return entry};
 const profile=()=>{const id=randomInt(4000000000,5000000000);return {iss:'https://oauth.telegram.org',aud:'123456789',sub:'fixture-'+randomUUID(),id,name:'Synthetic benchmark player',phone_number:'2519'+String(id).slice(-8),phone_number_verified:true}};
 async function callback(entry:ReturnType<typeof connection>,claims:ReturnType<typeof profile>,cold:boolean){
  const ip=`127.${randomInt(1,254)}.${randomInt(1,254)}.${randomInt(1,254)}`,auth=createAuth(entry.client),start=await auth.handler(new Request(origin+'/api/auth/sign-in/social',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({provider:'telegram-oidc',callbackURL:origin+'/my-bids',disableRedirect:true})}));
  assert.equal(start.status,200);const authorization=new URL((await start.json()).url),state=authorization.searchParams.get('state')!;
  const stored=JSON.parse((await entry.client.verification.findFirstOrThrow({where:{value:{contains:state}}})).value),code='fixture-'+randomUUID(),now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url'),payload=Buffer.from(JSON.stringify({...claims,iat:now,exp:now+3600,nonce:authorization.searchParams.get('nonce')})).toString('base64url');
  issued.set(code,{token:header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),pair.privateKey).toString('base64url'),verifier:stored.codeVerifier});
  if(cold)await entry.client.$disconnect();const queryStart=entry.queries(),started=performance.now();
  const response=await timedTelegramAuthResponse(async()=>{
   const result=await auth.handler(new Request(origin+'/api/auth/callback/telegram-oidc?'+new URLSearchParams({state,code}),{headers:{'x-forwarded-for':ip,cookie:start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}}));
   assert.equal(result.headers.get('location'),origin+'/my-bids');
   const cookie=result.headers.getSetCookie().find(c=>c.startsWith('better-auth.session_token='));assert(cookie);
   const session=await measureTelegramAuth('me_session',()=>getMiniSession(new Headers({cookie:cookie.split(';')[0]}),entry.client));assert.equal(session?.telegramId,String(claims.id));
   const me=await measureTelegramAuth('me_account',()=>readMiniAccount(entry.client,session!.user,session!.session.id,{displayName:session!.user.name}));assert(me.sessionKey);assert.equal(me.user.id,session!.user.id);return result;
  });
  return {totalMs:performance.now()-started,queries:entry.queries()-queryStart,serverTiming:response.headers.get('server-timing')};
 }
 const warm=connection(),returning=profile();await prepareTelegramOIDCIdentity({...returning,id:String(returning.id)},{clientId:'123456789'},warm.client);await callback(warm,profile(),false);
 for(const cold of [false,true])for(const existing of [false,true]){
  const samples:Awaited<ReturnType<typeof callback>>[]=[];
  for(let index=0;index<(cold?5:20);index++){const entry=cold?connection():warm;samples.push(await callback(entry,existing?returning:profile(),cold));if(cold)await entry.client.$disconnect()}
  const times=samples.map(s=>s.totalMs).sort((a,b)=>a-b),quantile=(p:number)=>Math.round(times[Math.ceil(times.length*p)-1]*10)/10;
  report.groups.push({state:cold?'cold':'warm',user:existing?'returning':'new',n:samples.length,p50Ms:quantile(.5),p95Ms:quantile(.95),samples});
 }
 assert.equal(providerCalls.userInfo,0);report.success=true;
}finally{
 globalThis.fetch=nativeFetch;await Promise.all(clients.map(c=>c.client.$disconnect()));const {db}=await import('../src/lib/db');await db.$disconnect();await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);await admin.end();report.databaseCleaned=true;report.generatedAt=new Date().toISOString();mkdirSync('docs/measurements',{recursive:true});writeFileSync('docs/measurements/telegram-login-2026-11-17.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({groups:report.groups.map((group:any)=>({state:group.state,user:group.user,n:group.n,p50Ms:group.p50Ms,p95Ms:group.p95Ms})),providerCalls,databaseCleaned:report.databaseCleaned}));
}
