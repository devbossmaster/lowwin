'use client';
import {QueryClient,QueryClientProvider,useQuery,useQueryClient,type Query} from '@tanstack/react-query';
import {createContext,useContext,useState} from 'react';
import NextLink from 'next/link';
import {useRouter} from 'next/navigation';
import type {ComponentProps} from 'react';
import {AdminPrefetchBudget,adminMutationResources,adminResourceMatches,adminResourcePath,adminRouteResources} from '@/lib/admin-query-policy';
const Identity=createContext('');
const AllowedRoutes=createContext<readonly string[]>([]),prefetchBudget=new AdminPrefetchBudget();
type AdminSession={identity:string;client:QueryClient};
let active:AdminSession|null=null;
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
function requireCurrentSession(session:AdminSession){
 if(active?.identity!==session.identity||active.client!==session.client)throw Error('Your staff session changed. Reload this workspace.');
}
async function transport<T>(path:string,body:unknown,signal:AbortSignal|undefined,session:AdminSession):Promise<T>{
 const response=await fetch('/api/admin/'+path,{cache:'no-store',signal,...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>null);
 requireCurrentSession(session);
 signal?.throwIfAborted();
 if(!response.ok){
  if(response.status===401||result?.code==='ADMIN_LOGIN_REQUIRED'){
   clearAdminCache();
   if(typeof window!=='undefined')window.location.replace('/admin');
  }
  const reference=typeof result?.traceId==='string'&&/^[0-9a-f-]{36}$/i.test(result.traceId)?` Reference: ${result.traceId}`:'';
  const message=typeof result?.error==='string'?result.error:response.status===403?'Your staff account does not have access to this action.':'This request could not be completed. Try again.';
  throw Error(message+reference);
 }
 if(result===null)throw Error('The server response could not be read. Try again.');
 return result;
}
export function refreshAdminPath(path:string){void active?.client.invalidateQueries({predicate:q=>String(q.queryKey[2]??'').split('?')[0]===path,refetchType:'none'})}
function sessionResources(identity:string,matches:(path:string)=>boolean){
 return (query:Query)=>query.queryKey[0]==='admin'&&query.queryKey[1]===identity&&matches(String(query.queryKey[2]??''));
}
type AuctionReceiptData={id:string;controlVersion:number;homeOrder?:number|null;featured?:boolean;feeRevisions?:{version:number;feePoints:string;effectiveAt:string}[]};
function applyReceipt({client,identity}:AdminSession,action:string,input:Record<string,unknown>|undefined,result:unknown){
 if(!result||typeof result!=='object')return;
 const receipt=result as Record<string,unknown>;
 if(action==='suspend'&&receipt.userId===input?.userId&&typeof receipt.suspended==='boolean')client.setQueriesData({predicate:sessionResources(identity,path=>['workspace/players','users'].some(scope=>adminResourceMatches(path,scope)))},(old:any)=>!old?old:Array.isArray(old.items)?{...old,items:old.items.map((row:any)=>row.id===receipt.userId?{...row,suspended:receipt.suspended}:row)}:old.id===receipt.userId?{...old,suspended:receipt.suspended}:old);
 if(action==='deliveryDone'&&receipt.auctionId===input?.auctionId&&typeof receipt.state==='string')client.setQueriesData({predicate:sessionResources(identity,path=>adminResourceMatches(path,'workspace/winners'))},(old:any)=>old&&Array.isArray(old.items)?{...old,items:old.items.map((row:any)=>row.auctionId===receipt.auctionId?{...row,state:receipt.state,version:receipt.version,...(typeof receipt.deliveredAt==='string'?{deliveredAt:receipt.deliveredAt}:{})}:row)}:old);
 if((action==='homeOrder'||action==='publish')&&receipt.auctionId===input?.auctionId&&Array.isArray(receipt.movedAuctions)){
  for(const moved of receipt.movedAuctions as unknown[]){
   if(!moved||typeof moved!=='object')continue;
   const {auctionId,homeOrder,controlVersion}=moved as Record<string,unknown>;
   if(typeof auctionId!=='string'||typeof homeOrder!=='number'||typeof controlVersion!=='number')continue;
   const resource='auctions/'+encodeURIComponent(auctionId);
   client.setQueriesData<AuctionReceiptData>({predicate:sessionResources(identity,path=>path.split('?')[0]===resource)},old=>{
    if(!old||old.id!==auctionId||old.controlVersion+1!==controlVersion)return old;
    return {...old,homeOrder,controlVersion};
   });
  }
 }
 const {auctionId,controlVersion,startsAt,endsAt,presentation,homeOrder,featured,feeVersion,feePoints,effectiveAt}=receipt;
 if(typeof auctionId!=='string'||auctionId!==input?.auctionId||typeof controlVersion!=='number')return;
 const changes=action==='deadline'&&typeof endsAt==='string'?{endsAt,nextCloseAttemptAt:null,closeErrorCode:null}
  :action==='startTime'&&typeof startsAt==='string'?{startsAt}
  :action==='presentation'&&presentation&&typeof presentation==='object'?{presentation}
  :action==='homeOrder'&&(typeof homeOrder==='number'||homeOrder===null)?{homeOrder,...(typeof featured==='boolean'?{featured}:{})}:null;
 const fee=action==='fee'&&typeof feeVersion==='number'&&typeof feePoints==='string'&&typeof effectiveAt==='string'
  ?{version:feeVersion,feePoints,effectiveAt}:null;
 if(!changes&&!fee)return;
 const resource='auctions/'+encodeURIComponent(auctionId);
 const submittedVersion=input?.version;
 client.setQueriesData<AuctionReceiptData>({predicate:sessionResources(identity,path=>path.split('?')[0]===resource)},old=>{
  // Applying an action to an older projection with a gap would hide changes
  // made by another staff session. The background refresh handles that case.
  if(old?.id!==auctionId||old.controlVersion!==submittedVersion||controlVersion!==old.controlVersion+1)return old;
  if(fee)return {...old,controlVersion,feeRevisions:[fee,...(old.feeRevisions??[])]};
  return {...old,...changes,controlVersion};
 });
}
export async function prefetchAdminResource(path:string){if(!active)return;const session=active,{client,identity}=session,resource=adminResourcePath(path);try{await client.prefetchQuery({queryKey:['admin',identity,resource],queryFn:({signal})=>transport(resource,undefined,signal,session)})}catch{/* Intent warming must never obstruct navigation. */}}
export async function adminRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 if(!active)throw Error('Staff workspace is not initialized. Sign in again.');
 const session=active,{client,identity}=session,resource=adminResourcePath(path);
 if(body===undefined){
  const result=await client.fetchQuery({queryKey:['admin',identity,resource],queryFn:({signal})=>transport<T>(resource,undefined,signal,session)});
  requireCurrentSession(session);
  return result;
 }
 const result=await transport<T>(resource,body,signal,session);
 const {action='',input}=body as {action?:string;input?:Record<string,unknown>};
 const groups=adminMutationResources(action,resource);
 if(groups.length){
  const predicate=sessionResources(identity,path=>groups.some(scope=>adminResourceMatches(path,scope)));
  // Even inactive prefetched reads can return a snapshot captured before the mutation.
  await client.cancelQueries({predicate});
  requireCurrentSession(session);
  applyReceipt(session,action,input,result);
  void client.invalidateQueries({predicate},{cancelRefetch:false});
 }
 return result;
}
export function useAdminQuery<T>(path:string,options:{enabled?:boolean}={}){
 const identity=useContext(Identity),client=useQueryClient(),resource=adminResourcePath(path);
 if(!identity)throw Error('Staff workspace is not initialized.');
 const q=useQuery({queryKey:['admin',identity,resource],enabled:options.enabled,queryFn:({signal})=>transport<T>(resource,undefined,signal,{identity,client})});
 return {data:q.data??null,error:q.error?.message??'',loading:q.isPending&&q.isFetching,fetching:q.isFetching,refreshing:q.isFetching&&q.data!==undefined,updated:q.dataUpdatedAt?new Date(q.dataUpdatedAt).toISOString():null,reload:()=>{void q.refetch({cancelRefetch:false})}};
}
