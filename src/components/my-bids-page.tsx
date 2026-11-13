'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Clock3,Ticket} from 'lucide-react';
import type {PersonalBidList,PersonalBidListItem} from '@/modules/profile/bid-list';
import {formatAuctionBid} from '@/lib/money';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {useMiniPage,useMiniQueryState} from './mini-query-state';
import {usePrivateQuery,PrivateState} from './private-query';
import {invalidatePrivateQueries} from './private-query-cache';
import {prefetchPrivateQuery} from './private-query-cache';
import {auctionDetailUrl} from './auction-query';
import {useAuctionActivity} from './auction-activity';
import {AuctionCountdown} from './auction-countdown';
import {CatalogImage} from './catalog-image';
import {IntentPrefetchLink as Link} from './intent-prefetch-link';
import {OfflineRetry} from './offline-retry';
import {myBidListView,myBidOutcomeLabel,myBidsQueryUrl,type MyBidListView} from './my-bids-list-copy';
import styles from './my-bids-page.module.css';

const AuctionSheet=dynamic(()=>import('./my-bid-auction-sheet'),{ssr:false});
export {myBidOutcomeLabel as bidOutcomeLabel} from './my-bids-list-copy';

export function MyBidsPage({initialView='live'}:{initialView?:MyBidListView|'all'|'history'}){
 const {queryIdentity}=useTelegram();
 return <PlayerBids key={queryIdentity??'guest'} initialView={initialView}/>;
}

function PlayerBids({initialView}:{initialView:MyBidListView|'all'|'history'}){
 const {queryIdentity}=useTelegram(),{language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {params,set}=useMiniQueryState(),[page,setPage]=useMiniPage(),view=myBidListView(params.get('view')??initialView,params.get('status'));
 const [selected,setSelected]=useState<PersonalBidListItem|null>(null),trigger=useRef<HTMLElement|null>(null),invalidateTimer=useRef<ReturnType<typeof setTimeout>|null>(null),changedScopes=useRef(new Set<string>());
 const query=usePrivateQuery<PersonalBidList>(myBidsQueryUrl(view,page,language),{freshnessMs:view==='finished'?300000:15000,cancelOnUnmount:true}),data=query.data;
 useEffect(()=>{setSelected(null)},[view,page,language]);
 useEffect(()=>()=>{if(invalidateTimer.current)clearTimeout(invalidateTimer.current)},[]);
 // Every visible Live row shares the existing batched activity request. One
 // changed auction/deadline refreshes only this private list, never the app.
 const refresh=useCallback((slug:string|null,code:string)=>{
  if(!queryIdentity)return;
  changedScopes.current.add('/api/my-bids');changedScopes.current.add(auctionDetailUrl(slug??code));changedScopes.current.add('/api/results/'+encodeURIComponent(code));
  if(invalidateTimer.current)return;
  invalidateTimer.current=setTimeout(()=>{invalidateTimer.current=null;const scopes=[...changedScopes.current];changedScopes.current.clear();invalidatePrivateQueries(queryIdentity,scopes)},0);
 },[queryIdentity]);
 const choose=(next:MyBidListView)=>{if(next===view)return;setSelected(null);set({view:next==='live'?null:'finished',page:null,section:null,status:null,paymentPage:null})};
 const handleTabs=(event:React.KeyboardEvent<HTMLButtonElement>,next:MyBidListView)=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'||event.key==='Home'||event.key==='End'){event.preventDefault();const destination=event.key==='Home'?'live':event.key==='End'?'finished':next;choose(destination);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-view="'+destination+'"]')?.focus()}};
 return <><OfflineRetry/><section className={styles.page} data-my-bids-ready={!!data||undefined}>
  <div className={styles.tabs} role="tablist" data-my-bids-tabs aria-label={text('Your accepted bids','የተቀበሉ ጨረታዎችዎ')}>
   {(['live','finished'] as const).map(tab=><button key={tab} id={'my-bids-tab-'+tab} type="button" role="tab" data-view={tab} aria-controls="my-bids-panel" aria-selected={tab===view} tabIndex={tab===view?0:-1} onClick={()=>choose(tab)} onKeyDown={event=>handleTabs(event,tab==='live'?'finished':'live')}>{tab==='live'?text('Live','ቀጥታ'):text('Finished','ያለቁ')}</button>)}
  </div>
  <div id="my-bids-panel" role="tabpanel" aria-labelledby={'my-bids-tab-'+view}>
   {!data&&['loading','authenticated'].includes(query.status)&&!query.error?<BidRowsLoading am={am}/>:<PrivateState query={query} variant="bids"/>}
   {query.status==='authenticated'&&data&&<>
    {!data.items.length?<div className={styles.empty}><Ticket size={26} aria-hidden="true"/><h2>{view==='live'?text('No live bids yet','የቀጥታ ጨረታዎች ገና የሉም'):text('No finished bids yet','ያለቁ ጨረታዎች ገና የሉም')}</h2><p>{view==='live'?text('Your accepted bids appear here while the auction is open.','ጨረታው ክፍት ሳለ የተቀበሉ ጨረታዎችዎ እዚህ ይታያሉ።'):text('Completed and cancelled auctions appear here.','የተጠናቀቁ እና የተሰረዙ ጨረታዎች እዚህ ይታያሉ።')}</p><Link className={styles.action} href="/auctions/all">{text('Explore auctions','ጨረታዎችን ይመልከቱ')}</Link></div>:<div className={styles.list} data-my-bids-list>{data.items.map((item,index)=><BidRow key={item.id} item={item} priority={index===0} live={view==='live'} serverNow={data.serverNow} observedAt={query.updatedAt} onChanged={refresh} onOpen={event=>{trigger.current=event.currentTarget;setSelected(item)}}/>)}</div>}
    {(data.page>1||data.hasNext)&&<nav className={styles.pagination} aria-label={text('Bid pages','የጨረታ ገጾች')}><button type="button" disabled={data.page<=1} onClick={()=>setPage(data.page-1)} aria-label={text('Previous page','የቀድሞ ገጽ')}><ChevronLeft size={18} aria-hidden="true"/></button><span>{text('Page','ገጽ')} {data.page}</span><button type="button" disabled={!data.hasNext} onClick={()=>setPage(data.page+1)} aria-label={text('Next page','ቀጣይ ገጽ')}><ChevronRight size={18} aria-hidden="true"/></button></nav>}
   </>}
  </div>
 </section>{selected&&query.status==='authenticated'&&<AuctionSheet key={selected.id} bid={selected} live={view==='live'} serverNow={data?.serverNow??selected.acceptedAt} onClose={()=>setSelected(null)} returnFocusRef={trigger}/>}</>;
}

