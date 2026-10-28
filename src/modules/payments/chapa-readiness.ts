import {chapaAvailability,createChapaTransport,parseChapaPaymentMethods} from './chapa-provider';

type Environment=Record<string,string|undefined>;
type Options={schema?:boolean;methods?:boolean};
type Dependencies={readSchema?:()=>Promise<{driftCount:number}>;fetcher?:typeof fetch};
type Method={slug:string;minimumCents:string;maximumCents:string;isMobileMoney:boolean};
type CheckStatus='not-requested'|'blocked'|'ok'|'unavailable';
export type ChapaReadiness={
 mode:'test'|'live';configured:boolean;creationEnabled:boolean;recoveryEnabled:boolean;
 missingPrerequisites:string[];
 schema:{status:CheckStatus|'drift';driftCount?:number};
 methods:{status:CheckStatus;items?:Method[]};
};

function secureOrigins(raw:Environment){
 try{const app=new URL(raw.MINI_APP_URL??''),auth=new URL(raw.BETTER_AUTH_URL??'');return app.protocol==='https:'&&auth.protocol==='https:'&&app.origin===auth.origin&&!app.username&&!app.password&&!auth.username&&!auth.password}catch{return false}
}
function database(raw:Environment){
 try{const url=new URL(raw.DATABASE_URL??'');return {valid:['postgres:','postgresql:'].includes(url.protocol),local:['localhost','127.0.0.1','[::1]'].includes(url.hostname)}}catch{return {valid:false,local:false}}
}
/** Advisory labels only. The existing availability/transport helpers remain
 * authoritative, and no input values, fingerprints or provider errors escape. */
function missingPrerequisites(raw:Environment,mode:'test'|'live'){
 const missing:string[]=[],require=(label:string,valid:boolean)=>{if(!valid&&!missing.includes(label))missing.push(label)};
 require('DATABASE_URL',database(raw).valid);
 require('CHAPA_MODE',!raw.CHAPA_MODE||['test','live'].includes(raw.CHAPA_MODE));
 require('CHAPA_SCHEMA_READY',raw.CHAPA_SCHEMA_READY==='true');
 const key=raw.CHAPA_PRIVATE_KEY??'',secret=raw.CHAPA_WEBHOOK_SECRET??'';
 require('CHAPA_PRIVATE_KEY',new RegExp(`^CHAPA_${mode==='live'?'LIVE':'TEST'}_[A-Za-z0-9_-]{16,240}$`).test(key)&&!/REPLACE|CHANGE_ME|example|fixture/i.test(key));
 require('CHAPA_WEBHOOK_SECRET',secret.length>=32&&secret.length<=256&&!/REPLACE|CHANGE_ME/i.test(secret));
 require('MINI_APP_URL / BETTER_AUTH_URL',secureOrigins(raw));
 require('CHAPA_BASE_URL',!raw.CHAPA_BASE_URL||raw.CHAPA_BASE_URL==='https://api.chapa.global');
 require('CHAPA_CURRENCY',!raw.CHAPA_CURRENCY||raw.CHAPA_CURRENCY==='ETB');
 if(mode==='test'){
  require('APP_ENV',['local','test','staging'].includes(raw.APP_ENV??''));
  require('VERCEL_ENV',raw.VERCEL_ENV!=='production');
  if(database(raw).valid&&!database(raw).local){require('APP_ENV',raw.APP_ENV==='staging');require('CHAPA_TEST_ENVIRONMENT_REVIEWED',raw.CHAPA_TEST_ENVIRONMENT_REVIEWED==='true')}
 }else{
  require('APP_ENV',raw.APP_ENV==='production');
  require('NODE_ENV',raw.NODE_ENV==='production');
  require('VERCEL_ENV',!['preview','development'].includes(raw.VERCEL_ENV??''));
  require('CHAPA_MERCHANT_REVIEWED',raw.CHAPA_MERCHANT_REVIEWED==='true');
  for(const name of ['DEV_IDENTITY_ENABLED','DEV_POINTS_ENABLED','STAGING_DEMO_ENABLED'])require(name,raw[name]!=='true');
 }
 return missing;
}

/** Offline by default. Explicit checks are read-only and limited to configured
 * TEST environments; this module never creates or verifies a payment. */
export async function checkChapaReadiness(raw:Environment,options:Options={},dependencies:Dependencies={}):Promise<ChapaReadiness>{
 raw={...raw};
 const health=chapaAvailability(raw),missing=missingPrerequisites(raw,health.mode);
 const report:ChapaReadiness={mode:health.mode,configured:health.configured,creationEnabled:health.enabled,recoveryEnabled:health.recoveryEnabled,missingPrerequisites:missing,schema:{status:'not-requested'},methods:{status:'not-requested'}};
 const reviewedTest=health.mode==='test'&&health.configured&&missing.length===0;
 if(options.schema){
  report.schema={status:'blocked'};
  if(reviewedTest&&dependencies.readSchema){
   try{const {driftCount}=await dependencies.readSchema();if(!Number.isSafeInteger(driftCount)||driftCount<0)throw Error();report.schema={status:driftCount?'drift':'ok',driftCount}}
   catch{report.schema={status:'unavailable'}}
  }
 }
 if(options.methods){
  report.methods={status:'blocked'};
  // Existing transport requires the creation gate even for GET methods. Do not
  // override a paused gate or substitute live credentials for this diagnostic.
  if(reviewedTest&&health.enabled){
   try{
    const found=parseChapaPaymentMethods(await createChapaTransport({env:raw,fetcher:dependencies.fetcher}).methods());
    if(found===null)throw Error();
    const secrets=[raw.CHAPA_PRIVATE_KEY,raw.CHAPA_WEBHOOK_SECRET].filter((value):value is string=>!!value);
    report.methods={status:'ok',items:found.map(({slug,minimumCents,maximumCents,isMobileMoney})=>({slug:secrets.some(secret=>slug.includes(secret))?'redacted':slug,minimumCents,maximumCents,isMobileMoney}))};
   }catch{report.methods={status:'unavailable'}}
  }
 }
 return report;
}

export function chapaReadinessPassed(report:ChapaReadiness){
 return report.configured&&report.missingPrerequisites.length===0&&[report.schema.status,report.methods.status].every(status=>status==='ok'||status==='not-requested');
}
