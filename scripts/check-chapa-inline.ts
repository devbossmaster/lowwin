import nextEnv from '@next/env';
import {checkChapaInlineReadiness} from '../src/modules/payments/chapa-inline-readiness';
import {readChapaInlineSchema} from '../src/modules/payments/chapa-inline-schema';

async function main(){
 const args=process.argv.slice(2),usage='npx --no-install tsx scripts/check-chapa-inline.ts [--schema] [--methods]';
 if(args.some(arg=>!['--schema','--methods','--help'].includes(arg))){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage}));process.exitCode=1;return}
 if(args.includes('--help')){console.log(usage+'\nRedacted v2 Inline configuration. --schema reads migration/column/constraint/active-guard/index metadata only, including both confirmation migrations. --methods performs only GET payment methods in an enabled, reviewed TEST environment; LIVE is blocked. No payments, customer records or credential values. Run on WEB and the Chapa worker.');return}
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>{},error:()=>{}});
 const timeout=setTimeout(()=>{console.error(JSON.stringify({error:'CHECK_TIMEOUT'}));process.exit(1)},25000);
 try{
  const report=await checkChapaInlineReadiness(process.env,args.includes('--schema')?async()=>{
   const [{PrismaClient},{runtimeDatabaseUrl}]=await Promise.all([import('@prisma/client'),import('../src/lib/database-config')]);
   const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
   try{return await readChapaInlineSchema(db)}finally{await db.$disconnect()}
  }:undefined,{methods:args.includes('--methods')});
  console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=1;
 }finally{clearTimeout(timeout)}
}
void main().catch(()=>{console.error(JSON.stringify({error:'CHECK_UNAVAILABLE'}));process.exitCode=1});
