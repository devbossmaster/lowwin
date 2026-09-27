'use client';
import { useEffect,useState } from 'react';
import { useTelegram } from './telegram-provider';
import { IdentityState } from './identity-state';
export function usePrivateQuery<T>(url:string) {
  const {status,me}=useTelegram(),userId=me?.user.id;
  const [result,setResult]=useState<{userId:string;url:string;data:T}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(status!=='authenticated'||!userId)return;
    const controller=new AbortController();setError('');setResult(null);
    fetch(url,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error??'Could not load this page.');return body as T}).then(data=>{if(!controller.signal.aborted)setResult({userId,url,data})}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Connection interrupted.')});
    return()=>controller.abort();
  },[url,status,userId,retry]);
  return {data:status==='authenticated'&&result&&result.userId===userId&&result.url===url?result.data:null,error,status,reload:()=>setRetry(value=>value+1)};
}
export function PrivateState({query}:{query:{status:string;data:unknown;error:string;reload:()=>void}}) {
  if(query.status!=='authenticated')return <IdentityState/>;
  if(query.error)return <div className="notice-card" role="alert">{query.error}<button className="retry-action" onClick={query.reload}>Retry</button></div>;
  if(!query.data)return <p className="inline-empty" role="status">Loading your account…</p>;
  return null;
}
export function PersonalPagination({page,totalPages,setPage}:{page:number;totalPages:number;setPage:(page:number)=>void}) {
  return <nav className="pagination" aria-label="Your pages">{page>1&&<button onClick={()=>setPage(page-1)}>Previous</button>}{page<totalPages&&<button onClick={()=>setPage(page+1)}>Next page</button>}</nav>;
}
