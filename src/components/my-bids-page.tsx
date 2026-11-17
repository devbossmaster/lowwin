'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Clock3,Ticket} from 'lucide-react';
import type {PersonalBidAuctionList,PersonalBidListItem} from '@/modules/profile/bid-list';
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
import {RefundStatus} from './auction-refund-notice';
import {myBidListView,myBidOutcomeLabel,myBidsQueryUrl,myBidsGroupQueryUrl,type MyBidListView} from './my-bids-list-copy';
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
 const [refundsPending,setRefundsPending]=useState(false);
 const query=usePrivateQuery<PersonalBidAuctionList>(myBidsQueryUrl(view,page,language),{pollMs:refundsPending?3000:0,freshnessMs:refundsPending?2000:view==='finished'?300000:15000,cancelOnUnmount:true}),data=query.data;
 useEffect(()=>{setRefundsPending(!!data?.items.some(item=>item.refund?.status==='pending'))},[data]);
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
    {!data.items.length?<div className={styles.empty}><Ticket size={26} aria-hidden="true"/><h2>{view==='live'?text('No live bids yet','የቀጥታ ጨረታዎች ገና የሉም'):text('No finished bids yet','ያለቁ ጨረታዎች ገና የሉም')}</h2><p>{view==='live'?text('Your accepted bids appear here while the auction is open.','ጨረታው ክፍት ሳለ የተቀበሉ ጨረታዎችዎ እዚህ ይታያሉ።'):text('Completed and cancelled auctions appear here.','የተጠናቀቁ እና የተሰረዙ ጨረታዎች እዚህ ይታያሉ።')}</p><Link className={styles.action} href="/#discover-auctions">{text('Explore auctions','ጨረታዎችን ይመልከቱ')}</Link></div>:<div className={styles.list} data-my-bids-list>{data.items.map((group,index)=><BidAuctionCard key={group.auction.code} group={group} priority={index===0} live={view==='live'} serverNow={data.serverNow} observedAt={query.updatedAt} onChanged={refresh} onOpen={(event,bid)=>{trigger.current=event.currentTarget;setSelected(bid)}}/>)}</div>}
    {(data.page>1||data.hasNext)&&<nav className={styles.pagination} aria-label={text('Bid pages','የጨረታ ገጾች')}><button type="button" disabled={data.page<=1} onClick={()=>setPage(data.page-1)} aria-label={text('Previous page','የቀድሞ ገጽ')}><ChevronLeft size={18} aria-hidden="true"/></button><span>{text('Page','ገጽ')} {data.page}</span><button type="button" disabled={!data.hasNext} onClick={()=>setPage(data.page+1)} aria-label={text('Next page','ቀጣይ ገጽ')}><ChevronRight size={18} aria-hidden="true"/></button></nav>}
   </>}
  </div>
 </section>{selected&&query.status==='authenticated'&&<AuctionSheet key={selected.id} bid={selected} live={view==='live'} serverNow={data?.serverNow??selected.acceptedAt} onClose={()=>setSelected(null)} returnFocusRef={trigger}/>}</>;
}

