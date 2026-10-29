import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

// Chapa v2 uses one API origin for test and live; the private key selects the
// environment. This is deliberately not a caller-controlled fetch destination.
const API_ORIGIN='https://api.chapa.global';
const CHECKOUT_HOST='checkout.chapa.global';
const MAX_RESPONSE_BYTES=65536;
type Environment=Record<string,string|undefined>;
export type ChapaMode='test'|'live';
export class ChapaError extends Error {
 constructor(public status:number,public code:string,message:string){super(message);this.name='ChapaError'}
}
export class ChapaProviderError extends ChapaError {
 constructor(readonly httpStatus:number,readonly providerCode:string,readonly definiteRejection:boolean){super(502,'PROVIDER_UNAVAILABLE',httpStatus===429?'Chapa is busy. Please try again later.':'Chapa could not complete this request. View the transaction before trying again.')}
}
export const chapaHash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function chapaConfigurationFingerprint(raw:Environment=process.env){return raw.CHAPA_PRIVATE_KEY?chapaHash(raw.CHAPA_PRIVATE_KEY):null}
export function isChapaWebhookSecret(value:unknown):value is string{return typeof value==='string'&&value.length>=32&&value.length<=256&&!/REPLACE|CHANGE_ME/i.test(value)}
export type ChapaWebhookSignatureProfile='raw_body'|'legacy_secret';
/** Legacy delivery compatibility is explicit; it never silently replaces v2. */
export function chapaWebhookSignatureProfile(raw:Environment=process.env):ChapaWebhookSignatureProfile|null{
 const profile=raw.CHAPA_WEBHOOK_SIGNATURE_PROFILE??'raw_body';return profile==='raw_body'||profile==='legacy_secret'?profile:null;
}
// Preserve Signature delivery deduplication across this configuration cleanup.
// Payment credential bindings are separate and never change with this secret.
export function chapaWebhookConfigurationFingerprint(raw:Environment=process.env){return chapaHash(chapaWebhookSignatureProfile(raw)==='legacy_secret'?JSON.stringify(['legacy_secret',raw.CHAPA_WEBHOOK_SECRET]):raw.CHAPA_WEBHOOK_SECRET??'')}
function origins(raw:Environment){try{const app=new URL(raw.MINI_APP_URL??''),auth=new URL(raw.BETTER_AUTH_URL??'');return app.protocol==='https:'&&auth.protocol==='https:'&&app.origin===auth.origin&&!app.username&&!app.password&&!auth.username&&!auth.password}catch{return false}}
function localDatabase(raw:Environment){try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(raw.DATABASE_URL??'').hostname)}catch{return false}}
export function chapaAvailability(raw:Environment=process.env){
 const mode:ChapaMode=raw.CHAPA_MODE==='live'?'live':'test',validMode=!raw.CHAPA_MODE||['test','live'].includes(raw.CHAPA_MODE);
 const key=raw.CHAPA_PRIVATE_KEY??'',secret=raw.CHAPA_WEBHOOK_SECRET??'';
 const privateKey=new RegExp(`^CHAPA_${mode==='live'?'LIVE':'TEST'}_[A-Za-z0-9_-]{16,240}$`).test(key)&&!/REPLACE|CHANGE_ME|example|fixture/i.test(key);
 const testEnvironment=['local','test','staging'].includes(raw.APP_ENV??'')&&raw.VERCEL_ENV!=='production'&&(localDatabase(raw)||raw.APP_ENV==='staging'&&raw.CHAPA_TEST_ENVIRONMENT_REVIEWED==='true');
 const liveEnvironment=raw.APP_ENV==='production'&&raw.NODE_ENV==='production'&&!['preview','development'].includes(raw.VERCEL_ENV??'')&&raw.CHAPA_MERCHANT_REVIEWED==='true'&&raw.DEV_IDENTITY_ENABLED!=='true'&&raw.DEV_POINTS_ENABLED!=='true'&&raw.STAGING_DEMO_ENABLED!=='true';
 const webhookConfigured=isChapaWebhookSecret(secret)&&chapaWebhookSignatureProfile(raw)!==null;
 const configured=validMode&&webhookConfigured&&raw.CHAPA_SCHEMA_READY==='true'&&privateKey&&origins(raw)&&(!raw.CHAPA_BASE_URL||raw.CHAPA_BASE_URL===API_ORIGIN)&&(!raw.CHAPA_CURRENCY||raw.CHAPA_CURRENCY==='ETB')&&(mode==='test'?testEnvironment:liveEnvironment);
 const enabled=configured&&raw.PAYMENT_GATEWAY==='CHAPA'&&raw.CHAPA_ENABLED==='true'&&(mode==='test'||raw.CHAPA_LIVE_ENABLED==='true');
 const recoveryEnabled=configured&&(enabled||raw.CHAPA_RECOVERY_ENABLED==='true');
 return {configured,enabled,recoveryEnabled,mode,currency:'ETB' as const,credentialFingerprint:chapaConfigurationFingerprint(raw),reason:enabled?null:'Chapa payments are not available yet. Keep this payment ID if you have already paid.'};
}
export function requireChapa(operation:'create'|'recover'='create',raw:Environment=process.env){const availability=chapaAvailability(raw);if(!(operation==='create'?availability.enabled:availability.recoveryEnabled))throw new ChapaError(503,'PAYMENT_UNAVAILABLE',availability.reason??'Chapa payment recovery is unavailable. Keep this payment ID and contact support.');return availability}

