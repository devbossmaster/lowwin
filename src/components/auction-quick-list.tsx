'use client';

import {Suspense,useCallback,useEffect,useMemo,useRef,useState,type MouseEvent} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {CalendarDays,Clock3,Gavel,RefreshCw,Search} from 'lucide-react';
import type {getAuctionSummary,listQuickAuctions} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {mergeQuickAuctionPages} from '@/lib/quick-auction-pages';
import {quickAuctionResource} from './quick-auction-query';
import {AccountSheet} from './account-sheet';
import {AuctionCountdown} from './auction-countdown';
import {CatalogImage} from './catalog-image';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useMiniLocale} from './mini-locale';
import {usePrivateQuery} from './private-query';
import {loadPrivateJson,prefetchPrivateQuery,readPrivateQuery,subscribePrivateQueries} from './private-query-cache';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
import BidSheet from './bid-sheet';
import styles from './auction-browser-sheet.module.css';
import headerStyles from './header-panels.module.css';

type Mode='live'|'upcoming';
type Batch=Awaited<ReturnType<typeof listQuickAuctions>>;
const summaryUrl='/api/catalog/auctions?view=summary';

/** Close only after navigation commits, so sheet cleanup cannot unwind Link.push. */
function SheetRouteObserver({onNavigate}:{onNavigate:()=>void}){
 const path=usePathname(),search=useSearchParams(),route=path+'?'+search.toString(),initial=useRef(route);
 useEffect(()=>{if(route!==initial.current)onNavigate()},[route,onNavigate]);
 return null;
}