type AuctionBidGroup=PersonalBidAuctionList['items'][number];
function BidAuctionCard({group,live,serverNow,observedAt,onChanged,onOpen,priority=false}:{group:AuctionBidGroup;priority?:boolean;live:boolean;serverNow:string;observedAt:number;onChanged:(slug:string|null,code:string)=>void;onOpen:(event:React.MouseEvent<HTMLButtonElement>,bid:PersonalBidListItem)=>void}){
 const {queryIdentity}=useTelegram(),{language}=useMiniLocale(),am=language==='am',element=useRef<HTMLElement>(null);
 const [more,setMore]=useState<{source:AuctionBidGroup;bids:AuctionBidGroup['bids'];next:string|null}>({source:group,bids:[],next:group.nextBidCursor}),[cursor,setCursor]=useState<string|null>(null),processed=useRef(new Set<string>()),pendingFor=useRef<AuctionBidGroup|null>(null);
 const nextCursor=more.source===group?more.next:group.nextBidCursor,activeCursor=pendingFor.current===group?cursor:null;
 const extra=usePrivateQuery<PersonalBidAuctionList>(myBidsGroupQueryUrl(live?'live':'finished',language,group.auction.code,activeCursor??''),{enabled:!!activeCursor,freshnessMs:live?15000:300000,cancelOnUnmount:true});
 useEffect(()=>{processed.current.clear();pendingFor.current=null;setMore({source:group,bids:[],next:group.nextBidCursor});setCursor(null)},[group]);
 useEffect(()=>{
  if(!cursor||pendingFor.current!==group||!extra.data||processed.current.has(cursor))return;
  const page=extra.data.items.find(item=>item.auction.code===group.auction.code);if(!page)return;
  processed.current.add(cursor);setMore(prior=>({source:group,bids:[...new Map([...(prior.source===group?prior.bids:[]),...page.bids].map(bid=>[bid.id,bid])).values()],next:page.nextBidCursor}));setCursor(null);
 },[cursor,extra.data,group]);
 const bids=[...new Map([...group.bids,...(more.source===group?more.bids:[])].map(bid=>[bid.id,bid])).values()],outcomes=bids.map(bid=>bid.outcome);
 const outcome=group.outcome??(outcomes.includes('PENDING')?'PENDING':outcomes.includes('WON')?'WON':outcomes[0]??'PENDING');
 const {activity}=useAuctionActivity(live||outcome==='PENDING'?group.auction.code:'',{element}),phase=activity?.status;
 const changed=useCallback(()=>onChanged(group.auction.slug,group.auction.code),[group.auction.slug,group.auction.code,onChanged]);
 useEffect(()=>{if(live&&phase&&phase!=='live')changed()},[live,phase,changed]);
 useEffect(()=>{if(!live&&outcome==='PENDING'&&activity?.resultReady)changed()},[live,outcome,activity?.resultReady,changed]);
 const title=am?group.auction.titleAm?.trim()||group.auction.title:group.auction.title,feeOnly=isSubmissionFeeOnly(group.auction.ruleVersion??undefined),target=activity?.endsAt??group.auction.endsAt;
 const prefetch=()=>{if(queryIdentity&&group.auction.slug)void prefetchPrivateQuery(queryIdentity,auctionDetailUrl(group.auction.slug))};
 const open=(event:React.MouseEvent<HTMLButtonElement>)=>{if(bids[0])onOpen(event,{...bids[0],auction:group.auction})};
 return <article ref={element} className={styles.auctionCard} data-bid-auction={group.auction.code}>
  <button className={styles.row} type="button" onPointerEnter={prefetch} onFocus={prefetch} onClick={open} aria-label={(live?(am?'ጨረታውን ይክፈቱ':'Open auction'):(am?'ውጤቱን ይመልከቱ':'View result'))+': '+title}>
   <span className={styles.thumbnail} data-bid-thumbnail><CatalogImage src={group.auction.image?.path} alt="" variant="thumbnail" sizes="72px" priority={priority}/></span>
   <span className={styles.rowBody}><span className={styles.rowTitle}>{title}</span><span className={styles.status} data-outcome={outcome}>{myBidOutcomeLabel(outcome,am)}{group.auction.isDemo&&<> · DEMO</>}</span>{live&&target&&<span className={styles.clock}><Clock3 size={12} aria-hidden="true"/><AuctionCountdown target={target} serverNow={serverNow} observedAt={observedAt} label="Ends" showLabel={false} variant="inline" onElapsed={changed}/></span>}</span>
   <ChevronRight className={styles.chevron} size={16} aria-hidden="true"/>
  </button>
  {group.refund&&<RefundStatus refund={group.refund}/>}
  <div className={styles.numbersHeading}>{am?(feeOnly?'የመረጧቸው ቁጥሮች':'የጨረታ መጠኖች'):(feeOnly?'Your numbers':'Your bid amounts')} <span>{group.bidCount}</span></div>
  <ul className={styles.numbers} tabIndex={bids.length>12?0:undefined} aria-label={am?'የተቀበሉ ጨረታዎች':'Accepted bids'}>{bids.map(bid=>{
   const number=formatAuctionBid(bid.amount,group.auction.ruleVersion??undefined),label=myBidOutcomeLabel(bid.outcome,am);
   return <li key={bid.id} className={styles.bidChip} data-bid-id={bid.id} data-outcome={bid.outcome} aria-label={(am?(feeOnly?'የመረጡት ቁጥር':'የጨረታ መጠን'):(feeOnly?'chosen number':'bid amount'))+' '+number+', '+label}><span className={styles.chipNumber}>{number}</span>{!live&&<span className={styles.chipStatus}>{label}</span>}</li>;
  })}</ul>
  {(nextCursor||activeCursor)&&<div className={styles.moreNumbers}>{extra.error&&<p role="status">{am?'ቀሪዎቹን ቁጥሮች ማምጣት አልተቻለም።':'The remaining numbers could not load.'}</p>}<button type="button" disabled={!!activeCursor&&!extra.error} onClick={()=>{if(extra.error)extra.reload();else{pendingFor.current=group;setCursor(nextCursor)}}}>{activeCursor&&!extra.error?(am?'በመጫን ላይ…':'Loading…'):extra.error?(am?'እንደገና ይሞክሩ':'Try again'):(am?'ተጨማሪ ቁጥሮችን አሳይ':'Show more numbers')}</button></div>}
 </article>;
}

function BidRowsLoading({am}:{am:boolean}){return <div className={styles.loading} role="status" aria-busy="true"><span className="sr-only">{am?'ጨረታዎችዎን በመጫን ላይ…':'Loading your bids…'}</span><div aria-hidden="true">{[0,1,2].map(index=><div className={styles.rowSkeleton} key={index}><span/><div><span/><span/></div></div>)}</div></div>}
