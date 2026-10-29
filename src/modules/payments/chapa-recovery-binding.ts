import type {ChapaCheckout,Prisma,PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {chapaAvailability,chapaHash} from './chapa-provider';

const fingerprint=z.string().regex(/^[a-f0-9]{64}$/);
const schema=z.object({checkoutId:z.string().uuid(),mode:z.enum(['test','live']),fromFingerprint:fingerprint,toFingerprint:fingerprint,requestHash:fingerprint,merchantReference:z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),amountCents:z.string().regex(/^[1-9]\d{0,15}$/),currency:z.literal('ETB'),finalReference:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),expiresAt:z.iso.datetime({offset:true})}).strict();
export type ChapaRecoveryBinding=z.infer<typeof schema>;
type Environment=Record<string,string|undefined>;
type Order=Pick<ChapaCheckout,'id'|'mode'|'credentialFingerprint'|'requestHash'|'merchantReference'|'amountCents'|'currency'>;
export const recoveryAuthorizationAction='CHAPA_CREDENTIAL_RECOVERY_AUTHORIZED';
export function recoveryAuthorizationKey(binding:ChapaRecoveryBinding){return `chapa:credential-recovery:${binding.checkoutId}:${binding.toFingerprint}`}
export function recoveryBindingHash(binding:ChapaRecoveryBinding){return chapaHash(JSON.stringify(schema.parse(binding)))}

/** A short-lived, single-checkout operator authorization is not a replacement
 * credential. The original intent and its credential fingerprint stay immutable. */
export function chapaRecoveryBindings(raw:Environment=process.env,now=Date.now()):ChapaRecoveryBinding[]{
 const value=raw.CHAPA_RECOVERY_BINDINGS;if(!value||value.length>20000)return [];
 try{
  const parsed=z.array(schema).max(20).safeParse(JSON.parse(value));if(!parsed.success)return [];
  const health=chapaAvailability(raw);
  return parsed.data.filter(binding=>binding.mode===health.mode&&binding.toFingerprint===health.credentialFingerprint&&binding.fromFingerprint!==binding.toFingerprint&&Date.parse(binding.expiresAt)>now&&Date.parse(binding.expiresAt)<=now+86400000);
 }catch{return []}
}
export function matchingRecoveryBinding(order:Order,raw:Environment=process.env){
 return chapaRecoveryBindings(raw).find(binding=>binding.checkoutId===order.id&&binding.mode===order.mode&&binding.fromFingerprint===order.credentialFingerprint&&binding.requestHash===order.requestHash&&binding.merchantReference===order.merchantReference&&binding.amountCents===order.amountCents.toString()&&binding.currency===order.currency)??null;
}
export async function approvedRecoveryBinding(client:PrismaClient|Prisma.TransactionClient,order:Order,raw:Environment=process.env){
 const binding=matchingRecoveryBinding(order,raw);if(!binding)return null;
 const audit=await client.adminAudit.findUnique({where:{operationKey:recoveryAuthorizationKey(binding)},select:{action:true,target:true,requestHash:true,details:true,createdAt:true}});
 if(!audit||audit.action!==recoveryAuthorizationAction||audit.target!==order.id||audit.requestHash!==recoveryBindingHash(binding)||audit.createdAt.getTime()+86400000<Date.parse(binding.expiresAt))return null;
 const stored=schema.safeParse((audit.details as {binding?:unknown})?.binding);
 return stored.success&&recoveryBindingHash(stored.data)===audit.requestHash?binding:null;
}
