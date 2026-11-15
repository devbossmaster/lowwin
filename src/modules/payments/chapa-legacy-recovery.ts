import {z} from 'zod';
import type {ChapaCheckout,Prisma,PrismaClient} from '@prisma/client';
import {etbToCents} from '@/lib/money';
import {ChapaError,ChapaProviderError,chapaHash,type ChapaEvidence,type ChapaMode,type ChapaTransport} from './chapa-provider';
import {chapaRecoveryBindingSchema,recoveryBindingHash,type ChapaRecoveryBinding} from './chapa-recovery-binding';

type Environment=Record<string,string|undefined>;
const origins=['https://api.chapa.co','https://api.chapa.global'] as const;
const reference=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const decimal=z.union([z.string(),z.number().finite()]).transform(String).refine(value=>/^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)).transform(value=>etbToCents(value).toString());
const apiOrigin=(raw:Environment)=>raw.CHAPA_V1_BASE_URL??origins[0];
export function isLegacyChapaCheckout(order:{flowVersion?:number;initialization:unknown}){
 return order.flowVersion===3||!!order.initialization&&typeof order.initialization==='object'&&!Array.isArray(order.initialization)&&(order.initialization as Record<string,unknown>).apiVersion==='v1';
}
/** This is deliberately the historical fingerprint, not the current v2 key's hash. */
export function legacyChapaConfigurationFingerprint(raw:Environment=process.env){return raw.CHAPA_V1_SECRET_KEY?chapaHash(JSON.stringify(['v1',apiOrigin(raw),raw.CHAPA_V1_SECRET_KEY])):null}
export function chapaLegacyRecoveryAvailability(raw:Environment=process.env){
 const mode:ChapaMode=raw.CHAPA_V1_MODE==='live'?'live':'test',validMode=raw.CHAPA_V1_MODE==='test'||raw.CHAPA_V1_MODE==='live',key=raw.CHAPA_V1_SECRET_KEY??'';
 const validKey=(mode==='test'?/^CHASECK_TEST-[A-Za-z0-9_-]{16,240}$/:/^CHASECK(?:_LIVE)?-[A-Za-z0-9_-]{16,240}$/).test(key)&&!/REPLACE|CHANGE_ME|example|fixture/i.test(key);
 let local=false;try{local=['localhost','127.0.0.1','[::1]'].includes(new URL(raw.DATABASE_URL??'').hostname)}catch{}
 const testEnvironment=['local','test','staging'].includes(raw.APP_ENV??'')&&raw.VERCEL_ENV!=='production'&&(local||raw.APP_ENV==='staging'&&raw.CHAPA_V1_TEST_ENVIRONMENT_REVIEWED==='true');
 const liveEnvironment=raw.APP_ENV==='production'&&raw.NODE_ENV==='production'&&!['preview','development'].includes(raw.VERCEL_ENV??'')&&raw.CHAPA_V1_MERCHANT_REVIEWED==='true'&&!['DEV_IDENTITY_ENABLED','DEV_POINTS_ENABLED','STAGING_DEMO_ENABLED'].some(name=>raw[name]==='true');
 const configured=validMode&&validKey&&raw.CHAPA_SCHEMA_READY==='true'&&origins.includes(apiOrigin(raw) as typeof origins[number])&&(mode==='test'?testEnvironment:liveEnvironment);
 return {configured,recoveryEnabled:configured&&raw.CHAPA_V1_RECOVERY_ENABLED==='true',mode,currency:'ETB' as const,credentialFingerprint:legacyChapaConfigurationFingerprint(raw)};
}
/** A UI flag is not an audited rotated-key authorization. A replacement key
 * can be approved only by the async per-order audit check below. */
export function legacyChapaRecoveryAvailable(order:{flowVersion?:number;initialization:unknown;mode:string;credentialFingerprint:string},raw:Environment=process.env){
 const health=chapaLegacyRecoveryAvailability(raw);return isLegacyChapaCheckout(order)&&health.recoveryEnabled&&health.mode===order.mode&&health.credentialFingerprint===order.credentialFingerprint;
}
function requireRecovery(raw:Environment){const health=chapaLegacyRecoveryAvailability(raw);if(!health.recoveryEnabled)throw new ChapaError(503,'LEGACY_RECOVERY_UNAVAILABLE','This original payment needs its original Chapa v1 recovery configuration. Keep its payment reference.');return health}