function BidRow({item,live,serverNow,observedAt,onChanged,onOpen,priority=false}:{item:PersonalBidListItem;priority?:boolean;live:boolean;serverNow:string;observedAt:number;onChanged:(slug:string|null,code:string)=>void;onOpen:(event:React.MouseEvent<HTMLButtonElement>)=>void}){
 const {queryIdentity}=useTelegram();
 const {language}=useMiniLocale(),am=language==='am',element=useRef<HTMLButtonElement>(null);
 const {activity}=useAuctionActivity(live||item.outcome==='PENDING'?item.auction.code:'',{element});
 const phase=activity?.status;
 const changed=useCallback(()=>onChanged(item.auction.slug,item.auction.code),[item.auction.slug,item.auction.code,onChanged]);
 useEffect(()=>{if(live&&phase&&phase!=='live')changed()},[live,phase,changed]);
 useEffect(()=>{if(!live&&item.outcome==='PENDING'&&activity?.resultReady)changed()},[live,item.outcome,activity?.resultReady,changed]);
 const title=am?item.auction.titleAm?.trim()||item.auction.title:item.auction.title,number=formatAuctionBid(item.amount,item.auction.ruleVersion??undefined).replace(/^ETB\s*/,''),feeOnly=isSubmissionFeeOnly(item.auction.ruleVersion??undefined);
 const prefetch=()=>{if(queryIdentity&&item.auction.slug)void prefetchPrivateQuery(queryIdentity,auctionDetailUrl(item.auction.slug))};
 const target=activity?.endsAt??item.auction.endsAt;
 return <button ref={element} className={styles.row} type="button" data-bid-id={item.id} onPointerEnter={prefetch} onFocus={prefetch} onClick={onOpen} aria-label={title+', '+(am?(feeOnly?'የመረጡት ቁጥር':'የጨረታ መጠን'):(feeOnly?'chosen number':'bid amount'))+' '+number+', '+myBidOutcomeLabel(item.outcome,am)}>
  <span className={styles.thumbnail} data-bid-thumbnail><CatalogImage src={item.auction.image?.path} alt="" variant="thumbnail" sizes="72px" priority={priority}/><span className={styles.number} data-long={number.length>7||undefined}>{number}</span></span>
  <span className={styles.rowBody}><span className={styles.rowTitle}>{title}</span><span className={styles.status} data-outcome={item.outcome}>{myBidOutcomeLabel(item.outcome,am)}{item.auction.isDemo&&<> · DEMO</>}</span>{live&&target&&<span className={styles.clock}><Clock3 size={12} aria-hidden="true"/><AuctionCountdown target={target} serverNow={serverNow} observedAt={observedAt} label="Ends" showLabel={false} variant="inline" onElapsed={changed}/></span>}</span>
  <ChevronRight className={styles.chevron} size={16} aria-hidden="true"/>
 </button>;
}

function BidRowsLoading({am}:{am:boolean}){return <div className={styles.loading} role="status" aria-busy="true"><span className="sr-only">{am?'ጨረታዎችዎን በመጫን ላይ…':'Loading your bids…'}</span><div aria-hidden="true">{[0,1,2].map(index=><div className={styles.rowSkeleton} key={index}><span/><div><span/><span/></div></div>)}</div></div>}
