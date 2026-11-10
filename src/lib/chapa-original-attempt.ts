import type {QueryClient} from '@tanstack/react-query';
import type {ChapaDirectIntent} from './bid-batch-client';

type TopUpIntent=Extract<ChapaDirectIntent,{purpose:'TOP_UP'}>;
export type ChapaOriginalAttempt={intent:TopUpIntent;orderId?:string};
const key=(identity:string,scope:string)=>['lowin-private',identity,'chapa-original-attempt',scope] as const;

/** A frozen command, not a fresh payment result. One holder per account/scope
 * survives sheet dismissal in this tab. The ordinary session cache drop clears
 * this private prefix on logout/account changes; nothing enters browser storage. */
export function readChapaOriginalAttempt(client:QueryClient,identity:string,scope:string){return client.getQueryData<ChapaOriginalAttempt>(key(identity,scope))??null}
export function retainChapaOriginalAttempt(client:QueryClient,identity:string,scope:string,intent:TopUpIntent,orderId?:string){
 const queryKey=key(identity,scope);
 client.getQueryCache().build(client,{queryKey,gcTime:Infinity});
 client.setQueryData<ChapaOriginalAttempt>(queryKey,{intent:Object.freeze({...intent}),...(orderId?{orderId}:{})});
}
export function clearChapaOriginalAttempt(client:QueryClient,identity:string,scope:string,expected:{intentKey?:string;orderId?:string}){
 const saved=readChapaOriginalAttempt(client,identity,scope);
 if(!saved||expected.intentKey&&saved.intent.key!==expected.intentKey||expected.orderId&&saved.orderId!==expected.orderId)return;
 client.removeQueries({queryKey:key(identity,scope),exact:true});
}
