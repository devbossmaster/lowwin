'use client';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {createContext,useContext,useState} from 'react';
import NextLink from 'next/link';
import {useRouter} from 'next/navigation';
import type {ComponentProps} from 'react';
import {AdminPrefetchBudget,adminMutationResources,adminResourceMatches,adminResourcePath,adminRouteResources} from '@/lib/admin-query-policy';
const Identity=createContext('');
const AllowedRoutes=createContext<readonly string[]>([]),prefetchBudget=new AdminPrefetchBudget();
let active:{identity:string;client:QueryClient}|null=null;
export const navigation=new Map<string,string>(),positions=new Map<string,number>();
export function AdminLink({href,onPointerEnter,onFocus,onTouchStart,scroll,...props}:ComponentProps<typeof NextLink>){
 const allowed=useContext(AllowedRoutes),identity=useContext(Identity),router=useRouter();
 const restored=typeof href==='string'&&href.startsWith('/admin')&&!href.includes('?')?navigation.get(href)??href:href;
 const warm=()=>{if(typeof restored!=='string'||!active||active.identity!==identity)return;let url:URL;try{url=new URL(restored,'https://admin.lowwin.invalid')}catch{return}if(url.origin!=='https://admin.lowwin.invalid'||!allowed.includes(url.pathname)||!prefetchBudget.allow(identity,restored))return;router.prefetch(restored);for(const resource of adminRouteResources(restored))void prefetchAdminResource(resource)};
 return <NextLink prefetch={false} href={restored} scroll={scroll??!(typeof restored==='string'&&positions.has(restored))} onPointerEnter={event=>{onPointerEnter?.(event);warm()}} onFocus={event=>{onFocus?.(event);warm()}} onTouchStart={event=>{onTouchStart?.(event);warm()}} {...props}/>;
}
export function clearAdminCache(){active?.client.clear();active=null;navigation.clear();positions.clear();prefetchBudget.reset()}
export function AdminQueryProvider({identity,allowedRoutes=[],children}:{identity:string;allowedRoutes?:readonly string[];children:React.ReactNode}){
 const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:15000,gcTime:5*60000,retry:false,refetchOnWindowFocus:false}}}));
 if(typeof window!=='undefined'){if(active?.identity!==identity){active?.client.clear();navigation.clear();positions.clear();prefetchBudget.reset()}active={identity,client}}
 return <Identity.Provider value={identity}><AllowedRoutes.Provider value={allowedRoutes}><QueryClientProvider client={client}>{children}</QueryClientProvider></AllowedRoutes.Provider></Identity.Provider>;
}
async function transport<T>(path:string,body:unknown,signal:AbortSignal|undefined,identity:string):Promise<T>{const r=await fetch('/api/admin/'+path,{cache:'no-store',signal,...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(active?.identity!==identity)throw Error('Your staff session changed. Reload this workspace.');if(!r.ok){if(r.status===401||r.status===403||d.code==='ADMIN_LOGIN_REQUIRED'){clearAdminCache();if(typeof window!=='undefined')window.location.replace(r.status===403?'/admin':'/admin/login')}throw Error(d.error??'This request could not be completed.')}return d}
export function refreshAdminPath(path:string){void active?.client.invalidateQueries({predicate:q=>String(q.queryKey[2]??'').split('?')[0]===path,refetchType:'none'})}
export function invalidateAdmin(action:string,endpoint='command'){if(!active)return;const {client,identity}=active,groups=adminMutationResources(action,endpoint);void client.invalidateQueries({predicate:q=>q.queryKey[0]==='admin'&&q.queryKey[1]===identity&&groups.some(scope=>adminResourceMatches(String(q.queryKey[2]??''),scope))})}
function applyReceipt(action:string,input:Record<string,unknown>|undefined,result:unknown){
 if(!active||!result||typeof result!=='object')return;const receipt=result as Record<string,unknown>,identity=active.identity;
 if(action==='suspend'&&receipt.userId===input?.userId&&typeof receipt.suspended==='boolean')active.client.setQueriesData({predicate:q=>q.queryKey[0]==='admin'&&q.queryKey[1]===identity&&['workspace/players','users'].some(scope=>adminResourceMatches(String(q.queryKey[2]??''),scope))},(old:any)=>!old?old:Array.isArray(old.items)?{...old,items:old.items.map((row:any)=>row.id===receipt.userId?{...row,suspended:receipt.suspended}:row)}:old.id===receipt.userId?{...old,suspended:receipt.suspended}:old);
 if(action==='deliveryDone'&&receipt.auctionId===input?.auctionId&&typeof receipt.state==='string')active.client.setQueriesData({predicate:q=>q.queryKey[0]==='admin'&&q.queryKey[1]===identity&&adminResourceMatches(String(q.queryKey[2]??''),'workspace/winners')},(old:any)=>old&&Array.isArray(old.items)?{...old,items:old.items.map((row:any)=>row.auctionId===receipt.auctionId?{...row,state:receipt.state,version:receipt.version}:row)}:old);
}
export async function prefetchAdminResource(path:string){if(!active)return;const {client,identity}=active,resource=adminResourcePath(path);try{await client.prefetchQuery({queryKey:['admin',identity,resource],queryFn:({signal})=>transport(resource,undefined,signal,identity)})}catch{/* Intent warming must never obstruct navigation. */}}
export async function adminRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{if(!active)throw Error('Staff workspace is not initialized. Sign in again.');const {client,identity}=active,resource=adminResourcePath(path);if(body!==undefined){const result=await transport<T>(resource,body,signal,identity);if(active?.identity!==identity)throw Error('Your staff session changed. Reload this workspace.');const request=body as {action?:string;input?:Record<string,unknown>};applyReceipt(request.action??'',request.input,result);invalidateAdmin(request.action??'mutation',resource);return result}const result=await client.fetchQuery({queryKey:['admin',identity,resource],queryFn:({signal})=>transport<T>(resource,undefined,signal,identity)});if(active?.identity!==identity)throw Error('Your staff session changed. Reload this workspace.');return result}
export function useAdminQuery<T>(path:string,options:{enabled?:boolean}={}){const identity=useContext(Identity),resource=adminResourcePath(path);if(!identity)throw Error('Staff workspace is not initialized.');const q=useQuery({queryKey:['admin',identity,resource],enabled:options.enabled,queryFn:({signal})=>transport<T>(resource,undefined,signal,identity)});return {data:q.data??null,error:q.error?.message??'',loading:q.isPending&&q.isFetching,fetching:q.isFetching,refreshing:q.isFetching&&q.data!==undefined,updated:q.dataUpdatedAt?new Date(q.dataUpdatedAt).toISOString():null,reload:()=>{void q.refetch({cancelRefetch:false})}}}
