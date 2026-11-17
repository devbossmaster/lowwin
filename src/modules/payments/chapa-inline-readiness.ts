import {checkChapaReadiness} from './chapa-readiness';
import {chapaInlineAvailability,chapaInlineConfiguredMethods} from './chapa-inline-provider';

type Environment=Record<string,string|undefined>;
export const CHAPA_INLINE_MIGRATION='202611120001_chapa_v2_inline';
export const CHAPA_CONFIRMATION_MIGRATIONS=['202611170001_chapa_payment_signals','202611170002_chapa_signal_guards'] as const;
export type ChapaInlineSchemaSnapshot={migrationApplied:boolean;identityConstraint:boolean;guardTrigger:boolean;reconcileIndex:boolean;signalMigrationApplied:boolean;signalGuardsMigrationApplied:boolean;signalColumns:boolean;webhookFeedbackColumns:boolean;signalIndex:boolean;eventFeedbackGuard:boolean;providerEvidenceGuard:boolean;completionStatusConstraint:boolean};

/** Offline by default. Explicit methods checks use only the existing guarded
 * TEST GET. No credential value, fingerprint or customer record is reported. */
export async function checkChapaInlineReadiness(raw:Environment=process.env,readSchema?:()=>Promise<ChapaInlineSchemaSnapshot>,options:{methods?:boolean;fetcher?:typeof fetch}={}){
 raw={...raw};
 const common=await checkChapaReadiness(raw,{methods:options.methods},{fetcher:options.fetcher}),health=chapaInlineAvailability(raw),missing=[...common.missingPrerequisites];
 if(!health.publicKeyValid)missing.push('CHAPA_PUBLIC_KEY');
 if(health.privateKeyIsPublic&&!missing.includes('CHAPA_PRIVATE_KEY'))missing.push('CHAPA_PRIVATE_KEY');
 const disabledCreationGates:string[]=[];
 if(raw.PAYMENT_GATEWAY!=='CHAPA')disabledCreationGates.push('PAYMENT_GATEWAY');
 if(raw.CHAPA_ENABLED!=='true')disabledCreationGates.push('CHAPA_ENABLED');
 if(raw.CHAPA_INLINE_ENABLED!=='true')disabledCreationGates.push('CHAPA_INLINE_ENABLED');
 if(health.mode==='live'&&raw.CHAPA_LIVE_ENABLED!=='true')disabledCreationGates.push('CHAPA_LIVE_ENABLED');
 const configuredMethods=chapaInlineConfiguredMethods(raw),known=['telebirr','cbebirr','mpesa'],supplied=raw.CHAPA_INLINE_METHODS?.split(',').map(value=>value.trim()).filter(Boolean),cbeBankEnabled=false;
 const schema:{status:'not-requested'|'unavailable'|'pending'|'incomplete'|'ok';expectedMigration:string;requiredConfirmationMigrations:readonly string[]}&Partial<ChapaInlineSchemaSnapshot>={status:'not-requested',expectedMigration:CHAPA_INLINE_MIGRATION,requiredConfirmationMigrations:CHAPA_CONFIRMATION_MIGRATIONS};
 if(readSchema){try{const snapshot=await readSchema(),checks=['identityConstraint','guardTrigger','reconcileIndex','signalColumns','webhookFeedbackColumns','signalIndex','eventFeedbackGuard','providerEvidenceGuard','completionStatusConstraint'] as const;Object.assign(schema,snapshot,{status:!snapshot.migrationApplied||!snapshot.signalMigrationApplied||!snapshot.signalGuardsMigrationApplied?'pending':checks.every(field=>snapshot[field]===true)?'ok':'incomplete'})}catch{schema.status='unavailable'}}
 const methods={...common.methods,...(common.methods.items?{items:common.methods.items.filter(method=>configuredMethods.includes(method.slug as 'telebirr'|'cbebirr'|'mpesa'))}:{})};
 const configurationReady=health.enabled&&missing.length===0&&configuredMethods.length>0&&(schema.status==='ok'||schema.status==='not-requested');
 const providerConnectivity=methods.status==='ok'?'reachable' as const:methods.status==='not-requested'?'not-checked' as const:methods.status;
 const ready=configurationReady&&(!options.methods||methods.status==='ok'&&!!methods.items?.length);
 return {apiVersion:'v2' as const,mode:health.mode,configured:health.configured,configurationReady,providerConnectivity,creationEnabled:health.enabled,recoveryEnabled:health.recoveryEnabled,missingPrerequisites:missing,disabledCreationGates,credentials:{privateKeyPresent:!!raw.CHAPA_PRIVATE_KEY,publicKeyPresent:!!raw.CHAPA_PUBLIC_KEY,publicKeyValid:health.publicKeyValid,privateKeyIsPublic:health.privateKeyIsPublic},configuredMethods,unrecognizedMethodsPresent:!!supplied?.some(method=>!known.includes(method)),cbeBankEnabled,methods,schema,ready};
}
