import {createHash} from 'node:crypto';
import {z} from 'zod';

export type ArifPayChannel='TELEBIRR'|'MPESA';
export class ArifPayError extends Error {
 constructor(public status:number,public code:string,message:string){super(message);this.name='ArifPayError'}
}
export const arifPayHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function arifPayCanaryAllowed(userId:string,auctionSlug?:string,raw:Record<string,string|undefined>=process.env){
 const users=(raw.ARIFPAY_CANARY_USER_IDS??'').split(',').map(v=>v.trim()).filter(Boolean);
 const auctions=(raw.ARIFPAY_CANARY_AUCTION_SLUGS??'').split(',').map(v=>v.trim()).filter(Boolean);
 return (!users.length||users.includes(userId))&&(!auctionSlug||!auctions.length||auctions.includes(auctionSlug));
}
export function arifPayAvailability(raw:Record<string,string|undefined>=process.env){
 const channels=['TELEBIRR','MPESA'] as const;
 const key=raw.ARIFPAY_API_KEY;
 let origins=false;
 try{const a=new URL(raw.BETTER_AUTH_URL??''),m=new URL(raw.MINI_APP_URL??'');origins=a.protocol==='https:'&&m.protocol==='https:'&&a.origin===m.origin}catch{}
 const configured=raw.ARIFPAY_SCHEMA_READY==='true'&&raw.ARIFPAY_MERCHANT_REVIEWED==='true'
  &&raw.APP_ENV==='production'&&raw.NODE_ENV==='production'&&origins&&!!key&&!/REPLACE|CHANGE_ME|fixture|sandbox/i.test(key)
  &&!!raw.ARIFPAY_WEBHOOK_TOKEN&&raw.ARIFPAY_WEBHOOK_TOKEN.length>=32
  &&raw.ARIFPAY_BASE_URL==='https://gateway.arifpay.net'
  &&raw.ARIFPAY_CURRENCY==='ETB'&&raw.DEV_POINTS_ENABLED!=='true'&&raw.DEV_IDENTITY_ENABLED!=='true'&&raw.STAGING_DEMO_ENABLED!=='true';
 // Selecting Chapa stops new legacy charges without abandoning existing orders.
 const enabled=configured&&raw.ARIFPAY_ENABLED==='true'&&raw.PAYMENT_GATEWAY!=='CHAPA';
 const recoveryEnabled=configured&&(raw.ARIFPAY_ENABLED==='true'||raw.ARIFPAY_RECOVERY_ENABLED==='true');
 return {enabled,recoveryEnabled,channels,currency:'ETB' as const,reason:enabled?null:'Direct payment is not available yet. Try again later or contact support.'};
}
export function requireArifPay(mode:'create'|'recover'='create'){const health=arifPayAvailability();if(!(mode==='recover'?health.recoveryEnabled:health.enabled))throw new ArifPayError(503,'PAYMENT_UNAVAILABLE',health.reason??'Payment recovery is unavailable. Keep this payment ID and contact support.')}
export type ArifPayCreate={nonce:string;phone:string;fee:string;channel:ArifPayChannel;expiresAt:Date;returnUrl:string;notifyUrl:string};
export type ArifPayTransport={create:(input:ArifPayCreate)=>Promise<unknown>;lookup:(nonce:string)=>Promise<unknown>};

async function providerRequest(path:string,body?:unknown,mode:'create'|'recover'='recover'){
 requireArifPay(mode);
 const response=await fetch(`${process.env.ARIFPAY_BASE_URL}${path}`,{method:body?'POST':'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','x-arifpay-key':process.env.ARIFPAY_API_KEY!},...(body?{body:JSON.stringify(body)}:{})});
 // Never log raw payloads, customer phone numbers, API keys, tokens or provider errors.
 const raw=await response.text();if(raw.length>65536)throw new ArifPayError(502,'PROVIDER_UNAVAILABLE','Payment verification is pending. Check this same payment again.');
 if(!response.ok)throw new ArifPayError(502,'PROVIDER_UNAVAILABLE','Payment verification is pending. Check this same payment again.');
 try{return JSON.parse(raw) as unknown}catch{throw new ArifPayError(502,'PROVIDER_UNAVAILABLE','Payment verification is pending. Check this same payment again.')}
}
export const arifPayTransport:ArifPayTransport={
 create:input=>providerRequest(input.channel==='MPESA'?'/api/checkout/mpesa/transfer/direct':'/api/checkout/telebirr-ussd/transfer/direct',{
  cancelUrl:input.returnUrl,errorUrl:input.returnUrl,successUrl:input.returnUrl,notifyUrl:input.notifyUrl,
  phone:input.phone,nonce:input.nonce,expireDate:input.expiresAt.toISOString(),
  items:[{name:'Lowin bid submission fee',quantity:1,price:Number(input.fee),description:'One bid submission. The chosen bid number is not a payment amount.'}],lang:'EN',
 },'create'),
 lookup:nonce=>providerRequest(`/api/checkout/getSessionByNonce/${encodeURIComponent(nonce)}`),
};

const id=z.string().min(1).max(256);
const money=z.union([z.string().regex(/^\d+(?:\.\d{1,2})?$/),z.number().finite().nonnegative()]).transform(String);
const envelope=z.object({error:z.literal(false),data:z.object({
 uuid:id.optional(),sessionId:id.optional(),SessionId:id.optional(),nonce:id,phone:z.string(),totalAmount:money,
 currency:z.string().optional(),paymentMethod:z.string().optional(),paymentType:z.string().optional(),transactionStatus:z.string().optional(),
 transaction:z.object({transactionStatus:z.string(),transactionId:id.optional()}).nullable().optional(),
})});
export type ArifPayEvidence={sessionId:string;nonce:string;phone:string;amount:string;currency?:string;channel?:string;status:string;transactionId?:string;hash:string};
export function parseArifPayEvidence(raw:unknown):ArifPayEvidence|null {
 const parsed=envelope.safeParse(raw);if(!parsed.success)return null;
 const d=parsed.data.data,sessions=[d.uuid,d.sessionId,d.SessionId].filter((v):v is string=>!!v);
 if(!sessions.length||new Set(sessions).size!==1||d.transactionStatus&&d.transaction?.transactionStatus&&d.transactionStatus!==d.transaction.transactionStatus)return null;
 const status=d.transaction?.transactionStatus??d.transactionStatus;
 if(!status||!['PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED'].includes(status))return null;
 return {sessionId:sessions[0],nonce:d.nonce,phone:d.phone,amount:d.totalAmount,currency:d.currency,channel:d.paymentMethod??d.paymentType,status,transactionId:d.transaction?.transactionId,hash:arifPayHash(JSON.stringify(raw))};
}
export function createdArifPaySession(raw:unknown):string|null{
 const parsed=z.object({error:z.literal(false),data:z.object({sessionId:id})}).safeParse(raw);
 return parsed.success?parsed.data.data.sessionId:null;
}
