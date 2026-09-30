import {createHash} from 'node:crypto';
import {z} from 'zod';
import {demoBidAllowed} from '../auctions/bids';
import {PROVIDER_TIMEOUT_MS} from './timing';

export const bankSchema=z.enum(['telebirr','cbe']);
export type Bank=z.infer<typeof bankSchema>;
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class PaymentError extends Error{constructor(public status:number,message:string){super(message)}}
export function cents(value:string|number):bigint{
 const text=String(value);if(!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(text))throw new PaymentError(422,'Use an exact ETB amount with at most two decimal places.');
 const [whole,fraction='']=text.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function canonical(bank:Bank,raw:string){
 const value=raw.trim();
 if(bank==='telebirr'){const upper=value.toUpperCase();if(!/^[A-Z][A-Z0-9]{7,31}$/.test(upper))throw new PaymentError(422,'Enter a supported transaction number.');return upper}
 if(!/^[A-Za-z0-9]{8,64}$/.test(value))throw new PaymentError(422,'Enter a CBE Receipt ID or legacy FT reference.');
 return /^FT[A-Z0-9]{6,30}$/i.test(value)?value.toUpperCase():value;
}
// Parse only known receipt shapes. A URL is never fetched by Lowwin.
export function candidate(bank:Bank,raw:string){
 const text=raw.trim();if(!text||text.length>4000)throw new PaymentError(422,'Enter one transaction reference or receipt.');
 const urls=text.match(/https?:\/\/[^\s<>"']+/g)??[];
 if(urls.length){
  if(urls.length!==1)throw new PaymentError(422,'More than one receipt was found. Enter one reference.');
  const url=new URL(urls[0]);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.search)throw new PaymentError(422,'Use an official supported receipt link or enter the reference.');
  if(bank==='cbe'&&url.hostname==='mbreciept.cbe.com.et'&&/^\/[A-Za-z0-9]{8,64}\/?$/.test(url.pathname))return canonical(bank,url.pathname.split('/')[1]);
  if(bank==='telebirr'&&url.hostname==='apps.ethiotelecom.et'&&/^\/receipt\/[A-Za-z0-9]{8,32}\/?$/.test(url.pathname))return canonical(bank,url.pathname.split('/')[2]);
  throw new PaymentError(422,'Use an official supported receipt link or enter the reference.');
 }
 if(/^[A-Za-z0-9]+$/.test(text))return canonical(bank,text);
 if(bank==='cbe'&&/telebirr/i.test(text)||bank==='telebirr'&&/\bCBE\b|Commercial Bank/i.test(text))throw new PaymentError(422,'Receipt bank does not match the selected account.');
 const pattern=bank==='cbe'?/(?:receipt\s*id|reference(?:\s*(?:number|no\.?))?)\s*[:#-]?\s*([A-Za-z0-9]{8,64})/gi:/(?:transaction\s*(?:number|id|no\.?|reference)?|reference|receipt)\s*[:#-]?\s*([A-Za-z][A-Za-z0-9]{7,31})/gi;
 const found=[...text.matchAll(pattern)].map(match=>canonical(bank,match[1]));
 const unique=[...new Set(found)];if(unique.length!==1)throw new PaymentError(422,'A single clear reference could not be found. Enter it manually.');return unique[0];
}
export type VerificationInput={bank:Bank;reference:string;account:string;expectedCents:bigint|null;minCents?:bigint;maxCents?:bigint;createdAt:Date;expiresAt:Date;attemptKey:string};
type EvidenceFieldIssue={field:string;issue:string;received:string};
export type Verification={code:string;matched:boolean;requestId?:string;processing?:boolean;retrySeconds?:number;evidence:{amountCents?:string;receiverSuffix?:string;date?:string;hash?:string;aliases?:string[];invalidFields?:EvidenceFieldIssue[]}};
export type VerifyTransport=(input:VerificationInput)=>Promise<Verification>;
const requestIdSchema=z.string().uuid();
const itemSchema=z.object({bank:bankSchema,status:z.string(),verified:z.boolean(),amount:z.union([z.string(),z.number()]),currency:z.string(),receiverAccount:z.string().optional(),referenceNumber:z.string().optional(),receiptNumber:z.string().optional(),transactionNumber:z.string().optional(),timestamp:z.string().optional(),settlementAccountMatch:z.object({matched:z.boolean(),matchType:z.string().optional(),ambiguous:z.boolean().optional()}).optional()}).passthrough();
const envelopeSchema=z.object({success:z.boolean(),requestId:requestIdSchema,verification:z.object({processingStatus:z.string(),status:z.string().optional(),verified:z.boolean().optional()}).optional(),data:z.union([z.array(z.unknown()),z.record(z.string(),z.unknown())]).optional()}).passthrough();
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
 const envelope=envelopeSchema.safeParse(raw);if(!envelope.success)return {code:'INCOMPLETE_EVIDENCE',matched:false,evidence:{invalidFields:envelope.error.issues.slice(0,12).map(issue=>({field:issue.path.join('.')||'response',issue:issue.code,received:'invalid'}))}};
 const requestId=envelope.data.requestId;
 if(envelope.data.verification?.processingStatus!=='completed')return {code:'PROCESSING',processing:true,requestId,matched:false,evidence:{}};
 if(!envelope.data.success||envelope.data.verification.verified!==true||envelope.data.verification.status!=='success')return {code:'UNCONFIRMED',requestId,matched:false,evidence:{}};
 const list=Array.isArray(envelope.data.data)?envelope.data.data:[];
 if(list.length!==1)return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{}};
 const parsed=itemSchema.safeParse(list[0]);if(!parsed.success)return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{invalidFields:parsed.error.issues.slice(0,12).map(issue=>({field:`data.0.${issue.path.join('.')}`,issue:issue.code,received:'invalid'}))}};
 const item=parsed.data,rawAliases=[item.referenceNumber,item.receiptNumber,item.transactionNumber].filter((value):value is string=>typeof value==='string'&&value.length>0);
 let aliases:string[];try{aliases=[...new Set(rawAliases.map(value=>canonical(input.bank,value)))]}catch{return {code:'INCOMPLETE_EVIDENCE',requestId,matched:false,evidence:{}}}
 const base={requestId,matched:false,evidence:{aliases}};
 const fail=(code:string):Verification=>({...base,code});
 if(item.bank!==input.bank||item.status!=='success'||!item.verified)return fail('UNCONFIRMED');
 if(!aliases.includes(input.reference))return fail('REFERENCE_MISMATCH');
 if(item.currency!=='ETB')return fail('CURRENCY_MISMATCH');
 let amount:bigint;try{amount=cents(item.amount)}catch{return fail('INVALID_AMOUNT')}
 if(input.expectedCents!==null?amount!==input.expectedCents:input.minCents===undefined||input.maxCents===undefined||amount<input.minCents||amount>input.maxCents)return fail('AMOUNT_MISMATCH');
 // Verify.et can report a high-confidence masked match. Only a complete receiver value authorizes credit.
 if(!item.receiverAccount||item.receiverAccount.includes('*')||item.settlementAccountMatch?.ambiguous||item.settlementAccountMatch?.matched===false)return fail('RECEIVER_UNPROVEN');
 const receiver=normalizedAccount(input.bank,item.receiverAccount),expected=normalizedAccount(input.bank,input.account);
 if(!receiver||!expected||receiver!==expected)return fail('RECEIVER_MISMATCH');
 const date=item.timestamp?new Date(item.timestamp):null;
 if(!date||!/(Z|[+-]\d{2}:\d{2})$/.test(item.timestamp!)||!Number.isFinite(date.getTime())||date<input.createdAt||date>input.expiresAt||date.getTime()>now.getTime()+60000)return fail('DATE_MISMATCH');
 const evidence={amountCents:amount.toString(),receiverSuffix:item.receiverAccount.slice(-4),date:date.toISOString(),aliases,hash:hash(JSON.stringify({bank:item.bank,aliases:aliases.slice().sort(),amount:amount.toString(),receiver,date:date.toISOString(),requestId}))};
 return {code:'VERIFIED',matched:true,requestId,evidence};
}
async function boundedJson(response:Response){const reader=response.body?.getReader();if(!reader)throw Error('Empty provider response');let size=0;const chunks:Uint8Array[]=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Provider response too large')}chunks.push(value)}return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown}
function endpoint(){const local=process.env.VERIFY_ET_TEST_ENDPOINT;if(!local)return 'https://verify.et/api/verify';const url=new URL(local);if(!demoBidAllowed()||process.env.PAYMENTS_TEST_ENABLED!=='true'||url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/api/verify')throw Error('Invalid isolated Verify.et fixture endpoint');return url.href}
function key(){return process.env.VERIFY_ET_API_KEY??''}
function log(input:VerificationInput,result:Verification,httpStatus?:number,failure?:string,elapsedMs?:number){const entry={event:'payment_provider_verification',bank:input.bank,code:result.code,httpStatus,elapsedMs,failure,invalidFields:result.evidence.invalidFields,requestTag:result.requestId?hash(result.requestId).slice(0,12):undefined};(result.matched?console.info:console.warn)(JSON.stringify(entry))}
export async function submitVerify(input:VerificationInput):Promise<Verification>{
 const started=performance.now();let status:number|undefined;const finish=(result:Verification,failure?:string)=>{log(input,result,status,failure,Math.round(performance.now()-started));return result};
 if(!key())return finish({code:'PROVIDER_UNCONFIGURED',matched:false,evidence:{}});
 try{
  const body=input.bank==='telebirr'?{bank:input.bank,transactionNumber:input.reference,settlementAccount:input.account}:{bank:input.bank,reference:input.reference,...(/^FT[A-Z0-9]{6,30}$/.test(input.reference)?{suffix:input.account.slice(-8)}:{}),settlementAccount:input.account};
  const response=await fetch(`${endpoint()}?waitMs=5000`,{method:'POST',headers:{'x-api-key':key(),'Idempotency-Key':input.attemptKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(PROVIDER_TIMEOUT_MS),redirect:'error',cache:'no-store'});status=response.status;
  if(!response.ok&&status!==202)return finish({code:status===401||status===403?'PROVIDER_AUTH':status===402?'PROVIDER_QUOTA':status===409?'IDEMPOTENCY_CONFLICT':status===429?'PROVIDER_RATE_LIMIT':status===422?'INVALID_RECEIPT':'PROVIDER_OUTAGE',matched:false,retrySeconds:Math.min(3600,Math.max(30,Number(response.headers.get('retry-after'))||60)),evidence:{}});
  const raw=await boundedJson(response);const result=assess(raw,input);
  return finish(status===202?{...result,code:'PROCESSING',processing:true,matched:false,evidence:{}}:result);
 }catch(error){return finish({code:'PROVIDER_OUTAGE',matched:false,retrySeconds:60,evidence:{}},error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':status?'RESPONSE_UNREADABLE':'REQUEST_FAILED')}
}
export async function readVerifyStatus(requestId:string){
 const id=requestIdSchema.parse(requestId);if(!key())throw new PaymentError(503,'Verification is temporarily unavailable.');
 const response=await fetch(`${endpoint()}/${encodeURIComponent(id)}`,{headers:{'x-api-key':key()},signal:AbortSignal.timeout(5000),redirect:'error',cache:'no-store'});
 if(!response.ok)throw new PaymentError(503,'Verification is temporarily unavailable.');return boundedJson(response);
}
