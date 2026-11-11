import type {QueryClient} from '@tanstack/react-query';
export type BidFundingDraft={numbers:string[];method:string;phone:string;applyCoupon:boolean};
const key=(identity:string,slug:string)=>['lowin-private',identity,'bid-funding-draft',slug] as const;
/** Editable account-scoped draft only. Never a quote, debit or payment outcome. */
export function readBidFundingDraft(client:QueryClient,identity:string,slug:string){return client.getQueryData<BidFundingDraft>(key(identity,slug))??null}
export function retainBidFundingDraft(client:QueryClient,identity:string,slug:string,draft:BidFundingDraft){
 const queryKey=key(identity,slug);client.getQueryCache().build(client,{queryKey,gcTime:Infinity});client.setQueryData(queryKey,{...draft,numbers:[...draft.numbers]});
 const entries=client.getQueryCache().findAll({queryKey:['lowin-private',identity,'bid-funding-draft']}).sort((a,b)=>a.state.dataUpdatedAt-b.state.dataUpdatedAt);
 for(const entry of entries.slice(0,Math.max(0,entries.length-10)))client.removeQueries({queryKey:entry.queryKey,exact:true});
}
export function clearBidFundingDraft(client:QueryClient,identity:string,slug:string){client.removeQueries({queryKey:key(identity,slug),exact:true})}
