import {z} from 'zod';
import {safeChapaPaymentReason} from '@/lib/chapa-payment-reason';
import {chapaAvailability,chapaHash,ChapaError,ChapaProviderError,createChapaTransport,parseChapaPaymentMethods,type ChapaDirectCreate,type ChapaTransport} from './chapa-provider';

type Environment=Record<string,string|undefined>;
const API='https://api.chapa.global';
const supported=['telebirr','cbebirr','mpesa','ebirr'] as const;
export function chapaInlinePublicKeyValid(value:string|undefined,mode:'test'|'live'){
 return new RegExp(`^CHAPA_${mode==='live'?'LIVE':'TEST'}_PUB_[A-Za-z0-9_-]{16,240}$`).test(value??'')&&!/REPLACE|CHANGE_ME|example|fixture/i.test(value??'');
}
export function chapaInlineConfiguredMethods(raw:Environment=process.env){
 const supplied=raw.CHAPA_INLINE_METHODS===undefined?['telebirr','cbebirr','mpesa']:raw.CHAPA_INLINE_METHODS.split(',').map(v=>v.trim());
 return supported.filter(method=>supplied.includes(method));
}
export function chapaInlineAvailability(raw:Environment=process.env){
 const base=chapaAvailability(raw),publicKeyValid=chapaInlinePublicKeyValid(raw.CHAPA_PUBLIC_KEY,base.mode),privateKeyIsPublic=/^CHAPA_(?:LIVE|TEST)_PUB_/.test(raw.CHAPA_PRIVATE_KEY??'');
 const configured=base.configured&&publicKeyValid&&!privateKeyIsPublic,enabled=configured&&base.enabled&&raw.CHAPA_INLINE_ENABLED==='true';
 return {...base,configured,enabled,recoveryEnabled:configured&&base.recoveryEnabled,publicKeyValid,privateKeyIsPublic,publicKeyFingerprint:publicKeyValid?chapaHash(raw.CHAPA_PUBLIC_KEY!):null,reason:enabled?null:'Secure payments are not configured.'};
}
export function requireChapaInline(operation:'create'|'recover'='create',raw:Environment=process.env){
 const health=chapaInlineAvailability(raw);
 if(!(operation==='create'?health.enabled:health.recoveryEnabled))throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Secure payment is not configured. Existing payments remain recorded.');
 return health;
}
export function isV2InlineCheckout(order:{flowVersion?:number;initialization:unknown}){
 if(order.flowVersion!==4||!order.initialization||typeof order.initialization!=='object'||Array.isArray(order.initialization))return false;
 const initialization=order.initialization as Record<string,unknown>;
 return initialization.apiVersion==='v2'&&initialization.flowVersion===4&&['INLINE','HOSTED'].includes(String(initialization.flow));
}
/** The public key may rotate independently of private verification credentials.
 * It must never silently authorize an old attempt under a different account. */
export function inlineTransportBinding(order:{flowVersion?:number;initialization:unknown;mode:string;credentialFingerprint:string},raw:Environment=process.env){
 const health=chapaInlineAvailability(raw),initialization=order.initialization as Record<string,unknown>|null;
 return isV2InlineCheckout(order)&&health.configured&&order.mode===health.mode&&order.credentialFingerprint===health.credentialFingerprint&&initialization?.publicKeyFingerprint===health.publicKeyFingerprint;
}
export type ChapaInlineTransport=ChapaTransport&{inline:(input:ChapaDirectCreate,operation?:'create'|'recover')=>Promise<unknown>};
const reference=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const inlineInput=z.object({amountCents:z.string().regex(/^[1-9]\d{0,15}$/).refine(v=>BigInt(v)>=100n&&BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER)),merchantReference:z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),idempotencyKey:z.string().regex(/^[A-Za-z0-9:._-]{16,128}$/),paymentMethod:z.enum(supported),phone:z.string().regex(/^251[79]\d{8}$/)}).strict();
async function inlineJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this same payment again.');
 let length=0;const chunks:Uint8Array[]=[];
 try{
  for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>65536){await reader.cancel();throw Error('Response bound')}chunks.push(part.value)}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Invalid JSON')}
  if(!response.ok){
   const parsed=z.object({reason:z.unknown().optional(),error:z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),details:z.unknown().optional()}).optional()}).safeParse(body);
   const code=parsed.success?parsed.data.error?.code??'HTTP_ERROR':'HTTP_ERROR',details=parsed.success?parsed.data.error?.details:null;
   const reason=safeChapaPaymentReason(code)??(parsed.success?safeChapaPaymentReason(parsed.data.reason):null)??(details&&typeof details==='object'&&!Array.isArray(details)?safeChapaPaymentReason((details as Record<string,unknown>).reason):null);
   throw new ChapaProviderError(response.status,code,undefined,reason??undefined);
  }
  return body;
 }catch(error){if(error instanceof ChapaProviderError)throw error;throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this same payment again.')}
 finally{reader.releaseLock()}
}
/** New Inline requests use the documented v2 API, never the legacy SDK host.
 * Private hosted initialization, capabilities and verification stay server-side. */
