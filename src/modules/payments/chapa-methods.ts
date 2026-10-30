import {chapaAvailability,chapaTransport,parseChapaPaymentMethods,type ChapaPaymentMethod,type ChapaTransport} from './chapa-provider';

type Environment=Record<string,string|undefined>;
type Entry={methods:ChapaPaymentMethod[];expiresAt:number;retryAt:number;pending?:Promise<void>};
const TTL=5*60000,RETRY=30000;
function priority(raw:Environment){
 if(!raw.CHAPA_PREFERRED_PAYMENT_METHODS?.trim())return null;
 const slugs=raw.CHAPA_PREFERRED_PAYMENT_METHODS.split(',').map(value=>value.trim());
 return slugs.length<=10&&slugs.every(value=>/^[a-z0-9_-]{1,80}$/.test(value))?[...new Set(slugs)]:null;
}

/** Merchant capabilities are private process-local data, isolated by key/mode.
 * Availability reads warm the catalog; financial intent creation never awaits
 * provider HTTP. A cold, failed or expired catalog keeps the minimal request. */
export function createChapaMethodCatalog(clock:()=>number=Date.now){
 const entries=new Map<string,Entry>();
 const identity=(raw:Environment)=>{const health=chapaAvailability(raw);return priority(raw)&&health.enabled&&health.credentialFingerprint?`${health.mode}:ETB:ET:${health.credentialFingerprint}`:null};
 return {
  refresh(raw:Environment=process.env,transport:ChapaTransport=chapaTransport):Promise<void>{
   const key=identity(raw);if(!key)return Promise.resolve();
   let entry=entries.get(key);
   if(entry?.pending)return entry.pending;
   if(entry&&(entry.expiresAt>clock()||entry.retryAt>clock()))return Promise.resolve();
   if(!entry){if(entries.size>=2)entries.delete(entries.keys().next().value!);entry={methods:[],expiresAt:0,retryAt:0};entries.set(key,entry)}
   const current=entry;
   current.pending=Promise.resolve().then(async()=>{
    try{const methods=parseChapaPaymentMethods(await transport.methods());if(!methods)throw Error('Invalid catalog');current.methods=methods;current.expiresAt=clock()+TTL}
    catch{current.methods=[];current.expiresAt=0;current.retryAt=clock()+RETRY}
    finally{current.pending=undefined}
   });
   return current.pending;
  },
  preferences(amountCents:bigint,raw:Environment=process.env){
   const ordered=priority(raw),key=identity(raw),entry=key?entries.get(key):undefined;
   if(!ordered||!entry||entry.expiresAt<=clock())return undefined;
   const allowed=entry.methods.filter(method=>amountCents>=BigInt(method.minimumCents)&&amountCents<=BigInt(method.maximumCents));
   // Keep every enabled method for this amount; a preference must not silently
   // hide alternative rails. Unknown merchant slugs are never fabricated.
   if(!ordered.some(slug=>allowed.some(method=>method.slug===slug))||allowed.length>10)return undefined;
   const rank=(slug:string)=>{const index=ordered.indexOf(slug);return index<0?ordered.length:index};
   const preferredPaymentMethods=allowed.toSorted((a,b)=>rank(a.slug)-rank(b.slug)).map(method=>method.slug);
   return {preferredPaymentMethods,preferredPaymentMethodsVersion:1 as const};
  },
 };
}

export const chapaMethodCatalog=createChapaMethodCatalog();
