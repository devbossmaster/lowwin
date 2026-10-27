'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import {usePathname} from 'next/navigation';
import { useTelegram } from './telegram-provider';
import { IdentityState } from './identity-state';
import {MiniPhrase} from './mini-locale';
import {CustomerLoading} from './loading-spinner';
import {customerLoadingCopy} from './customer-loading-copy';
import {loadPrivateJson,privateQueryKey,readPrivateQuery,subscribePrivateQueries} from './private-query-cache';
import styles from './private-query.module.css';
export function usePrivateQuery<T>(url:string,{pollMs=0,enabled=true,freshnessMs,language,keepPreviousData=false}:{pollMs?:number;enabled?:boolean;freshnessMs?:number;language?:string;keepPreviousData?:boolean}={}) {
  const {status,queryIdentity}=useTelegram();
  const key=privateQueryKey(url,language),request=JSON.stringify([queryIdentity,key]);
  const [feedback,setFeedback]=useState({request:'',error:'',fetching:false}),[retry,setRetry]=useState(0),[,setRevision]=useState(0);
  const previous=useRef<{identity:string;url:string;language?:string}|null>(null);
  const lastRetry=useRef(retry);
  useEffect(()=>{
    const forceRetry=retry>lastRetry.current;lastRetry.current=retry;
    setFeedback({request,error:'',fetching:false});
    if(!enabled||status!=='authenticated'||!queryIdentity)return;
    let active=true,sequence=0;
    const options={freshnessMs,language};
    const refresh=(force=false)=>{
      if(!force&&readPrivateQuery<T>(queryIdentity,url,options)?.fresh)return;
      const current=++sequence;setFeedback({request,error:'',fetching:true});
      void loadPrivateJson<T>(queryIdentity,url,{...options,force})
        .then(()=>{if(active&&current===sequence)setFeedback({request,error:'',fetching:false})})
        .catch(cause=>{if(active&&current===sequence&&cause instanceof Error&&cause.name!=='ObsoletePrivateQueryError')setFeedback({request,error:cause.message||'Connection interrupted.',fetching:false})})
        .finally(()=>{if(active&&current===sequence){setFeedback(value=>value.request===request?{...value,fetching:false}:value);setRevision(value=>value+1)}});
    };
    const unsubscribe=subscribePrivateQueries(event=>{
      if(!active||event.identity!==queryIdentity&&event.kind!=='session'&&event.kind!=='authorization')return;
      if(event.kind==='stored'&&event.keys&&!event.keys.includes(key))return;
      setRevision(value=>value+1);
      if(event.identity===queryIdentity&&event.kind==='mutation')refresh(true);
    });
    refresh(forceRetry);
    // Wallet changes also need to reach an open sheet or Wallet/Profile page
    // while Home's header is unmounted. Every reader shares the same request.
    const walletChanged=()=>refresh(true);
    if(url==='/api/wallet')window.addEventListener('lowin-wallet-updated',walletChanged);
    const visible=()=>{if(document.visibilityState==='visible')refresh()};
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('focus',visible);
    window.addEventListener('online',visible);
    const timer=pollMs?setInterval(()=>{if(document.visibilityState==='visible')refresh()},pollMs):null;
    return()=>{active=false;unsubscribe();window.removeEventListener('lowin-wallet-updated',walletChanged);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);if(timer)clearInterval(timer)};
  },[url,status,queryIdentity,retry,pollMs,enabled,freshnessMs,language,key,request]);
  const snapshot=enabled&&status==='authenticated'&&queryIdentity?readPrivateQuery<T>(queryIdentity,url,{freshnessMs,language}):null;
  useEffect(()=>{if(snapshot&&queryIdentity)previous.current={identity:queryIdentity,url,language};else if(status!=='authenticated')previous.current=null},[snapshot?.value,queryIdentity,url,language,status]);
  const prior=previous.current;
  const retained=keepPreviousData&&!snapshot&&enabled&&status==='authenticated'&&queryIdentity&&prior?.identity===queryIdentity&&prior.language===language&&prior.url.split('?',1)[0]===url.split('?',1)[0]?readPrivateQuery<T>(queryIdentity,prior.url,{freshnessMs,language}):null;
  const isPlaceholderData=!snapshot&&!!retained,data=snapshot?.value??retained?.value??null;
  const error=enabled&&feedback.request===request?feedback.error:'',fetching=enabled&&feedback.request===request&&feedback.fetching;
  const reload=useCallback(()=>setRetry(value=>value+1),[]);
  return {data,updatedAt:snapshot?.updatedAt??retained?.updatedAt??0,error,status:enabled?status:'disabled',fetching:fetching||isPlaceholderData&&!error,isPlaceholderData,reload};
}
type PrivateLoadingVariant='profile'|'alerts'|'favorites'|'bids'|'wins';
export function PrivateState({query,variant='profile'}:{query:{status:string;data:unknown;error:string;fetching?:boolean;reload:()=>void};variant?:PrivateLoadingVariant}) {
  if(query.status==='loading')return <PrivateQueryLoading variant={variant}/>;
  if(query.status!=='authenticated')return <IdentityState/>;
  if(query.error&&!query.data)return <div className="notice-card" role="alert"><MiniPhrase en="Could not load this page. Please retry." am="ገጹን ማምጣት አልተቻለም። እንደገና ይሞክሩ።"/><button className="retry-action" onClick={query.reload}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>;
  if(query.error&&query.data)return <p className={styles.warning} role="status"><MiniPhrase en="Showing saved details. Refresh failed." am="የተቀመጠው መረጃ ይታያል። ማደስ አልተሳካም።"/> <button className="retry-action" onClick={query.reload}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></p>;
  if(!query.data)return <PrivateQueryLoading variant={variant}/>;
  if(query.fetching)return <p className={styles.refreshing} role="status"><MiniPhrase en="Updating…" am="በማደስ ላይ…"/></p>;
  return null;
}
function PrivateQueryLoading({variant}:{variant:PrivateLoadingVariant}){
 const pathname=usePathname();
 const path=variant==='alerts'?'/profile/alerts':variant==='favorites'?'/profile/favorites':variant==='bids'?'/my-bids':variant==='wins'?'/winning-bids':pathname?.startsWith('/wallet')?'/wallet':pathname==='/payments'?'/payments':'/profile';
 return <CustomerLoading {...customerLoadingCopy(path)}/>;
}
export function PersonalPagination({page,totalPages,setPage}:{page:number;totalPages:number;setPage:(page:number)=>void}) {
  return <nav className="pagination" aria-label="Your pages">{page>1&&<button onClick={()=>setPage(page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button>}{page<totalPages&&<button onClick={()=>setPage(page+1)}><MiniPhrase en="Next page" am="ቀጣይ ገጽ"/></button>}</nav>;
}
