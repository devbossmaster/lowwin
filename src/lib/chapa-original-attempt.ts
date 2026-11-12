import type {QueryClient} from '@tanstack/react-query';
import type {BidBatchQuote,ChapaDirectIntent} from './bid-batch-client';
import {bidPaymentCanRetry} from './bid-payment-progress';
import {chapaConfirmed,type ChapaCheckoutView} from './chapa-client';

export type ChapaOriginalAttempt={intent:ChapaDirectIntent;orderId?:string;bidQuote?:BidBatchQuote};
const key=(identity:string,scope:string)=>['lowin-private',identity,'chapa-original-attempt',scope] as const;

/** A frozen command, not a fresh payment result. One holder per account/scope
 * survives sheet dismissal in this tab. The ordinary session cache drop clears
 * this private prefix on logout/account changes; nothing enters browser storage. */
export function readChapaOriginalAttempt(client:QueryClient,identity:string,scope:string){return client.getQueryData<ChapaOriginalAttempt>(key(identity,scope))??null}
export function retainChapaOriginalAttempt(client:QueryClient,identity:string,scope:string,intent:ChapaDirectIntent,orderId?:string,bidQuote?:BidBatchQuote){
 const queryKey=key(identity,scope);
 const previous=readChapaOriginalAttempt(client,identity,scope),quote=bidQuote??(previous?.intent.key===intent.key?previous.bidQuote:undefined);
 client.getQueryCache().build(client,{queryKey,gcTime:Infinity});
 client.setQueryData<ChapaOriginalAttempt>(queryKey,{intent:Object.freeze({...intent,...('numbers'in intent?{numbers:Object.freeze([...intent.numbers]) as unknown as string[]}:{})}),...(orderId?{orderId}:{}),...(quote?{bidQuote:structuredClone(quote)}:{})});
}
export function clearChapaOriginalAttempt(client:QueryClient,identity:string,scope:string,expected:{intentKey?:string;orderId?:string}){
 const saved=readChapaOriginalAttempt(client,identity,scope);
 if(!saved||expected.intentKey&&saved.intent.key!==expected.intentKey||expected.orderId&&saved.orderId!==expected.orderId)return;
 client.removeQueries({queryKey:key(identity,scope),exact:true});
}

/** Dismissal ends presentation, never a provider request. Release only a
 * matching original whose latest owned outcome safely permits a new entry. */
export function clearSettledChapaOriginalAttempt(client:QueryClient,identity:string,scope:string,order:ChapaCheckoutView|null,intentKey?:string){
 if(!order||!chapaConfirmed(order)&&!bidPaymentCanRetry(order))return false;
 const saved=readChapaOriginalAttempt(client,identity,scope);
 if(!saved||intentKey&&saved.intent.key!==intentKey||saved.orderId&&saved.orderId!==order.id||!saved.orderId&&!intentKey)return false;
 clearChapaOriginalAttempt(client,identity,scope,{intentKey:saved.intent.key,...(saved.orderId?{orderId:order.id}:{})});return true;
}
