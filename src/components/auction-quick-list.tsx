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
import styles from './header-panels.module.css';

type AuctionList=Awaited<ReturnType<typeof listQuickLiveAuctions>>;
export function AuctionQuickList({className}:{className?:string}){
 const {language}=useMiniLocale(),am=language==='am',path=usePathname(),id=useId();
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<AuctionList|null>(null),[count,setCount]=useState<number|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  let controller:AbortController|null=null,disposed=false;
  const refreshCount=async()=>{
   if(controller||disposed)return;
   controller=new AbortController();const current=controller,timeout=setTimeout(()=>current.abort(),10000);
   try{const response=await fetch('/api/catalog/auctions?view=quick&status=live&sort=newest&page=1',{cache:'no-store',signal:current.signal});if(!response.ok)throw Error();const result=await response.json() as AuctionList;if(!disposed)setCount(Number.isSafeInteger(result.total)&&result.total>=0?result.total:null)}catch{if(!disposed)setCount(null)}finally{clearTimeout(timeout);controller=null}
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
  fetch(`/api/catalog/auctions?view=quick&status=live&sort=newest&page=${page}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Auctions unavailable');
   const result=await response.json() as AuctionList;
   if(!disposed){setCount(result.total);setData(previous=>page===1||!previous?result:{...result,items:[...previous.items,...result.items.filter(item=>!previous.items.some(existing=>existing.slug===item.slug))]})}
  }).catch(()=>{if(!disposed)setError(am?'ጨረታዎችን መጫን አልተቻለም።':'Could not load auctions. Retry.')}).finally(()=>{clearTimeout(timeout);if(!disposed)setLoading(false)});
  return()=>{disposed=true;controller.abort();clearTimeout(timeout)};
 },[open,page,revision,am]);
 const refresh=()=>{setData(null);setPage(1);setRevision(value=>value+1)};
 return <div>
  <button ref={trigger} className={`${styles.trigger} ${className??''}`} type="button" aria-label={`${am?'ያሉ ጨረታዎች':'Available auctions'}${count!==null?` (${count})`:''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>{refresh();setOpen(true)}}><Gavel size={21} aria-hidden="true"/>{count!==null&&<span className={styles.badge} aria-hidden="true">{count>99?'99+':count}</span>}</button>
  <dialog ref={dialog} id={id} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={()=>setOpen(false)} onClose={()=>{setOpen(false);trigger.current?.focus()}} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)setOpen(false)}}}>
   <header className={styles.heading}><div><h2 id={`${id}-title`}>{data&&<span className={styles.total}>{data.total}</span>}<MiniPhrase en="Available auctions" am="ያሉ ጨረታዎች"/></h2><small><MiniPhrase en="Newest first" am="አዲሶቹ በመጀመሪያ"/></small></div><div className={styles.headingActions}><button type="button" className={styles.iconButton} aria-label="Refresh auctions" disabled={loading} onClick={refresh}><RefreshCw size={18}/></button><button type="button" className={styles.iconButton} aria-label="Close auctions" onClick={()=>setOpen(false)}><X size={21}/></button></div></header>
   <div className={styles.scroll}>
    {data&&data.items.length===0&&<p className={styles.message}><MiniPhrase en="No live auctions right now." am="በአሁኑ ጊዜ በሂደት ላይ ያሉ ጨረታዎች የሉም።"/></p>}
    {!!data?.items.length&&<div className={styles.auctionList}>{data.items.map(item=><article className={styles.auction} key={item.slug}><Link href={`/auctions/${item.code}`} prefetch={false} className={styles.auctionImage} onClick={()=>setOpen(false)} aria-label={item.product.title}><CatalogImage src={item.product.images[0]?.path} alt=""/><span>#{item.code}</span></Link><div className={styles.auctionContent}><h3><Link href={`/auctions/${item.code}`} prefetch={false} onClick={()=>setOpen(false)}>{item.product.title}</Link></h3><p className={styles.auctionMeta}><Gavel size={13} aria-hidden="true"/>{item.bidCount.toLocaleString()} <MiniPhrase en="bids" am="ጨረታዎች"/>{item.isDemo?' · DEMO':''}</p><div className={styles.auctionBottom}><span className={styles.timer}><Clock3 size={13} aria-hidden="true"/><AuctionCountdown target={item.endsAt} serverNow={data.serverNow} label="Ends"/></span><Link className={styles.bidLink} href={`/auctions/${item.code}`} prefetch={false} onClick={()=>setOpen(false)}><Gavel size={13} aria-hidden="true"/><MiniPhrase en="Bid now" am="አሁን ይጫረቱ"/></Link></div></div></article>)}</div>}
    {loading&&<p className={styles.message} role="status"><LoadingSpinner/></p>}
    {error&&<div className={styles.message} role="alert">{error}<button type="button" className={styles.retry} onClick={()=>setRevision(value=>value+1)}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>}
    {data&&data.page<data.totalPages&&!error&&<button type="button" className={`${styles.retry} ${styles.loadMore}`} disabled={loading} onClick={()=>setPage(value=>value+1)}><MiniPhrase en="Show more auctions" am="ተጨማሪ ጨረታዎችን ያሳዩ"/></button>}
   </div>
  </dialog>
 </div>;
}
