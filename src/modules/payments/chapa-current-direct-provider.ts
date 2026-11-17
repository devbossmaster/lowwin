import {ChapaError,chapaAvailability,chapaTransport,createChapaTransport,type ChapaTransport} from './chapa-provider';
import {createDirectMethodCatalog,directMethodCatalog} from './chapa-direct-methods';
import type {ChapaInlineTransport} from './chapa-inline-provider';
import {isCurrentDirectCheckout} from './chapa-current-protocol';

export function currentDirectAvailability(raw:Record<string,string|undefined>=process.env){
 const health=chapaAvailability(raw),privateKeyIsPublic=/^CHAPA_(?:LIVE|TEST)_PUB_/.test(raw.CHAPA_PRIVATE_KEY??'');
 return {...health,configured:health.configured&&!privateKeyIsPublic,enabled:health.enabled&&!privateKeyIsPublic,recoveryEnabled:health.recoveryEnabled&&!privateKeyIsPublic,publicKeyFingerprint:null};
}
export function requireCurrentDirect(operation:'create'|'recover'='create'){
 const health=currentDirectAvailability();if(!(operation==='create'?health.enabled:health.recoveryEnabled))throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Secure payments are not configured. Existing payments remain recorded.');return health;
}
export function currentDirectBinding(order:{flowVersion?:number;initialization:unknown;mode:string;credentialFingerprint:string}){
 const health=currentDirectAvailability();return isCurrentDirectCheckout(order)&&health.configured&&order.mode===health.mode&&order.credentialFingerprint===health.credentialFingerprint;
}
/** Adapter into the shared immutable checkout engine. Only this explicit
 * Direct5 engine adapter may translate its initialization method to Direct. */
export function currentDirectEngineTransport(transport:ChapaTransport=chapaTransport):ChapaInlineTransport{
 return {...transport,inline:async(input,operation='create')=>{if(!transport.direct)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Direct payment initialization is unavailable.');return transport.direct(input,operation)}};
}
export const currentDirectTransport=currentDirectEngineTransport();
export function currentDirectMethods(transport:ChapaTransport=chapaTransport){return transport===chapaTransport?directMethodCatalog:createDirectMethodCatalog(transport)}
export function createCurrentDirectTransport(options:Parameters<typeof createChapaTransport>[0]={}){return createChapaTransport(options)}