const reference=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),merchantReference=z.string().regex(/^[A-Za-z0-9_-]{1,20}$/);
const cents=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const centsPattern=/^(0|[1-9]\d{0,15})$/;
const centsString=z.string().regex(centsPattern).refine(value=>centsPattern.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER));
const instant=z.iso.datetime({offset:true});
const customerSchema=z.object({first_name:z.string().max(120).optional(),last_name:z.string().max(120).optional(),email:z.string().max(254).optional(),phone_number:z.string().max(40).optional()});
// Hosted checkout may return uncollected payer details as null. Normalize only
// response fields; initialization still accepts only the original string shape.
const optionalCustomerText=(maximum:number)=>z.string().max(maximum).nullish().transform(value=>value??undefined);
// Chapa deliveries also serialize phone numbers as JSON integers. Payer contact
// is supplementary response data, never evidence of ownership or payment.
const verificationPhone=z.union([z.string().max(40),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String)]).nullish().transform(value=>value??undefined);
const verificationCustomerSchema=z.object({first_name:optionalCustomerText(120),last_name:optionalCustomerText(120),email:optionalCustomerText(254),phone_number:verificationPhone});
const metadata=z.record(z.string().max(80),z.unknown());
const paymentStatus=z.enum(['SUCCESS','PENDING','FAILED','CANCELLED','INCOMPLETE','BLOCKED','AUTH_NEEDED']);
const verification=z.object({status:z.literal('success'),data:z.object({chapa_reference:reference.nullish(),merchant_reference:merchantReference,amount:cents,currency:z.string().regex(/^[A-Z]{3}$/),status:paymentStatus,payment_method:z.string().max(80).optional(),processor_reference:z.string().max(256).nullish(),service_fee:cents.optional(),customer:verificationCustomerSchema.optional(),meta:metadata.nullish(),mode:z.enum(['test','live']).optional(),created_at:instant.optional(),updated_at:instant.optional()})});
export type ChapaEvidence={chapaReference:string|null;merchantReference:string;amountCents:string;currency:string;status:z.infer<typeof paymentStatus>;paymentMethod?:string;processorReference?:string;serviceFeeCents?:string;customer?:z.infer<typeof customerSchema>;meta?:Record<string,unknown>;mode?:ChapaMode;createdAt?:Date;updatedAt?:Date;hash:string};
/** Operation-level success is not payment success. The caller must require
 * status SUCCESS and match its persisted mode/key/reference/amount/currency. */
