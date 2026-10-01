import {createHash} from 'node:crypto';
import {z} from 'zod';
import {demoBidAllowed} from '../auctions/bids';
import {PROVIDER_TIMEOUT_MS} from './timing';
import {canonical,PaymentError} from './reference';
export {canonical,candidate,PaymentError} from './reference';

export const bankSchema=z.enum(['telebirr','cbe']);
export type Bank=z.infer<typeof bankSchema>;
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function cents(value:string|number):bigint{
 const text=String(value);if(!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(text))throw new PaymentError(422,'Use an exact ETB amount with at most two decimal places.');
 const [whole,fraction='']=text.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export type VerificationInput={bank:Bank;reference:string;account:string;expectedCents:bigint|null;minCents?:bigint;maxCents?:bigint;createdAt:Date;expiresAt:Date;attemptKey:string};
export type ImageVerificationInput=Omit<VerificationInput,'reference'>&{image:Buffer;mime:'image/png'|'image/jpeg'|'image/webp'};
const imageProcessingSchema=z.object({method:z.enum(['qr','ocr']),chargedCredits:z.number().int().nonnegative()});
export type ImageVerification={verification:Verification;reference?:string;imageProcessing?:z.infer<typeof imageProcessingSchema>};
type SafeValueType='missing'|'null'|'string'|'number'|'boolean'|'array'|'object';
type EvidenceFieldIssue={field:string;issue:string;received:SafeValueType};
export type Verification={code:string;matched:boolean;requestId?:string;processing?:boolean;retrySeconds?:number;evidence:{currency?:'ETB';currencySource?:'channel_policy';confirmedBefore?:boolean;amountCents?:string;receiverSuffix?:string;date?:string;hash?:string;aliases?:string[];invalidFields?:EvidenceFieldIssue[]}};
export type VerifyTransport=(input:VerificationInput)=>Promise<Verification>;
const requestIdSchema=z.string().uuid();
const providerErrorSchema=z.object({code:z.string(),retryable:z.boolean().optional()});
const itemSchema=z.object({bank:bankSchema,status:z.string(),verified:z.boolean(),amount:z.union([z.string(),z.number()]),receiverAccount:z.string().optional(),referenceNumber:z.string().optional(),receiptNumber:z.string().optional(),transactionNumber:z.string().optional(),timestamp:z.string().optional(),confirmationHistory:z.object({confirmedBefore:z.boolean().optional()}).optional(),settlementAccountMatch:z.object({matched:z.boolean(),matchType:z.string().optional(),matchConfidence:z.string().optional(),candidateCount:z.number().int().nonnegative().optional(),matchedSettlementAccount:z.string().optional(),bank:bankSchema.optional(),ambiguous:z.boolean().optional()}).optional()}).passthrough();
export function providerReference(raw:unknown,bank:Bank){
 const parsed=z.object({referenceNumber:z.string().optional(),receiptNumber:z.string().optional(),transactionNumber:z.string().optional()}).passthrough().safeParse(raw);
 if(!parsed.success)return undefined;
 try{const aliases=[...new Set([parsed.data.referenceNumber,parsed.data.receiptNumber,parsed.data.transactionNumber].filter((value):value is string=>!!value).map(value=>canonical(bank,value)))];return aliases.length===1?aliases[0]:undefined}catch{return undefined}
}
// Owner-approved Lowwin policy for these two deposit channels. This is not
// provider proof of currency. Provider currency is not an acceptance condition.
const depositCurrencies:Record<Bank,'ETB'>={telebirr:'ETB',cbe:'ETB'};
const envelopeSchema=z.object({success:z.boolean(),requestId:requestIdSchema,error:providerErrorSchema.optional(),verification:z.object({processingStatus:z.string(),status:z.string().optional(),verified:z.boolean().optional()}).optional(),data:z.union([z.array(z.unknown()),z.record(z.string(),z.unknown())]).optional()}).passthrough();
function providerFailure(raw:unknown,requestId?:string):Verification|undefined{
 const error=providerErrorSchema.safeParse(raw);if(!error.success)return;
 const fixed:Record<string,string>={not_found:'NOT_FOUND',invalid_input:'INVALID_RECEIPT',unsupported_bank:'INVALID_RECEIPT',parse_error:'INCOMPLETE_EVIDENCE',upstream_invalid_response:'INCOMPLETE_EVIDENCE'};
 const code=fixed[error.data.code]??(error.data.retryable===true?(error.data.code==='upstream_rate_limited'?'PROVIDER_RATE_LIMIT':'PROVIDER_OUTAGE'):'PROVIDER_FAILED');
 return {code,matched:false,requestId,evidence:{}};
}
function retryDelay(value:string|null,fallback=30){
 const text=value?.trim();if(!text)return fallback;
 const seconds=/^\d+$/.test(text)?Number(text):(Date.parse(text)-Date.now())/1000;
 return Number.isFinite(seconds)?Math.min(86400,Math.max(1,Math.ceil(seconds))):fallback;
}
function httpFailure(status:number,raw:unknown,retryAfter:string|null):Verification{
 const details=z.object({requestId:requestIdSchema.optional(),error:providerErrorSchema.optional()}).safeParse(raw);
 const requestId=details.success?details.data.requestId:undefined;
 const code=status===401||status===403?'PROVIDER_AUTH':status===402?'PROVIDER_QUOTA':status===409?'IDEMPOTENCY_CONFLICT':status===429?'PROVIDER_RATE_LIMIT':status===400||status===422?'INVALID_RECEIPT':status===404?'PROVIDER_REQUEST_NOT_FOUND':status===408||status>=500?'PROVIDER_OUTAGE':'PROVIDER_FAILED';
 const mapped=details.success?providerFailure(details.data.error,requestId):undefined;
 const result=['PROVIDER_AUTH','PROVIDER_QUOTA','IDEMPOTENCY_CONFLICT','PROVIDER_RATE_LIMIT','INVALID_RECEIPT'].includes(code)?{code,matched:false,requestId,evidence:{}}:mapped??{code,matched:false,requestId,evidence:{}};
 return {...result,retrySeconds:retryDelay(retryAfter)};
}
function safeValueType(raw:unknown,path:PropertyKey[]):SafeValueType{
 let value=raw;
 for(const key of path){
  if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return 'missing';
  value=(value as Record<PropertyKey,unknown>)[key];
 }
 if(value===undefined)return 'missing';
 if(value===null)return 'null';
 if(Array.isArray(value))return 'array';
 const type=typeof value;
 return type==='string'||type==='number'||type==='boolean'?type:'object';
}
function normalizedAccount(bank:Bank,value:string){
 if(!/^\d+$/.test(value))return null;
 if(bank==='telebirr'){
  if(/^09\d{8}$/.test(value))return `251${value.slice(1)}`;
  if(/^9\d{8}$/.test(value))return `251${value}`;
  if(/^2519\d{8}$/.test(value))return value;
  return null;
 }
 return value.replace(/^0+(?=\d)/,'');
}
export function assess(raw:unknown,input:VerificationInput,now=new Date()):Verification{
 const envelope=envelopeSchema.safeParse(raw);if(!envelope.success)return {code:'INCOMPLETE_EVIDENCE',matched:false,evidence:{invalidFields:envelope.error.issues.slice(0,12).map(issue=>({field:issue.path.join('.')||'response',issue:issue.code,received:safeValueType(raw,issue.path)}))}};
 const requestId=envelope.data.requestId;
 const failure=providerFailure(envelope.data.error,requestId);if(failure)return failure;
 if(envelope.data.verification?.processingStatus==='failed')return {code:'UNCONFIRMED',requestId,matched:false,evidence:{}};
 if(envelope.data.success&&['queued','running'].includes(envelope.data.verification?.processingStatus??''))return {code:'PROCESSING',processing:true,requestId,matched:false,evidence:{}};
 if(envelope.data.verification?.processingStatus!=='completed')return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{}};
 if(envelope.data.verification.status==='not_found')return {code:'NOT_FOUND',requestId,matched:false,evidence:{}};
 if(!envelope.data.success||envelope.data.verification.verified!==true||envelope.data.verification.status!=='success')return {code:'UNCONFIRMED',requestId,matched:false,evidence:{}};
 const list=Array.isArray(envelope.data.data)?envelope.data.data:[];
 if(list.length!==1)return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{}};
 const parsed=itemSchema.safeParse(list[0]);if(!parsed.success)return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{invalidFields:parsed.error.issues.slice(0,12).map(issue=>({field:`data.0.${issue.path.join('.')}`,issue:issue.code,received:safeValueType(list[0],issue.path)}))}};
 const item=parsed.data,rawAliases=[item.referenceNumber,item.receiptNumber,item.transactionNumber].filter((value):value is string=>typeof value==='string'&&value.length>0);
 let aliases:string[];try{aliases=[...new Set(rawAliases.map(value=>canonical(input.bank,value)))]}catch{return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{}}}
 const confirmedBefore=item.confirmationHistory?.confirmedBefore;
 const base={requestId,matched:false,evidence:{aliases,confirmedBefore}};
 const fail=(code:string):Verification=>({...base,code});
 if(item.bank!==input.bank||item.status!=='success'||!item.verified)return fail('UNCONFIRMED');
 if(!aliases.includes(input.reference))return fail('REFERENCE_MISMATCH');
 const currency=depositCurrencies[input.bank],currencySource='channel_policy' as const;
 let amount:bigint;try{amount=cents(item.amount)}catch{return fail('INVALID_AMOUNT')}
 if(input.expectedCents!==null?amount!==input.expectedCents:input.minCents===undefined||input.maxCents===undefined||amount<input.minCents||amount>input.maxCents)return fail('AMOUNT_MISMATCH');
 const match=item.settlementAccountMatch,expected=normalizedAccount(input.bank,input.account);
 if(!item.receiverAccount||!expected||match?.ambiguous||match?.matched===false)return fail('RECEIVER_UNPROVEN');
 let receiver=normalizedAccount(input.bank,item.receiverAccount);
 if(item.receiverAccount.includes('*')){
  // Verify.et's documented result masks the receiver. Use its explicit match
  // decision for our frozen account, and check the visible digits too.
  const mask=/^(\d+)\*+(\d{4,})$/.exec(item.receiverAccount);
  if(!mask||match?.matched!==true||match.ambiguous===true||match.bank&&match.bank!==input.bank||normalizedAccount(input.bank,match.matchedSettlementAccount??'')!==expected||!expected.startsWith(mask[1])||!expected.endsWith(mask[2])||mask[1].length+mask[2].length>=expected.length)return fail('RECEIVER_UNPROVEN');
  receiver=expected;
 }
 if(receiver!==expected)return fail('RECEIVER_MISMATCH');
 const date=item.timestamp?new Date(item.timestamp):null;
 if(!date||!/(Z|[+-]\d{2}:\d{2})$/.test(item.timestamp!)||!Number.isFinite(date.getTime())||date<input.createdAt||date>input.expiresAt||date.getTime()>now.getTime()+60000)return fail('DATE_MISMATCH');
 const evidence:Verification['evidence']={currency,currencySource,confirmedBefore,amountCents:amount.toString(),receiverSuffix:item.receiverAccount.slice(-4),date:date.toISOString(),aliases,hash:hash(JSON.stringify({bank:item.bank,currency,currencySource,confirmedBefore,aliases:aliases.slice().sort(),amount:amount.toString(),receiver,receiverEvidence:item.receiverAccount,matchType:match?.matchType,matchConfidence:match?.matchConfidence,date:date.toISOString(),requestId}))};
 return {code:'VERIFIED',matched:true,requestId,evidence};
}
async function boundedJson(response:Response){const reader=response.body?.getReader();if(!reader)throw Error('Empty provider response');let size=0;const chunks:Uint8Array[]=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Provider response too large')}chunks.push(value)}return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown}
function endpoint(){const local=process.env.VERIFY_ET_TEST_ENDPOINT;if(!local)return 'https://verify.et/api/verify';const url=new URL(local);if(!demoBidAllowed()||process.env.PAYMENTS_TEST_ENABLED!=='true'||url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/api/verify')throw Error('Invalid isolated Verify.et fixture endpoint');return url.href}
function key(){return process.env.VERIFY_ET_API_KEY??''}
function log(input:VerificationInput,result:Verification,httpStatus?:number,failure?:string,elapsedMs?:number){const entry={event:'payment_provider_verification',bank:input.bank,code:result.code,httpStatus,elapsedMs,failure,currencySource:result.evidence.currencySource,invalidFields:result.evidence.invalidFields,requestTag:result.requestId?hash(result.requestId).slice(0,12):undefined};(result.matched?console.info:console.warn)(JSON.stringify(entry))}
export async function submitVerify(input:VerificationInput):Promise<Verification>{
 const started=performance.now();let status:number|undefined;const finish=(result:Verification,failure?:string)=>{log(input,result,status,failure,Math.round(performance.now()-started));return result};
 if(!key())return finish({code:'PROVIDER_UNCONFIGURED',matched:false,evidence:{}});
 try{
  const body=input.bank==='telebirr'?{bank:input.bank,transactionNumber:input.reference,settlementAccount:input.account}:{bank:input.bank,reference:input.reference,...(/^FT[A-Z0-9]{6,30}$/.test(input.reference)?{suffix:input.account.slice(-8)}:{}),settlementAccount:input.account};
  const response=await fetch(`${endpoint()}?waitMs=5000`,{method:'POST',headers:{'x-api-key':key(),'Idempotency-Key':input.attemptKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(PROVIDER_TIMEOUT_MS),redirect:'error',cache:'no-store'});status=response.status;
  if(!response.ok){let raw:unknown;try{raw=await boundedJson(response)}catch{/* HTTP status still gives a safe recovery decision. */}return finish(httpFailure(status,raw,response.headers.get('retry-after')))}
  const raw=await boundedJson(response);const result=assess(raw,input);
  if(status===202){
   const queued=envelopeSchema.safeParse(raw);
   if(!queued.success||!queued.data.success||queued.data.error)return finish(result);
   if(queued.data.verification&&!['queued','running'].includes(queued.data.verification.processingStatus))return finish({code:'INCOMPLETE_EVIDENCE',requestId:queued.data.requestId,matched:false,evidence:{}});
   return finish({code:'PROCESSING',requestId:queued.data.requestId,processing:true,matched:false,evidence:{},retrySeconds:retryDelay(response.headers.get('retry-after'),5)});
  }
  return finish(result);
 }catch(error){return finish({code:'PROVIDER_OUTAGE',matched:false,retrySeconds:60,evidence:{}},error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':status?'RESPONSE_UNREADABLE':'REQUEST_FAILED')}
}
function imagePlaceholder(input:Pick<ImageVerificationInput,'bank'|'attemptKey'>){return `IMG${hash(`${input.bank}:${input.attemptKey}`).slice(0,28).toUpperCase()}`}
export async function submitVerifyImage(input:ImageVerificationInput):Promise<ImageVerification>{
 const started=performance.now();let status:number|undefined,imageProcessing:ImageVerification['imageProcessing'];const placeholder=imagePlaceholder(input),base={...input,reference:placeholder};
 const finish=(verification:Verification,reference?:string,failure?:string)=>{log(base,verification,status,failure,Math.round(performance.now()-started));if(imageProcessing)console.info(JSON.stringify({event:'payment_image_processing',bank:input.bank,...imageProcessing,requestTag:verification.requestId?hash(verification.requestId).slice(0,12):undefined}));return {verification,reference,imageProcessing}};
 if(!key())return finish({code:'PROVIDER_UNCONFIGURED',matched:false,evidence:{}});
 try{
  const form=new FormData();form.append('image',new Blob([Uint8Array.from(input.image)],{type:input.mime}),input.mime==='image/png'?'receipt.png':input.mime==='image/webp'?'receipt.webp':'receipt.jpg');form.append('bank',input.bank);form.append('settlementAccount',input.account);
  const response=await fetch(`${endpoint()}?waitMs=5000`,{method:'POST',headers:{'x-api-key':key(),'Idempotency-Key':input.attemptKey},body:form,signal:AbortSignal.timeout(PROVIDER_TIMEOUT_MS),redirect:'error',cache:'no-store'});status=response.status;
  if(!response.ok){let raw:unknown;try{raw=await boundedJson(response)}catch{}return finish(httpFailure(status,raw,response.headers.get('retry-after')))}
  const raw=await boundedJson(response),envelope=envelopeSchema.safeParse(raw);
  const metadata=imageProcessingSchema.safeParse(envelope.success?envelope.data.imageProcessing:undefined);if(metadata.success)imageProcessing=metadata.data;
  if(status===202){
   if(!envelope.success||!envelope.data.success||envelope.data.error||!envelope.data.verification||!['queued','running'].includes(envelope.data.verification.processingStatus))return finish({code:'INCOMPLETE_EVIDENCE',requestId:envelope.success?envelope.data.requestId:undefined,matched:false,evidence:{}});
   return finish({code:'PROCESSING',requestId:envelope.data.requestId,processing:true,matched:false,evidence:{},retrySeconds:retryDelay(response.headers.get('retry-after'),5)});
  }
  const item=envelope.success&&Array.isArray(envelope.data.data)&&envelope.data.data.length===1?envelope.data.data[0]:undefined,reference=providerReference(item,input.bank);
  const verification=assess(raw,{...base,reference:reference??placeholder});
  return finish(verification,reference);
 }catch(error){return finish({code:'PROVIDER_OUTAGE',matched:false,retrySeconds:60,evidence:{}},undefined,error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':status?'RESPONSE_UNREADABLE':'REQUEST_FAILED')}
}
// A null result means terminal success: retrieve full evidence using the same
// immutable submission key. All other states are final or delayed local outcomes.
export async function readVerifyStatus(requestId:string):Promise<Verification|null>{
 const id=requestIdSchema.parse(requestId);if(!key())return {code:'PROVIDER_UNCONFIGURED',matched:false,requestId:id,evidence:{}};
 try{
  const response=await fetch(`${endpoint()}/${encodeURIComponent(id)}`,{headers:{'x-api-key':key()},signal:AbortSignal.timeout(5000),redirect:'error',cache:'no-store'});
  let raw:unknown;try{raw=await boundedJson(response)}catch{if(response.ok)throw Error('Unreadable status')}
  if(!response.ok)return {...httpFailure(response.status,raw,response.headers.get('retry-after')),requestId:id};
  const parsed=z.object({success:z.boolean(),error:providerErrorSchema.optional(),data:z.object({requestId:requestIdSchema,processingStatus:z.string(),status:z.string().optional(),verified:z.boolean().optional(),error:providerErrorSchema.optional()}).optional()}).safeParse(raw);
  const incomplete:Verification={code:'INCOMPLETE_EVIDENCE',matched:false,requestId:id,evidence:{}};
  if(!parsed.success)return incomplete;
  const data=parsed.data.data;
  if(data&&data.requestId!==id)return incomplete;
  const failure=providerFailure(parsed.data.error??data?.error,id);if(failure)return failure;
  if(!data)return incomplete;
  if(parsed.data.success&&['queued','running'].includes(data.processingStatus))return {code:'PROCESSING',matched:false,processing:true,requestId:id,retrySeconds:response.headers.has('retry-after')?retryDelay(response.headers.get('retry-after')):undefined,evidence:{}};
  if(data.processingStatus==='completed'&&parsed.data.success&&data.status==='success'&&data.verified===true)return null;
  if(['completed','failed'].includes(data.processingStatus))return {code:data.status==='not_found'?'NOT_FOUND':'UNCONFIRMED',matched:false,requestId:id,evidence:{}};
  return incomplete;
 }catch{return {code:'PROVIDER_OUTAGE',matched:false,requestId:id,retrySeconds:30,evidence:{}}}
}
