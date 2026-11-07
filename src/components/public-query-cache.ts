'use client';
import {getMiniQueryClient,privateQueryKey} from './private-query-cache';
import {miniQueryPolicy} from './mini-query-policy';
import {isPublicMiniRead} from '@/lib/mini-public-routes';

export function publicQueryKey(url:string,language?:string){
 if(!url.startsWith('/api/')||url.startsWith('//'))throw Error('This resource is not public.');
 const normalized=privateQueryKey(url,language),at=normalized.indexOf('?');
 const parsed=new URL(url,'https://lowwin.invalid'),pathname=parsed.pathname;
 if(!isPublicMiniRead(pathname)||pathname.endsWith('/breakdown')&&parsed.searchParams.has('amount'))throw Error('This resource is not public.');
 return ['lowin-public',at<0?normalized:normalized.slice(0,at),at<0?'':normalized.slice(at+1)] as const;
}
export function readPublicQuery<T>(url:string,options:{language?:string;freshnessMs?:number}={}){
 const client=getMiniQueryClient(),key=publicQueryKey(url,options.language),saved=client.getQueryState<T>(key);
 if(saved?.data===undefined||Date.now()-saved.dataUpdatedAt>=miniQueryPolicy(url).retainMs)return null;
 return {value:saved.data,updatedAt:saved.dataUpdatedAt,fresh:!saved.isInvalidated&&Date.now()-saved.dataUpdatedAt<(options.freshnessMs??miniQueryPolicy(url).staleMs)};
}
export function seedPublicQuery<T>(url:string,value:T,updatedAt=Date.now()){
 const client=getMiniQueryClient(),key=publicQueryKey(url),saved=client.getQueryState(key);
 if(!saved||saved.dataUpdatedAt<=updatedAt)client.setQueryData(key,value,{updatedAt});
}
export async function loadPublicJson<T>(url:string,{signal}: {signal?:AbortSignal}={}){
 publicQueryKey(url);
 // These public display responses are separate from identity-scoped financial
 // reads. Do not promote their HTTP response to a shared CDN cache here.
 const response=await fetch(url,{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Could not load this page. Please retry.');
 return body as T;
}
const intent=new Map<string,number>();
export async function prefetchPublicQuery(url:string){
 const client=getMiniQueryClient(),now=Date.now();
 if(client.isFetching()>=4||now-(intent.get(url)??0)<5000)return;
 intent.set(url,now);if(intent.size>32)intent.delete(intent.keys().next().value!);
 const policy=miniQueryPolicy(url);
 await client.prefetchQuery({queryKey:publicQueryKey(url),queryFn:({signal})=>loadPublicJson(url,{signal}),staleTime:policy.staleMs,gcTime:policy.retainMs});
}
