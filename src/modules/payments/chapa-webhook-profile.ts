import {authenticateChapaWebhook,chapaWebhookSignatureProfile,verifyChapaWebhook,type ChapaWebhookSignatureProfile} from './chapa-provider';

type Environment=Record<string,string|undefined>;
/** Exact-body HMAC is stronger than the explicit legacy hint profile. Accept
 * that upgrade without accepting a reusable proof for a body-pinned intent. */
export function authenticateChapaDelivery(bytes:Uint8Array,headers:Headers,raw:Environment=process.env):ChapaWebhookSignatureProfile|null{
 if(!chapaWebhookSignatureProfile(raw))return null;
 if(verifyChapaWebhook(bytes,headers.get('x-chapa-signature'),raw.CHAPA_WEBHOOK_SECRET))return 'raw_body';
 return authenticateChapaWebhook(bytes,headers,raw);
}

/** Unpinned historical attempts retain their configured hint-only recovery.
 * An unknown explicit marker fails closed instead of downgrading to history. */
export function chapaDeliveryProfileMatches(initialization:unknown,authenticated:ChapaWebhookSignatureProfile){
 if(!initialization||typeof initialization!=='object'||Array.isArray(initialization))return true;
 const profile=(initialization as Record<string,unknown>).webhookSignatureProfile;
 if(profile===undefined)return true;
 if(profile==='raw_body')return authenticated==='raw_body';
 return profile==='legacy_secret';
}
