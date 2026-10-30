import {chapaUuid,type ChapaCheckoutView} from './chapa-client';
import {chapaOriginPath} from './chapa-return-link';
import {isPrivateQueryIdentity,loadPrivateJson,ObsoletePrivateQueryError} from '@/components/private-query-cache';

/** Resolve an opaque launch directly to its original surface using owned data.
 * The shared session cache also supplies the destination modal's initial read.
 * A return link or cached response never applies credit; the modal reconciles it.
 */
export async function resolveChapaReturn(identity:string,id:string){
 if(!chapaUuid.test(id)||!isPrivateQueryIdentity(identity))throw new ObsoletePrivateQueryError();
 const order=await loadPrivateJson<ChapaCheckoutView>(identity,`/api/payments/chapa/checkouts/${id.toLowerCase()}`,{freshnessMs:5000});
 if(!isPrivateQueryIdentity(identity))throw new ObsoletePrivateQueryError();
 if(order.id.toLowerCase()!==id.toLowerCase())throw Error('Payment not found.');
 const destination=chapaOriginPath(order);
 if(!destination)throw Error('Payment not found.');
 return destination;
}
