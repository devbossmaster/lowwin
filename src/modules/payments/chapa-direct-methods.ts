import {z} from 'zod';
import {ChapaError,chapaAvailability,chapaTransport,type ChapaTransport} from './chapa-provider';
export const directMethodOrder=['telebirr','mpesa','cbebirr'] as const;
const amount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schema=z.object({status:z.literal('success'),data:z.array(z.object({name:z.string().min(1).max(120),slug:z.string().regex(/^[a-z0-9_-]{1,80}$/),can_process_payments:z.boolean(),can_process_direct_charge:z.boolean(),supported_currencies:z.record(z.string(),z.object({default_min:amount.optional(),default_max:amount.optional(),countries:z.record(z.string(),z.object({is_enabled:z.boolean(),min_amount:amount.optional(),max_amount:amount.optional()}))}))})).max(100)});
export type DirectMethod={slug:string;name:string;minimumCents:string;maximumCents:string;minAmountCents:string;maxAmountCents:string};
export function parseDirectMethods(raw:unknown,allowEbirr=false):DirectMethod[]|null{const p=schema.safeParse(raw);if(!p.success)return null;const order:string[]=[...directMethodOrder,...(allowEbirr?['ebirr']:[])],result:DirectMethod[]=[];for(const slug of order){const m=p.data.data.find(item=>item.slug===slug);if(!m?.can_process_payments||!m.can_process_direct_charge)continue;const currency=m.supported_currencies.ETB,country=currency?.countries.ET,min=country?.min_amount??currency?.default_min,max=country?.max_amount??currency?.default_max;if(!country?.is_enabled||min===undefined||max===undefined||max<Math.max(100,min))continue;result.push({slug:m.slug,name:m.name,minimumCents:String(Math.max(100,min)),maximumCents:String(max),minAmountCents:String(Math.max(100,min)),maxAmountCents:String(max)})}return result}
export function createDirectMethodCatalog(transport:ChapaTransport=chapaTransport){
 type Pending={key:string;promise:Promise<DirectMethod[]>};
 let cached:{key:string;until:number;methods:DirectMethod[]}|null=null,pending:Pending|null=null;
 const configuration=()=>{const health=chapaAvailability(),allowEbirr=process.env.CHAPA_DIRECT_EBIRR_ENABLED==='true';return {enabled:health.enabled,allowEbirr,key:`${health.mode}:${health.credentialFingerprint}:${allowEbirr}`}};
 const stillCurrent=(key:string)=>{const current=configuration();if(!current.enabled||current.key!==key)throw new ChapaError(503,'CONFIGURATION_CHANGED','Payment configuration changed. Reload payment methods before paying.')};
 return {async get(amountCents?:bigint){
  const config=configuration();if(!config.enabled)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Online payments are unavailable.');
  let methods:DirectMethod[];
  if(cached?.key===config.key&&cached.until>Date.now())methods=cached.methods;
  else{
   if(!pending||pending.key!==config.key){
    let request:Pending;
    const promise=transport.methods().then(raw=>{
     // Parse against the initiating snapshot. A rotated key/environment or a
     // changed opt-in must not authorize capabilities from the earlier read.
     const found=parseDirectMethods(raw,config.allowEbirr);if(!found)throw new ChapaError(503,'METHODS_UNAVAILABLE','Payment methods could not be confirmed. Try again.');
     stillCurrent(config.key);
     // An old A request can finish after A -> B -> A created a newer request.
     // Only the current promise may populate the cache or release its flight.
     if(pending===request)cached={key:config.key,until:Date.now()+300000,methods:found};
     return found;
    }).finally(()=>{if(pending===request)pending=null});
    request={key:config.key,promise};pending=request;
   }
   methods=await pending.promise;stillCurrent(config.key);
  }
  return methods.filter(m=>amountCents===undefined||amountCents>=BigInt(m.minimumCents)&&amountCents<=BigInt(m.maximumCents));
 }};
}
export const directMethodCatalog=createDirectMethodCatalog();