export function AuctionQuickList({className,showLabel=false}:{className?:string;showLabel?:boolean}){
 const {queryIdentity}=useTelegram();
 return <PlayerAuctionBrowser key={queryIdentity??'guest'} className={className} showLabel={showLabel}/>;
}
function PlayerAuctionBrowser({className,showLabel}:{className?:string;showLabel:boolean}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {queryIdentity}=useTelegram(),path=usePathname();
 const [open,setOpen]=useState(false),[mode,setMode]=useState<Mode>('live'),[pages,setPages]=useState({live:1,upcoming:1});
 const [selected,setSelected]=useState<{auction:Batch['items'][number];serverNow:string}|null>(null);
 const [,setRevision]=useState(0),trigger=useRef<HTMLButtonElement>(null),viewport=useRef<HTMLDivElement>(null),scroll=useRef({live:0,upcoming:0});
 const summary=usePrivateQuery<Awaited<ReturnType<typeof getAuctionSummary>>>(summaryUrl,{freshnessMs:30000,pollMs:60000});
 const query=usePrivateQuery<Batch>(quickAuctionResource(queryIdentity,mode,pages[mode]),{enabled:open});
 const refreshPage=useCallback((page:number)=>{if(queryIdentity)void loadPrivateJson(queryIdentity,quickAuctionResource(queryIdentity,mode,page),{force:true}).catch(()=>{});summary.reload()},[queryIdentity,mode,summary.reload]);
 const expiryCallbacks=useMemo(()=>Array.from({length:pages[mode]},(_,index)=>()=>refreshPage(index+1)),[pages[mode],refreshPage]);
 const count=summary.data?.totalLive;
 useEffect(()=>{setOpen(false);setSelected(null)},[path]);
 useEffect(()=>{
  if(!open)return;
  return subscribePrivateQueries(event=>{if(event.identity===queryIdentity&&event.kind==='stored'&&event.keys?.some(key=>key.startsWith('/api/catalog/auctions?')&&(key.includes('view=quick')||key.includes('view=home'))))setRevision(value=>value+1)});
 },[open,queryIdentity]);
 useEffect(()=>{
  if(!open||!viewport.current)return;
  const element=viewport.current,position=scroll.current[mode];
  // Restore after the native modal has opened and assigned its initial focus.
  const frame=requestAnimationFrame(()=>{element.scrollTop=position});
  return()=>cancelAnimationFrame(frame);
 },[open,mode]);
 function warm(next:Mode){
  const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType??''))return;
  void prefetchPrivateQuery(queryIdentity,quickAuctionResource(queryIdentity,next,1));
 }
 function show(){
  if(queryIdentity&&!readPrivateQuery<Batch>(queryIdentity,quickAuctionResource(queryIdentity,mode,1)))setPages(previous=>({...previous,[mode]:1}));
  setOpen(true);warm(mode);
 }
 function close(){
  // A final scroll event can still be queued when Escape or Back dismisses us.
  if(viewport.current)scroll.current[mode]=viewport.current.scrollTop;
  setOpen(false);
 }
 function refresh(){
  scroll.current[mode]=0;if(viewport.current)viewport.current.scrollTop=0;
  setPages(previous=>({...previous,[mode]:1}));query.reload();summary.reload();
 }
 function dismissCurrentLink(event:MouseEvent<HTMLAnchorElement>,href:string){
  const destination=new URL(href,location.href),current=new URL(location.href);destination.searchParams.sort();current.searchParams.sort();
  if(destination.pathname===current.pathname&&destination.search===current.search){event.preventDefault();close()}
 }
 const snapshots=Array.from({length:pages[mode]},(_,index)=>queryIdentity?readPrivateQuery<Batch>(queryIdentity,quickAuctionResource(queryIdentity,mode,index+1)):null);
 const batches=snapshots.filter((snapshot):snapshot is NonNullable<typeof snapshot>=>!!snapshot);
 const data=mergeQuickAuctionPages(batches.map(batch=>batch.value),mode),loading=!data&&!query.error,busy=query.fetching||!snapshots.at(-1)&&!query.error;
 useEffect(()=>{if(open&&pages[mode]>1&&!snapshots[0]&&!query.fetching){scroll.current[mode]=0;setPages(previous=>({...previous,[mode]:1}))}},[open,mode,pages,query.updatedAt,query.fetching,!!snapshots[0]]);
 return <div>
  <button ref={trigger} className={`${headerStyles.trigger} ${className??''}`} type="button" aria-label={`${text('Browse auctions','ጨረታዎችን ይመልከቱ')}${count!==undefined?`, ${count} ${text('live','ክፍት')}`:''}`} aria-haspopup="dialog" aria-expanded={open} onPointerEnter={()=>warm(mode)} onFocus={()=>warm(mode)} onTouchStart={()=>warm(mode)} onClick={show}><Gavel size={17} strokeWidth={1.75} aria-hidden="true"/>{showLabel&&<span>{text('Auctions','ጨረታዎች')}</span>}{count!==undefined&&<span className={headerStyles.badge} data-live-auction-indicator aria-hidden="true">{count>99?'99+':count}</span>}</button>
  {open&&<AccountSheet title={text('Auctions','ጨረታዎች')} onClose={close} returnFocusRef={trigger} headerActions={<button type="button" aria-label={text('Refresh auctions','ጨረታዎችን አድስ')} disabled={query.fetching} onClick={refresh}><RefreshCw size={18} aria-hidden="true"/></button>} footer={<IntentPrefetchLink className={styles.browseAll} href={`/auctions/all?status=${mode}`} onClick={event=>dismissCurrentLink(event,`/auctions/all?status=${mode}`)}><Search size={16} aria-hidden="true"/>{text('Browse all auctions','ሁሉንም ጨረታዎች ይመልከቱ')}</IntentPrefetchLink>}>
   <Suspense fallback={null}><SheetRouteObserver onNavigate={close}/></Suspense>
   <div className={styles.panel}>
    <div className={styles.tabs} role="tablist" aria-label={text('Auction status','የጨረታ ሁኔታ')}>{(['live','upcoming'] as const).map(value=><button key={value} type="button" role="tab" id={`quick-${value}`} aria-controls="quick-auction-panel" aria-selected={mode===value} tabIndex={mode===value?0:-1} onPointerEnter={()=>warm(value)} onFocus={()=>warm(value)} onTouchStart={()=>warm(value)} onClick={()=>setMode(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'live':event.key==='End'?'upcoming':mode==='live'?'upcoming':'live';setMode(next);document.getElementById(`quick-${next}`)?.focus()}}}>{value==='live'?<Gavel size={15} aria-hidden="true"/>:<Clock3 size={15} aria-hidden="true"/>}{text(value==='live'?'Live':'Upcoming',value==='live'?'ክፍት':'የሚመጡ')}<span>{data&&mode===value?data.total:value==='live'?summary.data?.totalLive??'—':summary.data?.totalUpcoming??'—'}</span></button>)}</div>
    <p className={styles.caption} role="status">{query.error?text(data?'Showing saved auctions. Refresh failed.':'Could not load auctions. Please retry.',data?'የተቀመጡ ጨረታዎች ይታያሉ። ማደስ አልተሳካም።':'ጨረታዎችን ማምጣት አልተቻለም። እንደገና ይሞክሩ።'):query.fetching&&data?text('Updating auctions…','ጨረታዎች በማደስ ላይ…'):text('Schedules shown in Addis Ababa time','ጊዜዎች በአዲስ አበባ ሰዓት ናቸው')}</p>
    <div ref={viewport} className={styles.viewport} id="quick-auction-panel" role="tabpanel" aria-labelledby={`quick-${mode}`} aria-busy={busy} tabIndex={0} onScroll={event=>{scroll.current[mode]=event.currentTarget.scrollTop}}>
     {loading&&<div className={styles.loading} role="status" aria-label={text('Loading auctions','ጨረታዎች በመጫን ላይ')}>{[1,2,3].map(item=><div key={item} className={styles.placeholder} aria-hidden="true"><span/><div><i/><i/><i/></div></div>)}</div>}
     {data?.items.map(item=>{const title=am?(item.product.titleAm?.trim()||item.product.title):item.product.title,batch=batches.find(batch=>batch.value.items.some(row=>row.code===item.code)),now=batch?.value.serverNow??data.serverNow,content=<>
       <span className={styles.image}><CatalogImage src={item.product.images[0]?.path} alt="" sizes="76px"/></span>
       <span className={styles.details}><strong>{title}</strong><span className={styles.date}><CalendarDays size={12} aria-hidden="true"/><time dateTime={mode==='upcoming'?item.startsAt:item.endsAt}>{new Date(mode==='upcoming'?item.startsAt:item.endsAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})}</time>{item.isDemo&&<small>DEMO</small>}</span><span className={styles.facts}><span className={styles.fee}>{formatEtb(item.terms.entryFeePoints)}</span><span className={styles.timer}><Clock3 size={12} aria-hidden="true"/><AuctionCountdown target={mode==='upcoming'?item.startsAt:item.endsAt} serverNow={now} observedAt={batch?.updatedAt} label={mode==='upcoming'?'Starts':'Ends'} showLabel={false} onElapsed={expiryCallbacks[(batch?.value.page??1)-1]}/></span></span></span>
      </>;return mode==='live'?<button type="button" key={item.code} className={styles.row} data-auction-code={item.code} data-auction-status={item.status} aria-label={text(`Bid on ${title}`,`${title} ላይ ይጫረቱ`)} onPointerEnter={()=>prefetchAuctionIntent(queryIdentity,item.slug,{details:true})} onFocus={()=>prefetchAuctionIntent(queryIdentity,item.slug,{details:true})} onTouchStart={()=>prefetchAuctionIntent(queryIdentity,item.slug,{details:true})} onClick={()=>setSelected({auction:item,serverNow:now})}>{content}</button>:<article key={item.code} className={styles.row} data-auction-code={item.code} data-auction-status={item.status}>{content}</article>})}
     {data?.items.length===0&&<div className={styles.empty}><Gavel size={25} aria-hidden="true"/><h3>{text(mode==='live'?'No live auctions right now':'No upcoming auctions yet',mode==='live'?'አሁን ክፍት ጨረታ የለም':'ገና የሚመጣ ጨረታ የለም')}</h3><p>{text('New auctions will appear here.','አዲስ ጨረታዎች እዚህ ይታያሉ።')}</p></div>}
     {query.error&&<button type="button" className={styles.loadMore} onClick={query.reload}>{text('Retry','እንደገና ይሞክሩ')}</button>}
     {data&&data.page<data.totalPages&&!query.error&&<button type="button" className={styles.loadMore} disabled={busy} onClick={()=>setPages(previous=>({...previous,[mode]:data.page+1}))}>{busy?text('Loading…','በመጫን ላይ…'):text('Load more','ተጨማሪ ይመልከቱ')}</button>}
    </div>
   </div>
  </AccountSheet>}
  {open&&selected&&<BidSheet key={selected.auction.slug} auction={selected.auction} serverNow={selected.serverNow} onClose={()=>setSelected(null)}/>}
 </div>;
}
