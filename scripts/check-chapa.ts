import nextEnv from '@next/env';
import {checkChapaReadiness,chapaReadinessPassed} from '../src/modules/payments/chapa-readiness';

async function main(){
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--schema','--methods','--help'].includes(arg))){console.error(JSON.stringify({error:'UNKNOWN_OPTION',usage:'npx.cmd tsx scripts/check-chapa.ts [--schema] [--methods]'}));process.exitCode=1;return}
 if(args.includes('--help')){console.log('npx.cmd tsx scripts/check-chapa.ts [--schema] [--methods]\nOffline configuration report by default. Optional checks require reviewed TEST configuration; --methods also requires CHAPA_ENABLED=true. No payments are created or verified.');return}
 // Match the app's .env* precedence without printing file contents/load errors.
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info:()=>{},error:()=>{}});
 const deadline=setTimeout(()=>{console.error(JSON.stringify({error:'CHECK_TIMEOUT'}));process.exit(1)},25000);
 try{
  const report=await checkChapaReadiness(process.env,{schema:args.includes('--schema'),methods:args.includes('--methods')},{
   readSchema:async()=>{
    // Import/connect only after the diagnostic's TEST/configuration/schema gate.
    const [{PrismaClient},{runtimeDatabaseUrl},{reconcileChapaReceipts}]=await Promise.all([import('@prisma/client'),import('../src/lib/database-config'),import('../src/modules/payments/chapa-reconcile')]);
    const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
    try{return {driftCount:(await reconcileChapaReceipts(db)).length}}finally{await db.$disconnect()}
   },
  });
  console.log(JSON.stringify(report,null,2));
  if(!chapaReadinessPassed(report))process.exitCode=1;
 }finally{clearTimeout(deadline)}
}
void main().catch(()=>{console.error(JSON.stringify({error:'CHECK_UNAVAILABLE'}));process.exitCode=1});
