import type {QueryClient} from '@tanstack/react-query';
import type {ChapaDirectIntent} from './bid-batch-client';
const prefix=(identity:string)=>['lowin-private',identity,'payment-retry-draft'] as const;
/** Editable form data only, never payment evidence. Kept in this account's
 * existing memory cache, bounded in size and removed on logout/account change. */
export function retainPaymentRetryDraft(client:QueryClient,identity:string,id:string,intent:ChapaDirectIntent){
 const queryKey=[...prefix(identity),id];
 client.getQueryCache().build(client,{queryKey,gcTime:600000});
 client.setQueryData(queryKey,{...intent,...('numbers'in intent?{numbers:[...intent.numbers]}:{})});
 const entries=client.getQueryCache().findAll({queryKey:prefix(identity)}).sort((a,b)=>a.state.dataUpdatedAt-b.state.dataUpdatedAt);
 for(const entry of entries.slice(0,Math.max(0,entries.length-20)))client.removeQueries({queryKey:entry.queryKey,exact:true});
}
export function readPaymentRetryDraft(client:QueryClient,identity:string,id:string){
 const key=[...prefix(identity),id],state=client.getQueryState(key);
 return state&&Date.now()-state.dataUpdatedAt<600000?client.getQueryData<ChapaDirectIntent>(key)??null:null;
}
