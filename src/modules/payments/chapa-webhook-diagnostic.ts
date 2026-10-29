import {chapaWebhookSignatureProfile,isChapaWebhookSecret,verifyChapaWebhook,verifyLegacyChapaWebhook} from './chapa-provider';

type Environment=Record<string,string|undefined>;
export const CHAPA_WEBHOOK_MAX_BYTES=65536;

/** Runtime configuration only: never load environment files or reveal values. */
export function chapaWebhookSignatureConfiguration(environment:Environment=process.env){
 const secret=environment.CHAPA_WEBHOOK_SECRET,secretPresent=typeof secret==='string'&&secret.length>0;
 const signatureProfile=chapaWebhookSignatureProfile(environment),configurationValid=signatureProfile!==null&&isChapaWebhookSecret(secret);
 return {configuredAuth:'signature' as const,signatureProfile,secretPresent,configurationValid,diagnosis:configurationValid?'SIGNATURE_CONFIGURATION_VALID':signatureProfile===null?'INVALID_SIGNATURE_PROFILE':secretPresent?'INVALID_WEBHOOK_SECRET':'MISSING_WEBHOOK_SECRET'};
}

/** Offline comparison against the production raw-body authenticator. It returns
 * no body, secret, signature, hash, reference, or decoded customer information. */
export function diagnoseChapaWebhookSignature(rawBody:Uint8Array,signature:string|undefined,environment:Environment=process.env){
 const configuration=chapaWebhookSignatureConfiguration(environment);
 const bodyWithinLimit=rawBody.byteLength<=CHAPA_WEBHOOK_MAX_BYTES;
 const signaturePresent=typeof signature==='string'&&signature.length>0;
 const signatureFormatValid=typeof signature==='string'&&/^[a-f0-9]{64}$/i.test(signature);
 const authenticationAccepted=configuration.configurationValid&&bodyWithinLimit&&(configuration.signatureProfile==='legacy_secret'?verifyLegacyChapaWebhook(signature,environment.CHAPA_WEBHOOK_SECRET):verifyChapaWebhook(rawBody,signature,environment.CHAPA_WEBHOOK_SECRET));
 const bodyIntegrityVerified=authenticationAccepted&&configuration.signatureProfile==='raw_body';
 // A legacy match is only usable in its explicitly selected profile. It never
 // establishes body integrity or successful payment, even when accepted.
 const legacyConstantSignatureRejected=!authenticationAccepted&&configuration.configurationValid&&bodyWithinLimit&&signatureFormatValid&&verifyLegacyChapaWebhook(signature,environment.CHAPA_WEBHOOK_SECRET);
 const diagnosis=!configuration.configurationValid?configuration.diagnosis:!bodyWithinLimit?'RAW_BODY_TOO_LARGE':!signaturePresent?'MISSING_SIGNATURE':!signatureFormatValid?'INVALID_SIGNATURE_FORMAT':authenticationAccepted?configuration.signatureProfile==='legacy_secret'?'MATCHES_LEGACY_SECRET_PROOF':'MATCHES_RAW_BODY_SIGNATURE':legacyConstantSignatureRejected?'LEGACY_CONSTANT_SIGNATURE_REJECTED':'SIGNATURE_MISMATCH';
 return {...configuration,bodyWithinLimit,signaturePresent,signatureFormatValid,authenticationAccepted,bodyIntegrityVerified,legacyConstantSignatureRejected,diagnosis};
}
