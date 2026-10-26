'use client';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {createContext,useContext,useState} from 'react';
import NextLink from 'next/link';
import type {ComponentProps} from 'react';
const Identity=createContext('');
let active:{identity:string;client:QueryClient}|null=null;
export const navigation=new Map<string,string>(),positions=new Map<string,number>();
export function AdminLink({href,...props}:ComponentProps<typeof NextLink>){const restored=typeof href==='string'&&href.startsWith('/admin')&&!href.includes('?')?navigation.get(href)??href:href;return <NextLink href={restored} {...props}/>}
export function clearAdminCache(){active?.client.clear();active=null;navigation.clear();positions.clear()}
export function AdminQueryProvider({identity,children}:{identity:string;children:React.ReactNode}){
 const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:15000,gcTime:5*60000,retry:1,refetchOnWindowFocus:false}}}));
 if(typeof window!=='undefined'){if(active?.identity!==identity){active?.client.clear();navigation.clear();positions.clear()}active={identity,client}}
 return <Identity.Provider value={identity}><QueryClientProvider client={client}>{children}</QueryClientProvider></Identity.Provider>;
}
async function transport<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{const r=await fetch('/api/admin/'+path,{cache:'no-store',signal,...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok){if(r.status===401||d.code==='ADMIN_LOGIN_REQUIRED'){clearAdminCache();if(typeof window!=='undefined')window.location.replace('/admin/login')}throw Error(d.error??'This request could not be completed.')}return d}
const family=(path:string)=>path.startsWith('workspace/')?path.split('?')[0]:path.split(/[/?]/)[0];
export function refreshAdminPath(path:string){void active?.client.invalidateQueries({predicate:q=>String(q.queryKey[2]??'').split('?')[0]===path,refetchType:'none'})}
export function invalidateAdmin(action:string){if(!active)return;const groups=action==='content'?['content']:action==='save-policy'?['referrals','workspace/referrals','audit']:['category','product','media'].includes(action)?['categories','products','auctions','dashboard','workspace/media']:['invite','staff'].includes(action)?['team','audit']:['broadcast','broadcastStop','retry'].includes(action)?['notifications','jobs','dashboard','workspace/system']:['fulfillment','deliveryDone'].includes(action)?['fulfillment','results','dashboard']:['auctions','dashboard','results','wallets','payments','top-ups','reconciliation','analytics','audit','workspace/transactions','workspace/refunds','workspace/financials'];void active.client.invalidateQueries({predicate:q=>groups.includes(family(String(q.queryKey[2]??'')))})}
export async function adminRequest<T>(path:string,body?:unknown,_signal?:AbortSignal):Promise<T>{if(body!==undefined){const result=await transport<T>(path,body);invalidateAdmin((body as {action?:string})?.action??'mutation');return result}if(!active)throw Error('Staff workspace is not initialized. Sign in again.');return active.client.fetchQuery({queryKey:['admin',active.identity,path],queryFn:({signal})=>transport<T>(path,undefined,signal)})}
export function useAdminQuery<T>(path:string,options:{enabled?:boolean}={}){const identity=useContext(Identity);if(!identity)throw Error('Staff workspace is not initialized.');const q=useQuery({queryKey:['admin',identity,path],enabled:options.enabled,queryFn:({signal})=>transport<T>(path,undefined,signal)});return {data:q.data??null,error:q.error?.message??'',loading:q.isFetching,updated:q.dataUpdatedAt?new Date(q.dataUpdatedAt).toISOString():null,reload:()=>{void q.refetch({cancelRefetch:false})}}}
