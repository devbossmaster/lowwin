'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useTelegram } from './telegram-provider';
import { IdentityState } from './identity-state';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {loadPrivateJson,readPrivateQuery,subscribePrivateQueries} from './private-query-cache';
import styles from './private-query.module.css';
export function usePrivateQuery<T>(url:string,{pollMs=0,enabled=true,freshnessMs,language}:{pollMs?:number;enabled?:boolean;freshnessMs?:number;language?:string}={}) {
  const {status,queryIdentity}=useTelegram();
  const [error,setError]=useState(''),[retry,setRetry]=useState(0),[fetching,setFetching]=useState(false),[,setRevision]=useState(0);
  const lastRetry=useRef(retry);
  useEffect(()=>{
    const forceRetry=retry>lastRetry.current;lastRetry.current=retry;
    setError('');setFetching(false);
    if(!enabled||status!=='authenticated'||!queryIdentity)return;
    let active=true;
    const options={freshnessMs,language};
    const refresh=(force=false)=>{
      if(!force&&readPrivateQuery<T>(queryIdentity,url,options)?.fresh)return;
      setFetching(true);
      void loadPrivateJson<T>(queryIdentity,url,{...options,force})
        .then(()=>{if(active)setError('')})
        .catch(cause=>{if(active&&cause instanceof Error&&cause.name!=='ObsoletePrivateQueryError')setError(cause.message||'Connection interrupted.')})
        .finally(()=>{if(active){setFetching(false);setRevision(value=>value+1)}});
    };
    const unsubscribe=subscribePrivateQueries(event=>{
      if(!active)return;
      setRevision(value=>value+1);
      if(event.identity===queryIdentity&&event.kind==='mutation')refresh(true);
    });
    refresh(forceRetry);
    const visible=()=>{if(document.visibilityState==='visible')refresh()};
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('focus',visible);
    window.addEventListener('online',visible);
    const timer=pollMs?setInterval(()=>{if(document.visibilityState==='visible')refresh()},pollMs):null;
    return()=>{active=false;unsubscribe();document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);window.removeEventListener('online',visible);if(timer)clearInterval(timer)};
  },[url,status,queryIdentity,retry,pollMs,enabled,freshnessMs,language]);
  const data=enabled&&status==='authenticated'&&queryIdentity?readPrivateQuery<T>(queryIdentity,url,{freshnessMs,language})?.value??null:null;
  const reload=useCallback(()=>setRetry(value=>value+1),[]);
  return {data,error:enabled?error:'',status:enabled?status:'disabled',fetching,reload};
}
type PrivateSkeletonVariant='profile'|'alerts'|'favorites'|'bids'|'wins';
export function PrivateState({query,variant='profile'}:{query:{status:string;data:unknown;error:string;fetching?:boolean;reload:()=>void};variant?:PrivateSkeletonVariant}) {
  if(query.status==='loading')return <PrivateQuerySkeleton variant={variant}/>;
  if(query.status!=='authenticated')return <IdentityState/>;
  if(query.error&&!query.data)return <div className="notice-card" role="alert"><MiniPhrase en="Could not load this page. Please retry." am="ገጹን ማምጣት አልተቻለም። እንደገና ይሞክሩ።"/><button className="retry-action" onClick={query.reload}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>;
  if(query.error&&query.data)return <p className={styles.warning} role="status"><MiniPhrase en="Showing saved details. Refresh failed." am="የተቀመጠው መረጃ ይታያል። ማደስ አልተሳካም።"/> <button className="retry-action" onClick={query.reload}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></p>;
  if(!query.data)return <PrivateQuerySkeleton variant={variant}/>;
  if(query.fetching)return <p className={styles.refreshing} role="status"><MiniPhrase en="Updating…" am="በማደስ ላይ…"/></p>;
  return null;
}
function PrivateQuerySkeleton({variant}:{variant:PrivateSkeletonVariant}){
  const label=variant==='alerts'?'notifications':variant==='favorites'?'saved auctions':variant==='bids'?'your bids':variant==='wins'?'winning bids':'your profile';
  const {language}=useMiniLocale(),am=language==='am',amLabel=variant==='alerts'?'ማሳወቂያዎች':variant==='favorites'?'ተወዳጆች':variant==='bids'?'ጨረታዎች':variant==='wins'?'ያሸነፉ ጨረታዎች':'መገለጫዎ';
  return <div className={styles.skeleton} role="status" aria-label={am?amLabel:'Loading '+label} aria-busy="true">{variant==='profile'?<><div className={styles.profileHead}><i/><div><i/><i/></div></div><i className={styles.profileBalance}/><div className={styles.profileMetrics}><i/><i/><i/></div><i className={styles.profileLink}/><i className={styles.profileLink}/></>:variant==='alerts'?<>{[0,1,2].map(item=><div className={styles.alertRow} key={item}><i/><div><b/><span/><span/></div></div>)}</>:variant==='favorites'?<>{[0,1].map(item=><article className={styles.favoriteCard} key={item}><i/><div><b/><span/><span/></div></article>)}</>:<>{[0,1].map(item=><article className={styles.bidRow} key={item}><i/><div><b/><b/><span/></div></article>)}</>}</div>
}
export function PersonalPagination({page,totalPages,setPage}:{page:number;totalPages:number;setPage:(page:number)=>void}) {
  return <nav className="pagination" aria-label="Your pages">{page>1&&<button onClick={()=>setPage(page-1)}><MiniPhrase en="Previous" am="ወደ ኋላ"/></button>}{page<totalPages&&<button onClick={()=>setPage(page+1)}><MiniPhrase en="Next page" am="ቀጣይ ገጽ"/></button>}</nav>;
}