const verification=z.object({status:z.enum(['success','pending','failed']),data:z.object({tx_ref:reference,reference:reference.nullish(),amount:decimal,currency:z.literal('ETB'),status:z.enum(['success','pending','failed','cancelled','failed/cancelled','refunded','reversed']),mode:z.enum(['test','live']),charge:decimal.nullish(),method:z.string().max(80).nullish(),payment_method:z.string().max(80).nullish(),meta:z.record(z.string().max(80),z.unknown()).nullish()})});
/** Original v1 amounts are major ETB units. Never parse them as v2 integer cents. */
export function parseLegacyChapaEvidence(raw:unknown):ChapaEvidence|null{
 const parsed=verification.safeParse(raw);if(!parsed.success)return null;const {data,status:envelope}=parsed.data;
 if(data.status==='success'&&(envelope!=='success'||!data.reference))return null;
 const status=data.status==='success'?'SUCCESS':data.status==='pending'?'PENDING':data.status==='cancelled'?'CANCELLED':'FAILED';
 return {merchantReference:data.tx_ref,chapaReference:data.reference??null,amountCents:data.amount,currency:data.currency,status,mode:data.mode,paymentMethod:data.payment_method??data.method??undefined,serviceFeeCents:data.charge??undefined,meta:data.meta??undefined,hash:chapaHash(JSON.stringify(raw))};
}
export type ChapaLegacyRecoveryTransport=ChapaTransport&{protocol:'v1-recovery'};
export function createLegacyChapaRecoveryTransport(options:{env?:Environment;fetcher?:typeof fetch}={}):ChapaLegacyRecoveryTransport{
 const raw=options.env??process.env;
 return {protocol:'v1-recovery',create:async()=>{throw new ChapaError(410,'LEGACY_CREATION_DISABLED','New payments use Chapa v2.')},methods:async()=>{throw new ChapaError(410,'LEGACY_CREATION_DISABLED','New payments use Chapa v2.')},lookup:async merchantReference=>{
  requireRecovery(raw);if(!reference.safeParse(merchantReference).success)throw new ChapaError(422,'INVALID_PAYMENT','Invalid payment reference.');
  let response:Response;try{response=await (options.fetcher??fetch)(`${apiOrigin(raw)}/v1/transaction/verify/${encodeURIComponent(merchantReference)}`,{method:'GET',headers:{Authorization:`Bearer ${raw.CHAPA_V1_SECRET_KEY!}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})}catch{throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this original payment again.')}
  const reader=response.body?.getReader();if(!reader)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this original payment again.');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>65536){await reader.cancel();throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this original payment again.')}chunks.push(part.value)}}finally{reader.releaseLock()}
  if(!response.ok)throw new ChapaProviderError(response.status,response.status===404?'NOT_FOUND':response.status===401?'UNAUTHORIZED':response.status===403?'INVALID_VALUE':'HTTP_ERROR');
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check this original payment again.')}
 }};
}
export const legacyChapaRecoveryTransport=createLegacyChapaRecoveryTransport();

type Order=Pick<ChapaCheckout,'id'|'mode'|'credentialFingerprint'|'requestHash'|'merchantReference'|'amountCents'|'currency'>;
export const legacyRecoveryAuthorizationAction='CHAPA_V1_CREDENTIAL_RECOVERY_AUTHORIZED';
export const legacyRecoveryAuthorizationKey=(binding:ChapaRecoveryBinding)=>`chapa:v1-credential-recovery:${binding.checkoutId}:${binding.toFingerprint}`;
export function legacyChapaRecoveryBindings(raw:Environment=process.env,now=Date.now()):ChapaRecoveryBinding[]{
 const value=raw.CHAPA_V1_RECOVERY_BINDINGS;if(!value||value.length>20000)return [];
 try{const parsed=z.array(chapaRecoveryBindingSchema).max(20).safeParse(JSON.parse(value));if(!parsed.success)return [];const health=chapaLegacyRecoveryAvailability(raw);if(!health.recoveryEnabled)return [];
 return parsed.data.filter(binding=>binding.mode===health.mode&&binding.toFingerprint===health.credentialFingerprint&&binding.fromFingerprint!==binding.toFingerprint&&Date.parse(binding.expiresAt)>now&&Date.parse(binding.expiresAt)<=now+86400000)}catch{return []}
}
export async function approvedLegacyRecoveryBinding(client:PrismaClient|Prisma.TransactionClient,order:Order,raw:Environment=process.env){
 const binding=legacyChapaRecoveryBindings(raw).find(value=>value.checkoutId===order.id&&value.mode===order.mode&&value.fromFingerprint===order.credentialFingerprint&&value.requestHash===order.requestHash&&value.merchantReference===order.merchantReference&&value.amountCents===order.amountCents.toString()&&value.currency===order.currency);if(!binding)return null;
 const audit=await client.adminAudit.findUnique({where:{operationKey:legacyRecoveryAuthorizationKey(binding)},select:{action:true,target:true,requestHash:true,details:true,createdAt:true}});
 if(!audit||audit.action!==legacyRecoveryAuthorizationAction||audit.target!==order.id||audit.requestHash!==recoveryBindingHash(binding)||audit.createdAt.getTime()+86400000<Date.parse(binding.expiresAt))return null;
 const stored=chapaRecoveryBindingSchema.safeParse((audit.details as {binding?:unknown})?.binding);return stored.success&&recoveryBindingHash(stored.data)===audit.requestHash?binding:null;
}
