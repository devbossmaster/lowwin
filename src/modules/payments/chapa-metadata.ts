import type {Prisma} from '@prisma/client';

/** Metadata is optional supplementary evidence. Only the immutable historical
 * initialization defines expected metadata; the minimal hosted body sends none. */
export function matchesChapaMetadata(initialization:Prisma.JsonValue,returned:Record<string,unknown>|undefined,checkoutId:string){
 if(returned&&Object.hasOwn(returned,'lowwin_attempt')&&returned.lowwin_attempt!==checkoutId)return false;
 const sent=initialization&&typeof initialization==='object'&&!Array.isArray(initialization)?initialization.meta:undefined;
 if(!sent||typeof sent!=='object'||Array.isArray(sent))return true;
 // Do not require an optional field omitted by verification. If returned, keep
 // every metadata expectation actually supplied by historical initialization.
 if(!returned)return true;
 return Object.entries(sent).every(([key,value])=>returned[key]===value);
}
