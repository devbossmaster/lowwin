import nextEnv from '@next/env';
import {CHAPA_INLINE_MIGRATION,checkChapaInlineReadiness} from '../src/modules/payments/chapa-inline-readiness';

async function main(){
 const args=process.argv.slice(2),usage='npx --no-install tsx scripts/check-chapa-inline.ts [--schema]';
 if(args.some(arg=>!['--schema','--help'].includes(arg))){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage}));process.exitCode=1;return}
 if(args.includes('--help')){console.log(usage+'\nRedacted v2 Inline configuration. --schema reads migration/constraint/trigger/index metadata only. No provider HTTP, payments, customer records or credential values. Run on WEB and the Chapa worker.');return}
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>{},error:()=>{}});
 const timeout=setTimeout(()=>{console.error(JSON.stringify({error:'CHECK_TIMEOUT'}));process.exit(1)},25000);
 try{
  const report=await checkChapaInlineReadiness(process.env,args.includes('--schema')?async()=>{
   const [{PrismaClient},{runtimeDatabaseUrl}]=await Promise.all([import('@prisma/client'),import('../src/lib/database-config')]);
   const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
   try{return await db.$transaction(async tx=>{
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const migrations=await tx.$queryRaw<{present:boolean}[]>`SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name=${CHAPA_INLINE_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS present`;
    const constraints=await tx.$queryRaw<{present:boolean}[]>`SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ChapaCheckout' AND c.conname='chapa_v2_inline_identity') AS present`;
    const triggers=await tx.$queryRaw<{present:boolean}[]>`SELECT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ChapaCheckout' AND g.tgname='chapa_inline_v2_guard' AND NOT g.tgisinternal AND g.tgenabled<>'D') AS present`;
    const indexes=await tx.$queryRaw<{present:boolean}[]>`SELECT to_regclass('public."ChapaCheckout_inline_v2_reconcile_idx"') IS NOT NULL AS present`;
    return {migrationApplied:migrations[0]?.present===true,identityConstraint:constraints[0]?.present===true,guardTrigger:triggers[0]?.present===true,reconcileIndex:indexes[0]?.present===true};
   },{maxWait:5000,timeout:10000})}finally{await db.$disconnect()}
  }:undefined);
  console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;
 }finally{clearTimeout(timeout)}
}
void main().catch(()=>{console.error(JSON.stringify({error:'CHECK_UNAVAILABLE'}));process.exitCode=1});
