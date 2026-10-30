import nextEnv from '@next/env';
import {chapaAvailability,chapaTransport,ChapaError,ChapaProviderError,parseChapaPaymentMethods} from '../src/modules/payments/chapa-provider';

/** Read-only GET of enabled merchant rails. No customer data, checkout POST,
 * database access or payment verification; never print API keys/provider bodies. */
async function main(){
 nextEnv.loadEnvConfig(process.cwd(),process.env.NODE_ENV!=='production',{info(){},error(){}});
 const health=chapaAvailability();
 try{
  const methods=parseChapaPaymentMethods(await chapaTransport.methods());
  if(!methods)throw Error('Invalid catalog');
  console.log(JSON.stringify({mode:health.mode,currency:'ETB',country:'ET',methods:methods.map(({name,slug,minimumCents,maximumCents})=>({name,slug,minimumCents,maximumCents}))},null,2));
 }catch(error){console.log(JSON.stringify({mode:health.mode,configured:health.configured,creationEnabled:health.enabled,error:error instanceof ChapaProviderError?{http:error.httpStatus,code:error.providerCode}:error instanceof ChapaError?{code:error.code}:{code:'METHOD_CATALOG_UNAVAILABLE'}}));process.exitCode=1}
}
const deadline=setTimeout(()=>{console.error(JSON.stringify({error:'METHOD_CATALOG_TIMEOUT'}));process.exit(1)},20000);
void main().finally(()=>clearTimeout(deadline));
