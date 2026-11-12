import nextEnv from '@next/env';
import {CHAPA_V1_HOSTED_ONLY_MIGRATION,CHAPA_V1_MIGRATION,checkChapaV1Readiness} from '../src/modules/payments/chapa-v1-readiness';

async function main(){
 const args=process.argv.slice(2),usage='npx --no-install tsx scripts/check-chapa-v1.ts [--schema]';
 if(args.some(arg=>!['--schema','--help'].includes(arg))){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage}));process.exitCode=1;return}
 if(args.includes('--help')){console.log(usage+'\nOffline redacted v1 configuration by default. --schema reads migration/constraint metadata only. No provider requests, payments, customer records or secrets. Run on WEB and the Chapa worker.');return}
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>{},error:()=>{}});
 const deadline=setTimeout(()=>{console.error(JSON.stringify({error:'CHECK_TIMEOUT'}));process.exit(1)},25000);
 try{
  const report=await checkChapaV1Readiness(process.env,args.includes('--schema')?async()=>{
   const [{PrismaClient},{runtimeDatabaseUrl}]=await Promise.all([import('@prisma/client'),import('../src/lib/database-config')]);
   const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
   try{
    // A read-only transaction prevents this diagnostic from changing records,
    // including if future schema checks are added accidentally.
    return await db.$transaction(async tx=>{
     await tx.$executeRaw`SET TRANSACTION READ ONLY`;
     const migrations=await tx.$queryRaw<{migration_name:string}[]>`SELECT migration_name FROM public._prisma_migrations WHERE migration_name IN (${CHAPA_V1_MIGRATION},${CHAPA_V1_HOSTED_ONLY_MIGRATION}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
     const constraints=await tx.$queryRaw<{conname:string}[]>`SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ChapaCheckout' AND c.conname IN ('chapa_v1_version','chapa_v1_inline_fields')`;
     const indexes=await tx.$queryRaw<{present:boolean}[]>`SELECT to_regclass('public."ChapaCheckout_v1_reconcile_idx"') IS NOT NULL AS present`;
     return {appliedMigrations:migrations.map(row=>row.migration_name),constraints:constraints.map(row=>row.conname),reconcileIndex:indexes[0]?.present===true};
    },{maxWait:5000,timeout:10000});
   }finally{await db.$disconnect()}
  }:undefined);
  console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;
 }finally{clearTimeout(deadline)}
}
void main().catch(()=>{console.error(JSON.stringify({error:'CHECK_UNAVAILABLE'}));process.exitCode=1});