export function parseChapaEvidence(raw:unknown):ChapaEvidence|null{
 const parsed=verification.safeParse(raw);if(!parsed.success)return null;const d=parsed.data.data;
 // TEST verification can omit a processor reference, and unfinished checkouts
 // have no payment reference yet. SUCCESS always requires the final reference.
 if(d.status==='SUCCESS'&&!d.chapa_reference)return null;
 return {chapaReference:d.chapa_reference??null,merchantReference:d.merchant_reference,amountCents:String(d.amount),currency:d.currency,status:d.status,paymentMethod:d.payment_method,processorReference:d.processor_reference||undefined,serviceFeeCents:d.service_fee===undefined?undefined:String(d.service_fee),customer:d.customer,meta:d.meta??undefined,mode:d.mode,createdAt:d.created_at?new Date(d.created_at):undefined,updatedAt:d.updated_at?new Date(d.updated_at):undefined,hash:chapaHash(JSON.stringify(raw))};
}
export function safeChapaCheckoutUrl(value:string):{checkoutUrl:string;checkoutReference:string;chapaReference:string|null}|null{
 try{
  if(/[\u0000-\u0020\\]/.test(value))return null;
  const url=new URL(value),last=url.pathname.split('/').filter(Boolean).at(-1);
  if(url.protocol!=='https:'||url.hostname!==CHECKOUT_HOST||url.username||url.password||url.port||url.hash||!last||!reference.safeParse(last).success)return null;
  // Preserve Chapa's exact returned path/query. Never synthesize a checkout URL.
  // Hosted session routes end in a session token. Their final payment reference
  // is supplied by merchant verification after payment, not by this URL.
  const hostedSession=/^\/test\/payment\/hosted\/TEST[A-Za-z0-9_-]+\/?$/.test(url.pathname)||/^\/payment\/hosted\/AP[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  return {checkoutUrl:value,checkoutReference:last,chapaReference:hostedSession?null:last};
 }catch{return null}
}
export function isChapaHostedSessionReference(url:string|null,value:string|null,mode:ChapaMode){
 const parsed=url?safeChapaCheckoutUrl(url):null;if(!parsed||parsed.chapaReference!==null||parsed.checkoutReference!==value)return false;
 const path=new URL(parsed.checkoutUrl).pathname;
 return mode==='test'?/^\/test\/payment\/hosted\/TEST[A-Za-z0-9_-]+\/?$/.test(path):/^\/payment\/hosted\/AP[A-Za-z0-9_-]+\/?$/.test(path);
}
export function isChapaTestSessionReference(url:string|null,value:string|null){return isChapaHostedSessionReference(url,value,'test')}
export function createdChapaSession(raw:unknown){
 const parsed=z.object({status:z.literal('success'),data:z.object({checkout_url:z.string().max(2048),created_at:instant.optional(),expires_at:instant.optional()})}).safeParse(raw);if(!parsed.success)return null;
 const session=safeChapaCheckoutUrl(parsed.data.data.checkout_url);if(!session)return null;const createdAt=parsed.data.data.created_at?new Date(parsed.data.data.created_at):undefined,expiresAt=parsed.data.data.expires_at?new Date(parsed.data.data.expires_at):undefined;
 // Chapa documents these timestamps as optional checkout-validity metadata.
 // Missing dates must not discard a valid returned URL or invent an expiry.
 // A URL identifies where to pay, never which completed payment to credit.
 // Bind the final reference only after merchant-authenticated SUCCESS evidence.
 // This applies to every valid URL shape, independent of session token spelling.
 return createdAt&&expiresAt&&expiresAt<=createdAt?null:{...session,chapaReference:null,createdAt,expiresAt};
}

export type ChapaPaymentMethod={slug:string;name:string;minimumCents:string;maximumCents:string;isMobileMoney:boolean};
const limit=z.object({default_min:cents.optional(),default_max:cents.optional(),countries:z.record(z.string(),z.object({is_enabled:z.boolean(),min_amount:cents.optional(),max_amount:cents.optional()}))});
const methodsSchema=z.object({status:z.literal('success'),data:z.array(z.object({name:z.string().min(1).max(120),slug:z.string().regex(/^[a-z0-9_-]{1,80}$/),is_mobile_money:z.boolean().optional(),can_process_payments:z.boolean(),supported_currencies:z.record(z.string(),limit)})).max(100)});
/** Only explicit enabled ETB/ET capabilities reach customer-facing options. */
export function parseChapaPaymentMethods(raw:unknown):ChapaPaymentMethod[]|null{
 const parsed=methodsSchema.safeParse(raw);if(!parsed.success)return null;const found=new Set<string>(),methods:ChapaPaymentMethod[]=[];
 for(const method of parsed.data.data){const etb=method.supported_currencies.ETB,ethiopia=etb?.countries.ET,min=ethiopia?.min_amount??etb?.default_min,max=ethiopia?.max_amount??etb?.default_max;if(!method.can_process_payments||!ethiopia?.is_enabled||min===undefined||max===undefined||max<Math.max(100,min)||found.has(method.slug))continue;found.add(method.slug);methods.push({name:method.name,slug:method.slug,minimumCents:String(Math.max(100,min)),maximumCents:String(max),isMobileMoney:method.is_mobile_money??false})}
 return methods;
}

export function verifyChapaWebhook(rawBody:Uint8Array|string,receivedSignature:string|null|undefined,secret:string|undefined=process.env.CHAPA_WEBHOOK_SECRET){
 if(!isChapaWebhookSecret(secret)||typeof receivedSignature!=='string'||!/^([a-f0-9]{64})$/i.test(receivedSignature))return false;
 // Chapa v2 signs the exact received bytes. Do not parse/serialize first or
 // accept legacy signatures calculated over the secret instead of the body.
 const expected=createHmac('sha256',secret).update(rawBody).digest();return timingSafeEqual(expected,Buffer.from(receivedSignature,'hex'));
}
/** Documented legacy shared-secret proof. It authenticates possession of a
 * reusable credential, not the body; callers may use it only as a lookup hint. */
export function verifyLegacyChapaWebhook(receivedSignature:string|null|undefined,secret:string|undefined=process.env.CHAPA_WEBHOOK_SECRET){
 if(!isChapaWebhookSecret(secret)||typeof receivedSignature!=='string'||!/^[a-f0-9]{64}$/i.test(receivedSignature))return false;
 return timingSafeEqual(createHmac('sha256',secret).update(secret).digest(),Buffer.from(receivedSignature,'hex'));
}
export function authenticateChapaWebhook(rawBody:Uint8Array,headers:Headers,raw:Environment=process.env):ChapaWebhookSignatureProfile|null{
 const profile=chapaWebhookSignatureProfile(raw);if(!profile)return null;
 const signature=headers.get('x-chapa-signature');
 if(profile==='raw_body')return verifyChapaWebhook(rawBody,signature,raw.CHAPA_WEBHOOK_SECRET)?profile:null;
 // v1 documents chapa-signature. The observed v2-shaped delivery uses the same
 // legacy formula under x-chapa-signature; accept either only in this profile.
 // A documented v1 delivery may include a different body HMAC in x alongside
 // the constant proof in chapa-signature. The documented header takes priority;
 // an invalid primary header must not be bypassed by the observed x variant.
 const legacy=headers.get('chapa-signature');
 return verifyLegacyChapaWebhook(legacy??signature,raw.CHAPA_WEBHOOK_SECRET)?profile:null;
}
const webhookSchema=z.object({webhook_type:z.enum(['payment','refund','payout']),event:z.string().regex(/^[a-z][a-z._]{0,80}$/),status:z.string().regex(/^[a-z][a-z_]{0,40}$/),mode:z.enum(['test','live']).optional(),merchant_reference:merchantReference.nullish(),chapa_reference:reference.optional(),amount:z.union([centsString,cents.transform(String)]).optional(),service_fee:z.union([centsString,cents.transform(String)]).optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),meta:metadata.nullish(),updated_at:instant.optional()});
/** An authenticated webhook is a durable recovery hint, never credit evidence. */
export function parseChapaWebhook(raw:unknown){const p=webhookSchema.safeParse(raw);if(!p.success)return null;const d=p.data;const events:Record<string,string>={'payment.success':'success','payment.failed':'failed','payment.cancelled':'cancelled','payment.incomplete':'incomplete','payment.auth_needed':'auth_needed','payment.blocked':'blocked','payment.pending':'pending'};if(d.webhook_type==='payment'&&events[d.event]!==d.status)return null;return {type:d.webhook_type,event:d.event,status:d.status,mode:d.mode,merchantReference:d.merchant_reference??undefined,chapaReference:d.chapa_reference,amountCents:d.amount,serviceFeeCents:d.service_fee,currency:d.currency,meta:d.meta??undefined,updatedAt:d.updated_at?new Date(d.updated_at):undefined}}
/** Delivery amount is a routing hint only. Some hosted deliveries include the
 * payer fee; verification must still match the exact persisted principal. */
