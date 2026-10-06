'use client';
import {LoadingSpinner} from '@/components/loading-spinner';

import {useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Clock3,Gavel,RefreshCw,X} from 'lucide-react';
import type {listQuickLiveAuctions} from '@/modules/auctions/catalog';
import {AuctionCountdown} from './auction-countdown';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useAuctionActivity} from './auction-activity';
import styles from './header-panels.module.css';

type AuctionList=Awaited<ReturnType<typeof listQuickLiveAuctions>>;
function QuickAuction({item,serverNow,onClose}:{item:AuctionList['items'][number];serverNow:string;onClose:()=>void}){
 const {language}=useMiniLocale(),am=language==='am',ref=useRef<HTMLElement>(null);
 const {activity,refreshActivity}=useAuctionActivity(item.code,{element:ref});
 const title=am?(item.product.titleAm?.trim()||item.product.title):item.product.title,bids=activity?.bids??item.bidCount,ended=activity&&activity.status!=='live';
 return <article className={styles.auction} key={item.slug} ref={ref}>
  <Link href={`/auctions/${item.code}`} prefetch={false} className={styles.auctionImage} onClick={onClose} aria-label={title}><CatalogImage src={item.product.images[0]?.path} alt=""/><span>{bids.toLocaleString()}</span></Link>
  <div className={styles.auctionContent}><h3><Link href={`/auctions/${item.code}`} prefetch={false} onClick={onClose}>{title}</Link></h3><p className={styles.auctionMeta}><Gavel size={14} aria-hidden="true"/>{bids.toLocaleString()} <MiniPhrase en="bids" am="ጨረታዎች"/>{item.isDemo?' · DEMO':''}</p><div className={styles.auctionBottom}><span className={styles.timer}><Clock3 size={14} aria-hidden="true"/><AuctionCountdown target={activity?.endsAt??item.endsAt} serverNow={serverNow} label="Ends" showLabel={false} onElapsed={refreshActivity}/></span><Link className={styles.bidLink} href={`/auctions/${item.code}`} prefetch={false} onClick={onClose}><Gavel size={14} aria-hidden="true"/><MiniPhrase en={ended?'View results':'Bid now'} am={ended?'ውጤቱን ይመልከቱ':'አሁን ይጫረቱ'}/></Link></div></div>
 </article>;
}
export function AuctionQuickList({className}:{className?:string}){
 const {language}=useMiniLocale(),am=language==='am',path=usePathname(),id=useId();
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<AuctionList|null>(null),[count,setCount]=useState<number|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  let controller:AbortController|null=null,disposed=false;
  const refreshCount=async()=>{
   if(controller||disposed)return;
   controller=new AbortController();const current=controller,timeout=setTimeout(()=>current.abort(),10000);
   try{const response=await fetch('/api/catalog/auctions?view=quick&status=live&sort=code&page=1',{cache:'no-store',signal:current.signal});if(!response.ok)throw Error();const result=await response.json() as AuctionList;if(!disposed)setCount(Number.isSafeInteger(result.total)&&result.total>=0?result.total:null)}catch{if(!disposed)setCount(null)}finally{clearTimeout(timeout);controller=null}
  };
  void refreshCount();const timer=setInterval(()=>{if(!document.hidden)void refreshCount()},300000);const visible=()=>{if(!document.hidden)void refreshCount()};
  document.addEventListener('visibilitychange',visible);window.addEventListener('lowin-auctions',refreshCount);
  return()=>{disposed=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('lowin-auctions',refreshCount)};
 },[]);
 useEffect(()=>{setOpen(false)},[path]);
 useEffect(()=>{
  if(!open){dialog.current?.close();return}
  dialog.current?.showModal();
  const previous=document.documentElement.style.overflow;
  document.documentElement.style.overflow='hidden';
  return()=>{document.documentElement.style.overflow=previous;dialog.current?.close()};
 },[open]);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  let disposed=false;setLoading(true);setError('');
  fetch(`/api/catalog/auctions?view=quick&status=live&sort=code&page=${page}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Auctions unavailable');
   const result=await response.json() as AuctionList;
   if(!disposed){setCount(result.total);setData(previous=>page===1||!previous?result:{...result,items:[...previous.items,...result.items.filter(item=>!previous.items.some(existing=>existing.slug===item.slug))]})}
  }).catch(()=>{if(!disposed)setError(am?'ጨረታዎችን መጫን አልተቻለም።':'Could not load auctions. Retry.')}).finally(()=>{clearTimeout(timeout);if(!disposed)setLoading(false)});
  return()=>{disposed=true;controller.abort();clearTimeout(timeout)};
 },[open,page,revision,am]);
 const refresh=()=>{setData(null);setPage(1);setRevision(value=>value+1)};
 return <div>
  <button ref={trigger} className={`${styles.trigger} ${className??''}`} type="button" aria-label={`${am?'ያሉ ጨረታዎች':'Available auctions'}${count!==null?` (${count})`:''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>{refresh();setOpen(true)}}><Gavel size={21} aria-hidden="true"/>{count!==null&&<span className={styles.badge} aria-hidden="true">{count>99?'99+':count}</span>}</button>
  <dialog ref={dialog} id={id} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={()=>setOpen(false)} onClose={()=>{setOpen(false);trigger.current?.focus()}}>
   <div className={styles.closeBar}><button type="button" className={styles.iconButton} aria-label="Close auctions" onClick={()=>setOpen(false)}><X size={22}/></button></div>
   <header className={`${styles.heading} ${styles.auctionHeading}`}>{data?<span className={styles.total}>{data.total}</span>:<span/>}<h2 id={`${id}-title`}><MiniPhrase en="Available auctions" am="ያሉ ጨረታዎች"/></h2><button type="button" className={`${styles.iconButton} ${styles.refreshButton}`} aria-label="Refresh auctions" disabled={loading} onClick={refresh}><RefreshCw size={18}/></button></header>
   <div className={styles.scroll}>
    {data&&data.items.length===0&&<p className={styles.message}><MiniPhrase en="No live auctions right now." am="በአሁኑ ጊዜ በሂደት ላይ ያሉ ጨረታዎች የሉም።"/></p>}
    {open&&!!data?.items.length&&<div className={styles.auctionList}>{data.items.map(item=><QuickAuction key={item.slug} item={item} serverNow={data.serverNow} onClose={()=>setOpen(false)}/>)}</div>}
    {loading&&<p className={styles.message} role="status"><LoadingSpinner/></p>}
    {error&&<div className={styles.message} role="alert">{error}<button type="button" className={styles.retry} onClick={()=>setRevision(value=>value+1)}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>}
    {data&&data.page<data.totalPages&&!error&&<button type="button" className={`${styles.retry} ${styles.loadMore}`} disabled={loading} onClick={()=>setPage(value=>value+1)}><MiniPhrase en="Show more auctions" am="ተጨማሪ ጨረታዎችን ያሳዩ"/></button>}
   </div>
  </dialog>
 </div>;
}