export function createChapaInlineTransport(options:{env?:Environment;fetcher?:typeof fetch}={}):ChapaInlineTransport{
 const raw=options.env??process.env,base=createChapaTransport(options);
 const request=async(path:string,operation:'create'|'recover',body:unknown,key?:string)=>{
  requireChapaInline(operation,raw);
  try{
   const response=await (options.fetcher??fetch)(API+path,{method:'POST',headers:{Authorization:`Bearer ${raw.CHAPA_PUBLIC_KEY!}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
   return await inlineJson(response);
  }catch(error){if(error instanceof ChapaProviderError)throw error;throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this same payment again.')}
 };
 return {...base,
  inline:(input,operation='create')=>{const p=inlineInput.parse(input);return request('/v2/payments/inline',operation,{amount:Number(p.amountCents),currency:'ETB',merchant_reference:p.merchantReference,payment_method:p.paymentMethod,mobile:p.phone},p.idempotencyKey)},
  validate:input=>{const p=z.object({reference,paymentMethod:z.enum(supported),otp:z.string().regex(/^\d{4,10}$/).optional()}).strict().parse(input);return request('/v2/payments/inline/validate','recover',{reference:p.reference,payment_method:p.paymentMethod,...(p.otp?{otp:p.otp}:{})})},
 };
}
export const chapaInlineTransport=createChapaInlineTransport();

export type InlineMethod={slug:string;name:string;minimumCents:string;maximumCents:string;minAmountCents:string;maxAmountCents:string};
/** General enabled wallet capabilities apply to Inline; Direct's additional
 * can_process_direct_charge gate is not documented for this API. */
export function createInlineMethodCatalog(transport:ChapaTransport=chapaInlineTransport,raw:Environment=process.env){
 type Flight={key:string;promise:Promise<InlineMethod[]>};
 let cached:{key:string;until:number;methods:InlineMethod[]}|null=null,pending:Flight|null=null;
 const configuration=()=>{const health=chapaInlineAvailability(raw),methods=chapaInlineConfiguredMethods(raw);return {enabled:health.enabled,methods,key:`${health.mode}:${health.credentialFingerprint}:${health.publicKeyFingerprint}:${methods.join(',')}`}};
 const current=(key:string)=>{const next=configuration();if(!next.enabled||next.key!==key)throw new ChapaError(503,'CONFIGURATION_CHANGED','Reload payment options before paying.')};
 return {async get(amountCents?:bigint){
  const config=configuration();if(!config.enabled)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','External payments are unavailable.');
  let methods:InlineMethod[];
  if(cached?.key===config.key&&cached.until>Date.now())methods=cached.methods;
  else{
   if(!pending||pending.key!==config.key){
    let flight:Flight;
    const promise=transport.methods().then(rawMethods=>{
     const found=parseChapaPaymentMethods(rawMethods);if(!found)throw new ChapaError(503,'METHODS_UNAVAILABLE','Payment methods could not be confirmed. Try again.');current(config.key);
     const available=config.methods.flatMap(slug=>{const method=found.find(m=>m.slug===slug);return method?[{slug:method.slug,name:method.name,minimumCents:method.minimumCents,maximumCents:method.maximumCents,minAmountCents:method.minimumCents,maxAmountCents:method.maximumCents}]:[]});
     // An empty successful response remains fail-closed, but must not pin a
     // recovered merchant capability state behind the healthy five-minute TTL.
     if(pending===flight)cached={key:config.key,until:Date.now()+(available.length?300000:5000),methods:available};return available;
    }).finally(()=>{if(pending===flight)pending=null});
    flight={key:config.key,promise};pending=flight;
   }
   methods=await pending.promise;current(config.key);
  }
  return methods.filter(m=>amountCents===undefined||amountCents>=BigInt(m.minimumCents)&&amountCents<=BigInt(m.maximumCents));
 }};
}
export const inlineMethodCatalog=createInlineMethodCatalog();
