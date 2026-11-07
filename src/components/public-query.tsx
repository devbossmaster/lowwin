'use client';
import {keepPreviousData as previousData,useQuery,useQueryClient} from '@tanstack/react-query';
import {useCallback,useEffect} from 'react';
import {loadPublicJson,publicQueryKey} from './public-query-cache';
import {subscribePrivateQueries} from './private-query-cache';
import {miniQueryPolicy} from './mini-query-policy';

/** Public catalog snapshots survive registration; no account response may use
 * this hook. The allowlist is also enforced in publicQueryKey. */
export function usePublicQuery<T>(url:string,{pollMs=0,enabled=true,freshnessMs,language,keepPreviousData=false,initialData,initialUpdatedAt,cancelOnUnmount=false}:{pollMs?:number;enabled?:boolean;freshnessMs?:number;language?:string;keepPreviousData?:boolean;initialData?:T;initialUpdatedAt?:number;cancelOnUnmount?:boolean}={}){
 const client=useQueryClient(),policy=miniQueryPolicy(url),key=publicQueryKey(url,language);
 const query=useQuery<T>({queryKey:key,queryFn:({signal})=>loadPublicJson<T>(url,{signal}),enabled,initialData,initialDataUpdatedAt:initialUpdatedAt,staleTime:freshnessMs??policy.staleMs,gcTime:policy.retainMs,retry:false,refetchInterval:pollMs||false,refetchIntervalInBackground:false,refetchOnWindowFocus:policy.refreshOnResume?'always':true,placeholderData:keepPreviousData?previousData:undefined});
 useEffect(()=>subscribePrivateQueries(event=>{
  if(event.kind!=='mutation')return;
  if(event.keys&&!event.keys.some(scope=>url.startsWith(scope)||scope.startsWith('/api/auctions')&&url.startsWith('/api/catalog/auctions')))return;
  void client.invalidateQueries({queryKey:key,exact:true});
 }),[client,url,JSON.stringify(key)]);
 // TanStack cancels consumed signals when the final observer leaves; an open
 // sibling reader retains and deduplicates the same query.
 void cancelOnUnmount;
 const reload=useCallback(()=>{void query.refetch()},[query.refetch]);
 return {data:query.data??null,updatedAt:query.dataUpdatedAt,error:query.error?.message??'',status:enabled?'authenticated':'disabled',fetching:query.isFetching,isPlaceholderData:query.isPlaceholderData,reload};
}
