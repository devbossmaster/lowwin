import type {QueryClient} from '@tanstack/react-query';
import type {BidBatchQuote} from './bid-batch-client';
import type {ChapaAttempt} from './chapa-client';

export type HostedChapaAttempt={attempt:ChapaAttempt;bidQuote?:BidBatchQuote};
const key=(identity:string,scope:string)=>['lowin-private',identity,'chapa-hosted-attempt',scope] as const;

/** Keep an interrupted hosted command in this account's in-memory cache.
 * A dismissed sheet must never mint a replacement payment for a lost reply. */
export function readHostedChapaAttempt(client:QueryClient,identity:string,scope:string){return client.getQueryData<HostedChapaAttempt>(key(identity,scope))??null}
export function retainHostedChapaAttempt(client:QueryClient,identity:string,scope:string,attempt:ChapaAttempt,bidQuote?:BidBatchQuote){
 const queryKey=key(identity,scope),previous=readHostedChapaAttempt(client,identity,scope);
 const quote=bidQuote??(previous?.attempt.intent.key===attempt.intent.key?previous.bidQuote:undefined);
 client.getQueryCache().build(client,{queryKey,gcTime:Infinity});
 client.setQueryData<HostedChapaAttempt>(queryKey,{attempt:{...attempt,intent:Object.freeze({...attempt.intent})},...(quote?{bidQuote:structuredClone(quote)}:{})});
}
export function clearHostedChapaAttempt(client:QueryClient,identity:string,scope:string,expected:{intentKey?:string;orderId?:string}){
 const saved=readHostedChapaAttempt(client,identity,scope);
 if(!saved||expected.intentKey&&saved.attempt.intent.key!==expected.intentKey||expected.orderId&&saved.attempt.orderId!==expected.orderId)return;
 client.removeQueries({queryKey:key(identity,scope),exact:true});
}