export function chapaWebhookAmountMatches(hint:{amountCents?:string;serviceFeeCents?:string},expected:bigint){
 if(hint.amountCents===undefined)return true;
 const amount=BigInt(hint.amountCents);return amount===expected||hint.serviceFeeCents!==undefined&&amount===expected+BigInt(hint.serviceFeeCents);
}

export type ChapaCreate={amountCents:string;merchantReference:string;idempotencyKey:string;returnUrl?:string;returnUrlVersion?:1;callbackUrl?:string;customer?:z.infer<typeof customerSchema>;meta?:Record<string,string>;preferredPaymentMethods?:string[];description?:string};
export type ChapaTransport={create:(input:ChapaCreate)=>Promise<unknown>;lookup:(paymentReference:string)=>Promise<unknown>;methods:()=>Promise<unknown>};
const createSchema=z.object({amountCents:centsString.refine(v=>centsPattern.test(v)&&BigInt(v)>=100n),merchantReference,idempotencyKey:z.string().regex(/^[A-Za-z0-9:._-]{16,128}$/),returnUrl:z.url().max(2048).optional(),returnUrlVersion:z.literal(1).optional(),callbackUrl:z.url().max(2048).optional(),customer:customerSchema.strict().optional(),meta:z.record(z.string().max(80),z.string().max(256)).optional(),preferredPaymentMethods:z.array(z.string().regex(/^[a-z0-9_-]{1,80}$/)).min(1).max(10).optional(),description:z.string().trim().min(1).max(200).optional()}).strict();
async function boundedJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this same payment again.');
 let length=0;const chunks:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_RESPONSE_BYTES){await reader.cancel();throw new Error('Response bound')}chunks.push(part.value)}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{body=null}
  if(!response.ok){const error=z.object({error:z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)}).optional()}).safeParse(body);const code=error.success?error.data.error?.code??'HTTP_ERROR':'HTTP_ERROR';throw new ChapaProviderError(response.status,code,[400,401,403,404,422].includes(response.status))}
  if(body===null)throw Error('Invalid JSON');return body;
 }
 catch(error){if(error instanceof ChapaProviderError)throw error;throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this same payment again.')}
 finally{reader.releaseLock()}
}
export function createChapaTransport(options:{env?:Environment;fetcher?:typeof fetch}={}):ChapaTransport{
 const raw=options.env??process.env;
 const request=async(path:string,operation:'create'|'recover',body?:unknown,key?:string)=>{
  requireChapa(operation,raw);
  try{const response=await (options.fetcher??fetch)(API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${raw.CHAPA_PRIVATE_KEY!}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),...(body===undefined?{}:{body:JSON.stringify(body)})});return await boundedJson(response)}
  catch(error){if(error instanceof ChapaProviderError)throw error;throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this same payment again.')}
 };
 return {
  create:async input=>{const parsed=createSchema.safeParse(input);if(!parsed.success)throw new ChapaError(422,'INVALID_PAYMENT','Check the payment details.');const p=parsed.data;for(const value of [p.returnUrl,p.callbackUrl]){if(!value)continue;const u=new URL(value);let origin:string;try{origin=new URL(raw.MINI_APP_URL??'').origin}catch{throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Chapa payments are not configured.')}if(u.protocol!=='https:'||u.username||u.password||u.origin!==origin)throw new ChapaError(422,'INVALID_PAYMENT','Use the configured secure payment return URL.')}
   // Keep the hosted request minimal. The dashboard PAYMENT webhook and our
   // merchant-authenticated lookup handle crediting; Chapa collects payer data.
   // Only new snapshots explicitly opt into the documented navigation return.
   // Historical retries retain the minimal wire body, even with old URL fields.
   return request('/v2/payments/hosted','create',{amount:Number(p.amountCents),currency:'ETB',merchant_reference:p.merchantReference,...(p.returnUrlVersion===1&&p.returnUrl?{return_url:p.returnUrl}:{})},p.idempotencyKey)},
  lookup:async value=>{if(!reference.safeParse(value).success)throw new ChapaError(422,'INVALID_PAYMENT','Invalid payment reference.');return request(`/v2/payments/${encodeURIComponent(value)}/verify`,'recover')},
  methods:()=>request('/v2/payments/methods','create'),
 };
}
export const chapaTransport:ChapaTransport=createChapaTransport();
