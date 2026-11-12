import {checkChapaReadiness} from './chapa-readiness';
import {chapaInlineAvailability,chapaInlineConfiguredMethods} from './chapa-inline-provider';

type Environment=Record<string,string|undefined>;
export const CHAPA_INLINE_MIGRATION='202611120001_chapa_v2_inline';
export type ChapaInlineSchemaSnapshot={migrationApplied:boolean;identityConstraint:boolean;guardTrigger:boolean;reconcileIndex:boolean};

/** Redacted deployment diagnostics only. No API call, credential value,
 * fingerprint or financial/customer record is included in this report. */
export async function checkChapaInlineReadiness(raw:Environment=process.env,readSchema?:()=>Promise<ChapaInlineSchemaSnapshot>){
 const common=await checkChapaReadiness({...raw}),health=chapaInlineAvailability(raw),missing=[...common.missingPrerequisites];
 if(!health.publicKeyValid)missing.push('CHAPA_PUBLIC_KEY');
 if(health.privateKeyIsPublic&&!missing.includes('CHAPA_PRIVATE_KEY'))missing.push('CHAPA_PRIVATE_KEY');
 const disabledCreationGates:string[]=[];
 if(raw.PAYMENT_GATEWAY!=='CHAPA')disabledCreationGates.push('PAYMENT_GATEWAY');
 if(raw.CHAPA_ENABLED!=='true')disabledCreationGates.push('CHAPA_ENABLED');
 if(raw.CHAPA_INLINE_ENABLED!=='true')disabledCreationGates.push('CHAPA_INLINE_ENABLED');
 if(health.mode==='live'&&raw.CHAPA_LIVE_ENABLED!=='true')disabledCreationGates.push('CHAPA_LIVE_ENABLED');
 const configuredMethods=chapaInlineConfiguredMethods(raw),known=['telebirr','cbebirr','mpesa','ebirr'],supplied=raw.CHAPA_INLINE_METHODS?.split(',').map(value=>value.trim()).filter(Boolean),cbeBankEnabled=health.enabled&&raw.CHAPA_INLINE_CBE_BANK_ENABLED==='true';
 const schema:{status:'not-requested'|'unavailable'|'pending'|'incomplete'|'ok';expectedMigration:string}&Partial<ChapaInlineSchemaSnapshot>={status:'not-requested',expectedMigration:CHAPA_INLINE_MIGRATION};
 if(readSchema){try{const snapshot=await readSchema();Object.assign(schema,snapshot,{status:!snapshot.migrationApplied?'pending':snapshot.identityConstraint&&snapshot.guardTrigger&&snapshot.reconcileIndex?'ok':'incomplete'})}catch{schema.status='unavailable'}}
 const ready=health.enabled&&missing.length===0&&(configuredMethods.length>0||cbeBankEnabled)&&(schema.status==='ok'||schema.status==='not-requested');
 return {apiVersion:'v2' as const,mode:health.mode,configured:health.configured,creationEnabled:health.enabled,recoveryEnabled:health.recoveryEnabled,missingPrerequisites:missing,disabledCreationGates,credentials:{privateKeyPresent:!!raw.CHAPA_PRIVATE_KEY,publicKeyPresent:!!raw.CHAPA_PUBLIC_KEY,publicKeyValid:health.publicKeyValid,privateKeyIsPublic:health.privateKeyIsPublic},configuredMethods,unrecognizedMethodsPresent:!!supplied?.some(method=>!known.includes(method)),cbeBankEnabled,schema,ready};
}
