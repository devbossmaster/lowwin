/** New private-key Direct intents have their own immutable protocol version.
 * Historical Direct2 and public-key Inline4 keep their original recovery. */
type Protocol={flowVersion?:number;initialization:unknown};
export function isCurrentDirectCheckout(order:Protocol){
 const init=order.initialization as Record<string,unknown>|null;
 return order.flowVersion===5&&!!init&&init.apiVersion==='v2'&&init.flowVersion===5&&init.flow==='DIRECT';
}
export function isCurrentV2Checkout(order:Protocol){
 const init=order.initialization as Record<string,unknown>|null;
 return isCurrentDirectCheckout(order)||order.flowVersion===4&&!!init&&init.apiVersion==='v2'&&init.flowVersion===4&&['INLINE','HOSTED'].includes(String(init.flow));
}
