'use client';
import {PageLoading} from '@/components/loading-spinner';

import { useEffect,useState } from 'react';
import { useTelegram } from './telegram-provider';
import { IdentityState } from './identity-state';
import {MiniPhrase} from './mini-locale';
export function usePrivateQuery<T>(url:string,{pollMs=0}:{pollMs?:number}={}) {
  const {status,me}=useTelegram(),userId=me?.user.id;
  const [result,setResult]=useState<{userId:string;url:string;data:T}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(status!=='authenticated'||!userId)return;
    const controller=new AbortController();setError('');setResult(old=>pollMs&&old?.userId===userId&&old.url===url?old:null);
    let inFlight=false;
    const refresh=()=>{if(inFlight||controller.signal.aborted)return;inFlight=true;
    fetch(url,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok){if(response.status===401||response.status===403)setResult(null);throw new Error(body.error??'Could not load this page.');}return body as T}).then(data=>{if(!controller.signal.aborted){setError('');setResult({userId,url,data})}}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Connection interrupted.')}).finally(()=>{inFlight=false});
    };refresh();const timer=pollMs?setInterval(()=>{if(document.visibilityState==='visible')refresh()},pollMs):null;
    return()=>{controller.abort();if(timer)clearInterval(timer)};
  },[url,status,userId,retry,pollMs]);
  return {data:status==='authenticated'&&result&&result.userId===userId&&result.url===url?result.data:null,error,status,reload:()=>setRetry(value=>value+1)};
}
export function PrivateState({query}:{query:{status:string;data:unknown;error:string;reload:()=>void}}) {
  if(query.status!=='authenticated')return <IdentityState/>;
  if(query.error)return <div className="notice-card" role="alert"><MiniPhrase en="Could not load this page. Please retry." am="ገጹን ማምጣት አልተቻለም። እንደገና ይሞክሩ።"/><button className="retry-action" onClick={query.reload}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>;
  if(!query.data)return <PageLoading/>;
  return null;
}
export function PersonalPagination({page,totalPages,setPage}:{page:number;totalPages:number;setPage:(page:number)=>void}) {
  return <nav className="pagination" aria-label="Your pages">{page>1&&<button onClick={()=>setPage(page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button>}{page<totalPages&&<button onClick={()=>setPage(page+1)}><MiniPhrase en="Next page" am="ቀጣይ ገጽ"/></button>}</nav>;
}
