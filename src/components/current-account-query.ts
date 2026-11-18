'use client';
import type {QueryClient} from '@tanstack/react-query';
import {CURRENT_ACCOUNT_PATH,CURRENT_ACCOUNT_QUERY_KEY,CURRENT_ACCOUNT_STALE_MS} from '@/lib/current-account';
import {MINI_AUTH_TIMEOUT_MS,type MiniAccount} from '@/lib/mini-auth-client';

export async function fetchCurrentAccount({signal}:{signal:AbortSignal}):Promise<MiniAccount|null>{
 const response=await fetch(CURRENT_ACCOUNT_PATH,{
  cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(MINI_AUTH_TIMEOUT_MS)]),
 });
 if(response.status===401||response.status===403)return null;
 if(!response.ok)throw Error('Your account could not be loaded. Please retry.');
 const account=await response.json() as MiniAccount;
 if(typeof account?.user?.id!=='string'||!account.user.id||typeof account.user.name!=='string')throw Error('Your account could not be loaded. Please retry.');
 return account;
}

export function loadCurrentAccount(client:QueryClient,force=false){
 if(force&&client.getQueryState(CURRENT_ACCOUNT_QUERY_KEY)?.fetchStatus!=='fetching'){
  void client.invalidateQueries({queryKey:CURRENT_ACCOUNT_QUERY_KEY,exact:true,refetchType:'none'});
 }
 return client.fetchQuery({queryKey:CURRENT_ACCOUNT_QUERY_KEY,queryFn:fetchCurrentAccount,staleTime:CURRENT_ACCOUNT_STALE_MS,retry:false});
}

export function clearCurrentAccount(client:QueryClient){
 const filter={queryKey:CURRENT_ACCOUNT_QUERY_KEY,exact:true};
 void client.cancelQueries(filter);
 client.removeQueries(filter);
}
