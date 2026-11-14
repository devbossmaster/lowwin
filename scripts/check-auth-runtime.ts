import nextEnv from '@next/env';
import {PrismaClient} from '@prisma/client';
import {runtimeDatabaseUrl} from '../src/lib/database-config';
import {databaseErrorSummary} from '../src/lib/database-error';

/** Operator-only, read-only. No customer rows, Telegram calls or session writes. */
async function main(){
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info(){},error(){}});
 const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
 let stage='generated-client';
 const deadline=setTimeout(()=>{console.error(JSON.stringify({ready:false,stage,code:'CHECK_TIMEOUT'}));process.exit(1)},25000);
 try{
  const {createAuth}=await import('../src/modules/auth/server');
  const context=await createAuth(db).$context;
  await context.checkSchema?.();
  stage='runtime-auth-columns';
  const permissions=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   // WHERE false verifies schema and SELECT access without returning accounts.
   await tx.$queryRaw`SELECT u.id,u."telegramId",u."telegramPhoneNumber",a."providerId",a."accountId",a."telegramId",s.token,s."telegramAuthSource",s."telegramLaunchId",v.identifier,v.value,r.key,r.count,r."lastRequest",c."verificationSource",c."oidcIssuer",c."oidcSubject"
    FROM public."user" u CROSS JOIN public.account a CROSS JOIN public.session s CROSS JOIN public.verification v CROSS JOIN public."rateLimit" r CROSS JOIN public."TelegramOwnContact" c WHERE false`;
   stage='runtime-auth-grants';
   return tx.$queryRaw<Array<{table:string;select:boolean;insert:boolean;update:boolean;delete:boolean}>>`
    SELECT name AS "table",has_table_privilege(current_user,format('public.%I',name),'SELECT') AS "select",has_table_privilege(current_user,format('public.%I',name),'INSERT') AS "insert",has_table_privilege(current_user,format('public.%I',name),'UPDATE') AS "update",has_table_privilege(current_user,format('public.%I',name),'DELETE') AS "delete"
    FROM (VALUES ('user'),('account'),('session'),('verification'),('rateLimit'),('TelegramOwnContact')) AS required(name)`;
  },{maxWait:5000,timeout:15000});
  const deletable=new Set(['session','verification','rateLimit']);
  const missingPermissions=permissions.flatMap(row=>(['select','insert','update','delete'] as const).filter(action=>(action!=='delete'||deletable.has(row.table))&&!row[action]).map(action=>({table:row.table,action})));
  console.log(JSON.stringify({ready:missingPermissions.length===0,generatedClient:'ok',runtimeAuthColumns:'ok',missingPermissions,telegramCredentialVerification:'not-performed'},null,2));
  if(missingPermissions.length)process.exitCode=1;
 }catch(error){
  console.error(JSON.stringify({ready:false,stage,...databaseErrorSummary(error)}));process.exitCode=1;
 }finally{clearTimeout(deadline);await db.$disconnect()}
}
void main().catch(()=>{console.error(JSON.stringify({ready:false,code:'CHECK_UNAVAILABLE'}));process.exitCode=1});
