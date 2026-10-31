import nextEnv from '@next/env';
import {PrismaClient} from '@prisma/client';
import {runtimeDatabaseUrl} from '../src/lib/database-config';
import {chapaConfigurationFingerprint,chapaTransport,ChapaProviderError,isChapaHostedSessionReference,parseChapaEvidence} from '../src/modules/payments/chapa-provider';
import {matchesChapaMetadata} from '../src/modules/payments/chapa-metadata';
import {classifyChapaApiError} from '../src/lib/chapa-api-error';

/** Read-only: inspects one checkout and optionally GETs Chapa verification.
 * Never creates a checkout, processes a webhook, or applies a ledger credit. */
async function main(){
 const args=process.argv.slice(2),[flag,value,...rest]=args;
 if(!['--checkout','--merchant'].includes(flag)||!value||!(flag==='--checkout'?/^[a-f0-9-]{36}$/i:/^[A-Za-z0-9._-]{1,20}$/).test(value)||rest.some(arg=>arg!=='--provider')||rest.length>1)throw Error('Use --checkout <UUID> or --merchant <reference>, optionally --provider.');
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info(){},error(){}});
 const db=new PrismaClient({datasourceUrl:runtimeDatabaseUrl(process.env.DATABASE_URL),log:[]});
 try{
  const order=await db.chapaCheckout.findFirst({where:flag==='--checkout'?{id:value}:{merchantReference:value}});
  if(!order){console.log(JSON.stringify({found:false}));return}
  const events=await db.chapaWebhookEvent.findMany({where:{checkoutId:order.id},select:{status:true,attempts:true,nextAttemptAt:true,completedAt:true},orderBy:{receivedAt:'desc'},take:5});
  const diagnosticCodes=new Set(['INVALID_FORMAT','INVALID_VALUE','MISSING_REQUIRED_FIELD','INVALID_STATE','NOT_FOUND','PROCESSING_FAILED','UNAUTHORIZED','FORBIDDEN','RATE_LIMITED','HTTP_ERROR']);
  const initialization=order.initializationErrorCode||order.initializationHttpStatus?{http:order.initializationHttpStatus,code:diagnosticCodes.has(order.initializationErrorCode??'')?order.initializationErrorCode:'HTTP_ERROR',category:classifyChapaApiError(order.initializationHttpStatus,order.initializationErrorCode)}:null;
  const report:Record<string,unknown>={found:true,checkoutId:order.id,mode:order.mode,status:order.status,reason:order.reason,providerStatus:order.providerStatus,verificationState:order.verificationState,creditApplied:!!order.creditJournalId,credentialMatches:order.credentialFingerprint===chapaConfigurationFingerprint(),initialization,nextCheckAt:order.nextCheckAt,leaseUntil:order.leaseUntil,events};
  if(rest.includes('--provider')){
   try{
    const raw=await chapaTransport.lookup(order.merchantReference),proof=parseChapaEvidence(raw);
    report.provider={evidenceValid:!!proof,...(proof?{status:proof.status,matches:{merchant:proof.merchantReference===order.merchantReference,amount:proof.amountCents===String(order.amountCents),currency:proof.currency===order.currency,mode:!proof.mode||proof.mode===order.mode,reference:!proof.chapaReference||!order.chapaReference||proof.chapaReference===order.chapaReference||isChapaHostedSessionReference(order.checkoutUrl,order.chapaReference,order.mode as 'test'|'live'),metadata:matchesChapaMetadata(order.initialization,proof.meta,order.id)}}:{})};
   }catch(error){report.provider=error instanceof ChapaProviderError?{http:error.httpStatus,code:error.providerCode}:{unavailable:true}}
  }
  console.log(JSON.stringify(report,null,2));
 }finally{await db.$disconnect()}
}
const deadline=setTimeout(()=>{console.error(JSON.stringify({error:'DIAGNOSTIC_TIMEOUT'}));process.exit(1)},25000);
void main().catch(()=>{console.error(JSON.stringify({error:'CHECKOUT_DIAGNOSTIC_UNAVAILABLE',usage:'npx --no-install tsx scripts/check-chapa-checkout.ts --merchant <reference> [--provider]'}));process.exitCode=1}).finally(()=>clearTimeout(deadline));
