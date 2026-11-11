import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {safeChapaPaymentReason} from '@/lib/chapa-payment-reason';
import {ChapaError,chapaHash,isChapaWebhookSecret,type ChapaEvidence} from './chapa-provider';

type Environment=Record<string,string|undefined>;
const API='https://api.chapa.co';
const methods=['telebirr','cbebirr','mpesa','ebirr'] as const;
export type ChapaV1Method=typeof methods[number];
export function isV1Checkout(order:{initialization:unknown}){return !!order.initialization&&typeof order.initialization==='object'&&!Array.isArray(order.initialization)&&(order.initialization as Record<string,unknown>).apiVersion==='v1'}
export function chapaV1Availability(raw:Environment=process.env){
 const mode=raw.CHAPA_MODE==='live'?'live':'test',secret=raw.CHAPA_V1_SECRET_KEY??'',publicKey=raw.CHAPA_V1_PUBLIC_KEY??'';
 const keyPattern=mode==='test'?/^CHASECK_TEST-[A-Za-z0-9_-]{16,240}$/:/^CHASECK(?:_LIVE)?-[A-Za-z0-9_-]{16,240}$/;
 const publicPattern=mode==='test'?/^CHAPUBK_TEST-[A-Za-z0-9_-]{16,240}$/:/^CHAPUBK(?:_LIVE)?-[A-Za-z0-9_-]{16,240}$/;
 let origins=false,local=false;try{const app=new URL(raw.MINI_APP_URL??''),auth=new URL(raw.BETTER_AUTH_URL??'');origins=app.protocol==='https:'&&app.origin===auth.origin&&!app.username&&!app.password;local=['localhost','127.0.0.1','[::1]'].includes(new URL(raw.DATABASE_URL??'').hostname)}catch{}
 const environment=mode==='test'?['local','test','staging'].includes(raw.APP_ENV??'')&&raw.VERCEL_ENV!=='production'&&(local||raw.APP_ENV==='staging'&&raw.CHAPA_TEST_ENVIRONMENT_REVIEWED==='true'):raw.APP_ENV==='production'&&raw.NODE_ENV==='production'&&raw.CHAPA_MERCHANT_REVIEWED==='true'&&!['preview','development'].includes(raw.VERCEL_ENV??'')&&raw.DEV_IDENTITY_ENABLED!=='true'&&raw.DEV_POINTS_ENABLED!=='true'&&raw.STAGING_DEMO_ENABLED!=='true';
 const configured=['test','live'].includes(raw.CHAPA_MODE??'test')&&origins&&environment&&raw.CHAPA_SCHEMA_READY==='true'&&keyPattern.test(secret)&&publicPattern.test(publicKey)&&isChapaWebhookSecret(raw.CHAPA_V1_WEBHOOK_SECRET);
 const enabled=configured&&raw.PAYMENT_GATEWAY==='CHAPA'&&raw.CHAPA_V1_ENABLED==='true'&&(mode==='test'||raw.CHAPA_LIVE_ENABLED==='true');
 return {configured,enabled,recoveryEnabled:configured&&(enabled||raw.CHAPA_V1_RECOVERY_ENABLED==='true'),mode:mode as 'test'|'live',currency:'ETB' as const,credentialFingerprint:secret?chapaHash(secret):null};
}
export function requireChapaV1(operation:'create'|'recover'='create',raw:Environment=process.env){const health=chapaV1Availability(raw);if(!(operation==='create'?health.enabled:health.recoveryEnabled))throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Secure payment is not configured. Existing payments remain recorded.');return health}
export function chapaV1Methods(raw:Environment=process.env){
 if(!chapaV1Availability(raw).enabled)return [];
 const enabled=new Set((raw.CHAPA_V1_METHODS??'').split(',').map(v=>v.trim()));
 return methods.filter(slug=>enabled.has(slug)).map(slug=>({slug,name:{telebirr:'telebirr',cbebirr:'CBE Birr',mpesa:'M-PESA',ebirr:'eBirr'}[slug],minimumCents:'100',maximumCents:'4320000',minAmountCents:'100',maxAmountCents:'4320000'}));
}
export function safeV1CheckoutUrl(value:unknown){try{if(typeof value!=='string'||/[\u0000-\u0020\\]/.test(value))return null;const u=new URL(value);return u.protocol==='https:'&&['checkout.chapa.co','checkout.chapa.global'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.hash?value:null}catch{return null}}
const reference=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const major=z.union([z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2}0{0,6})?$/),z.number().finite().nonnegative().max(99999999.99)]);
function minor(value:unknown){const parsed=major.safeParse(value);if(!parsed.success)return null;try{let text=typeof parsed.data==='number'?String(parsed.data):parsed.data;if(text.includes('.'))text=text.replace(/0+$/,'').replace(/\.$/,'');return etbToCents(text).toString()}catch{return null}}
/** v1 amounts are major currency units. Do not feed them to the v2 parser. */
export function parseChapaV1Evidence(raw:unknown):ChapaEvidence|null{
 const parsed=z.object({status:z.literal('success'),data:z.object({tx_ref:reference,reference:reference.nullish(),amount:major,currency:z.string().regex(/^[A-Z]{3}$/),status:z.string(),mode:z.enum(['test','live']),payment_method:z.string().max(80).optional(),method:z.string().max(80).optional(),charge:major.optional(),reason:z.unknown().optional(),meta:z.record(z.string(),z.unknown()).nullish()})}).safeParse(raw);if(!parsed.success)return null;
 const d=parsed.data.data,statuses:Record<string,ChapaEvidence['status']>={success:'SUCCESS',pending:'PENDING',failed:'FAILED',cancelled:'CANCELLED',canceled:'CANCELLED',incomplete:'INCOMPLETE',blocked:'BLOCKED',auth_needed:'AUTH_NEEDED',failed_or_cancelled:'FAILED'},status=statuses[d.status.toLowerCase()],amountCents=minor(d.amount);if(!status||amountCents===null||status==='SUCCESS'&&!d.reference)return null;
 const fee=d.charge===undefined?null:minor(d.charge);if(d.charge!==undefined&&fee===null)return null;
 return {merchantReference:d.tx_ref,chapaReference:d.reference??null,amountCents,currency:d.currency,status,mode:d.mode,paymentMethod:d.payment_method??d.method,serviceFeeCents:fee??undefined,reasonCode:safeChapaPaymentReason(d.reason)??(d.status==='failed_or_cancelled'?'PAYMENT_FAILED_OR_CANCELLED':undefined),meta:d.meta??undefined,hash:chapaHash(JSON.stringify(raw))};
}
export type ChapaV1HostedInput={txRef:string;amountCents:string;phone:string;returnUrl:string;callbackUrl:string};
export type ChapaV1Transport={lookup:(txRef:string)=>Promise<unknown>;initialize:(input:ChapaV1HostedInput)=>Promise<unknown>};
export function createChapaV1Transport(options:{env?:Environment;fetcher?:typeof fetch}={}):ChapaV1Transport{
 const raw=options.env??process.env;
 const request=async(path:string,operation:'create'|'recover',body?:unknown)=>{requireChapaV1(operation,raw);const response=await (options.fetcher??fetch)(API+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${raw.CHAPA_V1_SECRET_KEY}`,...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});const reader=response.body?.getReader();if(!reader)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Confirmation is pending. Check this payment again.');const chunks:Uint8Array[]=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Confirmation is pending. Check this payment again.')}chunks.push(part.value)}}finally{reader.releaseLock()}let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Confirmation is pending. Check this payment again.')}if(!response.ok)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','The provider has not confirmed this payment. Check the original payment.');return value};
 return {lookup:txRef=>{reference.parse(txRef);return request(`/v1/transaction/verify/${encodeURIComponent(txRef)}`,'recover')},initialize:input=>{reference.parse(input.txRef);for(const url of [input.returnUrl,input.callbackUrl]){const u=new URL(url);if(u.protocol!=='https:'||u.origin!==new URL(raw.MINI_APP_URL??'').origin||u.username||u.password)throw new ChapaError(422,'INVALID_PAYMENT','Invalid payment return URL.')}return request('/v1/transaction/initialize','create',{tx_ref:input.txRef,amount:centsToEtb(BigInt(input.amountCents)),currency:'ETB',phone_number:input.phone,return_url:input.returnUrl,callback_url:input.callbackUrl,customization:{title:'Lowwin payment'}})}};
}
export const chapaV1Transport=createChapaV1Transport();
/** v1 documents either the raw payload HMAC or HMAC(secret,secret). Both are
 * recovery hints only; credit always comes from authenticated verification. */
export function authenticateChapaV1Webhook(bytes:Uint8Array,headers:Headers,secret=process.env.CHAPA_V1_WEBHOOK_SECRET){if(!isChapaWebhookSecret(secret))return false;const matches=(value:string|null,message:Uint8Array|string)=>!!value&&/^[a-f0-9]{64}$/i.test(value)&&timingSafeEqual(createHmac('sha256',secret).update(message).digest(),Buffer.from(value,'hex'));return matches(headers.get('x-chapa-signature'),bytes)||matches(headers.get('chapa-signature'),secret)}
export function parseChapaV1Webhook(raw:unknown){const p=z.object({event:z.string().regex(/^charge\.[a-z_]{1,40}$/),tx_ref:reference,mode:z.enum(['test','live']),currency:z.string().regex(/^[A-Z]{3}$/),status:z.string().max(40)}).safeParse(raw);return p.success?{merchantReference:p.data.tx_ref,mode:p.data.mode,currency:p.data.currency,event:p.data.event}:null}
