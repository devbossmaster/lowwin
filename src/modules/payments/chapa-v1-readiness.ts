import {chapaV1Availability,chapaV1Methods} from './chapa-v1-provider';
import {isChapaWebhookSecret} from './chapa-provider';

type Environment=Record<string,string|undefined>;
export const CHAPA_V1_MIGRATION='202611110001_chapa_v1_checkout';
export const CHAPA_V1_HOSTED_ONLY_MIGRATION='202611110001_chapa_v1_hosted';
const knownMethods=['telebirr','cbebirr','mpesa','ebirr'] as const;
const requiredConstraints=['chapa_v1_version','chapa_v1_inline_fields'] as const;
export type ChapaV1SchemaSnapshot={appliedMigrations:string[];constraints:string[];reconcileIndex:boolean};

/** Offline diagnostics only. Labels and allowlisted method names are safe to log;
 * availability remains authoritative and no environment value is returned. */
export function chapaV1ConfigurationReport(raw:Environment=process.env){
 const health=chapaV1Availability(raw),missing:string[]=[],require=(name:string,ok:boolean)=>{if(!ok&&!missing.includes(name))missing.push(name)};
 let local=false,validDatabase=false,origins=false;
 try{const u=new URL(raw.DATABASE_URL??'');validDatabase=['postgres:','postgresql:'].includes(u.protocol);local=['localhost','127.0.0.1','[::1]'].includes(u.hostname)}catch{}
 try{const app=new URL(raw.MINI_APP_URL??''),auth=new URL(raw.BETTER_AUTH_URL??'');origins=app.protocol==='https:'&&app.origin===auth.origin&&!app.username&&!app.password}catch{}
 require('DATABASE_URL',validDatabase);
 require('CHAPA_MODE',!raw.CHAPA_MODE||['test','live'].includes(raw.CHAPA_MODE));
 require('MINI_APP_URL / BETTER_AUTH_URL',origins);
 require('CHAPA_SCHEMA_READY',raw.CHAPA_SCHEMA_READY==='true');
 require('CHAPA_V1_SECRET_KEY',(health.mode==='test'?/^CHASECK_TEST-[A-Za-z0-9_-]{16,240}$/:/^CHASECK(?:_LIVE)?-[A-Za-z0-9_-]{16,240}$/).test(raw.CHAPA_V1_SECRET_KEY??''));
 require('CHAPA_V1_PUBLIC_KEY',(health.mode==='test'?/^CHAPUBK_TEST-[A-Za-z0-9_-]{16,240}$/:/^CHAPUBK(?:_LIVE)?-[A-Za-z0-9_-]{16,240}$/).test(raw.CHAPA_V1_PUBLIC_KEY??''));
 require('CHAPA_V1_WEBHOOK_SECRET',isChapaWebhookSecret(raw.CHAPA_V1_WEBHOOK_SECRET));
 if(health.mode==='test'){
  require('APP_ENV',['local','test','staging'].includes(raw.APP_ENV??''));
  require('VERCEL_ENV',raw.VERCEL_ENV!=='production');
  if(!local){require('APP_ENV',raw.APP_ENV==='staging');require('CHAPA_TEST_ENVIRONMENT_REVIEWED',raw.CHAPA_TEST_ENVIRONMENT_REVIEWED==='true')}
 }else{
  require('APP_ENV',raw.APP_ENV==='production');require('NODE_ENV',raw.NODE_ENV==='production');
  require('CHAPA_MERCHANT_REVIEWED',raw.CHAPA_MERCHANT_REVIEWED==='true');
  require('VERCEL_ENV',!['preview','development'].includes(raw.VERCEL_ENV??''));
  for(const key of ['DEV_IDENTITY_ENABLED','DEV_POINTS_ENABLED','STAGING_DEMO_ENABLED'])require(key,raw[key]!=='true');
 }
 const creationGates:string[]=[];
 if(raw.PAYMENT_GATEWAY!=='CHAPA')creationGates.push('PAYMENT_GATEWAY');
 if(raw.CHAPA_V1_ENABLED!=='true')creationGates.push('CHAPA_V1_ENABLED');
 if(health.mode==='live'&&raw.CHAPA_LIVE_ENABLED!=='true')creationGates.push('CHAPA_LIVE_ENABLED');
 const supplied=(raw.CHAPA_V1_METHODS??'').split(',').map(v=>v.trim()).filter(Boolean);
 const configuredMethods=knownMethods.filter(method=>supplied.includes(method));
 const enabledMethods=chapaV1Methods(raw).map(method=>method.slug);
 const cbeBankConfigured=raw.CHAPA_V1_CBE_BANK_ENABLED==='true';
 return {mode:health.mode,configured:health.configured,creationEnabled:health.enabled,recoveryEnabled:health.recoveryEnabled,
  missingPrerequisites:missing,disabledCreationGates:creationGates,configuredMethods,enabledMethods,
  unrecognizedMethodsPresent:supplied.some(method=>!knownMethods.includes(method as typeof knownMethods[number])),
  methodSelectionRequired:configuredMethods.length===0&&!cbeBankConfigured,cbeBankEnabled:health.enabled&&cbeBankConfigured,
  readyForNewPayments:health.enabled&&missing.length===0&&(enabledMethods.length>0||cbeBankConfigured)};
}

export async function checkChapaV1Readiness(raw:Environment=process.env,readSchema?:()=>Promise<ChapaV1SchemaSnapshot>){
 const configuration=chapaV1ConfigurationReport({...raw});
 const schema:{status:'not-requested'|'unavailable'|'pending'|'incomplete'|'conflicting'|'ok';expectedMigration:string;applied?:boolean;hostedOnlyMigrationApplied?:boolean;missingConstraints?:string[];reconcileIndex?:boolean}={status:'not-requested',expectedMigration:CHAPA_V1_MIGRATION};
 if(readSchema){
  try{
   const found=await readSchema(),applied=found.appliedMigrations.includes(CHAPA_V1_MIGRATION),hostedOnlyMigrationApplied=found.appliedMigrations.includes(CHAPA_V1_HOSTED_ONLY_MIGRATION),missingConstraints=requiredConstraints.filter(name=>!found.constraints.includes(name));
   Object.assign(schema,{applied,hostedOnlyMigrationApplied,missingConstraints,reconcileIndex:found.reconcileIndex,
    status:hostedOnlyMigrationApplied?'conflicting':!applied?'pending':missingConstraints.length||!found.reconcileIndex?'incomplete':'ok'});
  }catch{schema.status='unavailable'}
 }
 return {...configuration,schema,ready:configuration.readyForNewPayments&&(schema.status==='not-requested'||schema.status==='ok')};
}
