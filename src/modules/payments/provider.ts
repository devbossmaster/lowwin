import {createHash} from 'node:crypto';
import {z} from 'zod';
import {demoBidAllowed} from '../auctions/bids';
export const bankSchema=z.enum(['telebirr','cbe']);
export type Bank=z.infer<typeof bankSchema>;
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export class PaymentError extends Error{constructor(public status:number,message:string){super(message)}}
export function cents(value:string|number):bigint {
 const s=String(value);if(!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(s))throw new PaymentError(422,'Use an exact ETB amount with at most two decimal places.');
 const [whole,fraction='']=s.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function canonical(bank:Bank,raw:string){const s=raw.trim().toUpperCase();if(!(bank==='cbe'?/^FT[A-Z0-9]{6,30}$/:/^[A-Z][A-Z0-9]{7,31}$/).test(s))throw new PaymentError(422,'Enter a supported transaction reference.');return s}
// URLs are parsed, never fetched. Only exact official host/path shapes are accepted.
export function candidate(bank:Bank,raw:string){
 const text=raw.trim();if(!text||text.length>4000)throw new PaymentError(422,'Enter one transaction reference or receipt.');
 const urls=text.match(/https?:\/\/[^\s<>"']+/g)??[];
 if(urls.length){if(urls.length!==1)throw new PaymentError(422,'More than one receipt was found. Enter one reference.');const u=new URL(urls[0]);const host=bank==='cbe'?'cbe.com.et':'apps.ethiotelecom.et';if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port||u.search||u.hash||!/^\/receipt\/[a-z0-9]+\/?$/i.test(u.pathname))throw new PaymentError(422,'Use an official supported receipt link or enter the reference.');return canonical(bank,u.pathname.split('/')[2]);}
 if(/^[a-z0-9]+$/i.test(text))return canonical(bank,text);
 if(bank==='cbe'&&/telebirr/i.test(text)||bank==='telebirr'&&/\bCBE\b|Commercial Bank/i.test(text))throw new PaymentError(422,'Receipt bank does not match the selected account.');
 const found=bank==='cbe'?text.toUpperCase().match(/\bFT[A-Z0-9]{6,30}\b/g):[...text.toUpperCase().matchAll(/(?:TRANSACTION\s*(?:NUMBER|ID|NO\.?|REFERENCE)?|REFERENCE|RECEIPT)\s*[:#-]?\s*([A-Z][A-Z0-9]{7,31})\b/g)].map(m=>m[1]);
 const values=[...new Set(found??[])];if(values.length!==1)throw new PaymentError(422,'A single clear reference could not be found. Enter it manually.');return canonical(bank,values[0]);
}
const envelope=z.object({success:z.boolean(),exists:z.boolean(),duplicate:z.boolean(),data:z.object({bank:bankSchema,transaction_number:z.string(),verification_method:z.string(),receipt:z.object({status:z.string(),transaction_type:z.string(),amount:z.union([z.number(),z.string()]),currency:z.string(),transaction_date:z.string(),receiver_account:z.string().optional()})})});
export type VerificationInput={bank:Bank;reference:string;account:string;expectedCents:bigint;createdAt:Date;expiresAt:Date};
export type Verification={code:string;retrySeconds?:number;evidence:{amountCents?:string;receiverSuffix?:string;date?:string;method?:string;hash?:string};matched:boolean};
export function assess(raw:unknown,input:VerificationInput,now=new Date()):Verification{
 const parsed=envelope.safeParse(raw);if(!parsed.success)return {code:'INCOMPLETE_EVIDENCE',evidence:{},matched:false};
 const {success,exists,data}=parsed.data,r=data.receipt;let amount:bigint;try{amount=cents(r.amount)}catch{return {code:'INVALID_AMOUNT',evidence:{},matched:false}}
 const date=new Date(r.transaction_date),evidence={amountCents:amount.toString(),receiverSuffix:r.receiver_account?.slice(-4),date:Number.isFinite(date.getTime())?date.toISOString():undefined,method:data.verification_method,hash:hash(JSON.stringify({bank:data.bank,reference:data.transaction_number,amount:amount.toString(),receiver:r.receiver_account,date:r.transaction_date,status:r.status,method:data.verification_method}))};
 const fail=(code:string):Verification=>({code,evidence,matched:false});
 // Provider duplicates are investigation evidence, never permission to issue credit.
 // Existing local claims are checked independently under the transfer lock.
 if(parsed.data.duplicate)return fail('DUPLICATE_REVIEW');
 if(!success||!exists)return fail('UNCONFIRMED');if(r.status!=='completed'||r.transaction_type&&r.transaction_type!=='transfer')return fail('INCOMPLETE_TRANSFER');
 if(data.bank!==input.bank||data.transaction_number.toUpperCase()!==input.reference)return fail('REFERENCE_MISMATCH');
 if(data.verification_method!=='official')return fail('UNSUPPORTED_METHOD');if(r.currency!=='ETB')return fail('CURRENCY_MISMATCH');if(amount!==input.expectedCents)return fail('AMOUNT_MISMATCH');
 // Never accept masked accounts or infer a receiver from a name or success flag.
 if(!r.receiver_account)return fail('RECEIVER_UNPROVEN');if(r.receiver_account!==input.account)return fail('RECEIVER_MISMATCH');
 if(!/(Z|[+-]\d{2}:\d{2})$/.test(r.transaction_date)||!Number.isFinite(date.getTime())||date<input.createdAt||date>input.expiresAt||date.getTime()>now.getTime()+60000)return fail('DATE_MISMATCH');
 return {code:'VERIFIED',evidence,matched:true};
}
export type VerifyTransport=(input:VerificationInput)=>Promise<Verification>;
export async function checkEt(input:VerificationInput):Promise<Verification>{
 const key=process.env.CHECK_ET_MODE==='test'?process.env.CHECK_ET_TEST_API_KEY:process.env.CHECK_ET_LIVE_API_KEY;
 if(!key)return {code:'PROVIDER_UNCONFIGURED',evidence:{},matched:false};
 try{
  let endpoint='https://api.check.et/api/v1/verify';if(process.env.CHECK_ET_TEST_ENDPOINT){const url=new URL(process.env.CHECK_ET_TEST_ENDPOINT);if(!demoBidAllowed()||process.env.CHECK_ET_MODE!=='test'||url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error();endpoint=url.href;}
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({bank:input.bank,transaction_number:input.reference,...(input.bank==='cbe'?{account_number:input.account}:{})}),signal:AbortSignal.timeout(12000),redirect:'error',cache:'no-store'});
  if(!response.ok){const code=({401:'PROVIDER_AUTH',402:'PROVIDER_QUOTA',404:'NOT_FOUND',422:'INVALID_RECEIPT',429:'PROVIDER_RATE_LIMIT'} as Record<number,string>)[response.status]??'PROVIDER_OUTAGE';return {code,matched:false,evidence:{},retrySeconds:Math.min(3600,Math.max(30,Number(response.headers.get('retry-after'))||60))};}
  const reader=response.body?.getReader();if(!reader)throw Error();let size=0;const chunks:Uint8Array[]=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error()}chunks.push(value)}return assess(JSON.parse(Buffer.concat(chunks).toString('utf8')),input);
 }catch{return {code:'PROVIDER_OUTAGE',retrySeconds:60,evidence:{},matched:false}}
}
