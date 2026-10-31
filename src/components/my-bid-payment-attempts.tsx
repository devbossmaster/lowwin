'use client';
import {useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,RefreshCw} from 'lucide-react';
import {usePrivateQuery,PrivateState} from './private-query';
import {useMiniLocale} from './mini-locale';
import {ChapaTransactionDetails} from './chapa-payment-history';
import {chapaStatusLabel} from './chapa-payment';
import {chapaConfirmed,type ChapaCheckoutView} from '@/lib/chapa-client';
import {formatEtb} from '@/lib/money';
import {MiniBidRowsSkeleton} from './mini-route-skeleton';
import {useMiniPage} from './mini-query-state';
import type {BidPaymentAttemptFilter} from './my-bids-copy';
import styles from './my-bids-page.module.css';

type Page={items:ChapaCheckoutView[];page:number;nextPage:number|null};
/** Attempts remain owned payment records; they never become accepted Bid rows. */
export function MyBidPaymentAttempts({filter}:{filter:BidPaymentAttemptFilter}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const [page,setPage]=useMiniPage('paymentPage'),[selected,setSelected]=useState<ChapaCheckoutView|null>(null),trigger=useRef<HTMLElement|null>(null);
 const query=usePrivateQuery<Page>(`/api/payments/chapa/checkouts?purpose=BID&page=${page}&view=unaccepted${filter==='all'?'':'&status='+filter}`,{keepPreviousData:true,freshnessMs:5000,pollMs:15000,cancelOnUnmount:true});
 const date=new Intl.DateTimeFormat(am?'am-ET':'en-ET',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
 const emptyCopy={all:['No bid payment attempts yet.','የጨረታ ክፍያ ሙከራዎች ገና የሉም።'],pending:['No pending bid payments.','በመጠባበቅ ላይ ያሉ የጨረታ ክፍያዎች የሉም።'],failed:['No failed bid payments.','ያልተሳኩ የጨረታ ክፍያዎች የሉም።'],cancelled:['No cancelled bid payments.','የተሰረዙ የጨረታ ክፍያዎች የሉም።'],review:['No bid payments need review.','ግምገማ የሚያስፈልጋቸው የጨረታ ክፍያዎች የሉም።']} satisfies Record<BidPaymentAttemptFilter,[string,string]>;
 return <section className={styles.attempts} aria-label={text('Bid payment attempts','የጨረታ ክፍያ ሙከራዎች')} data-bid-payment-attempts>
  <div className={styles.attemptHeading}><h2>{text('Payment attempts','የክፍያ ሙከራዎች')}</h2><button type="button" disabled={query.fetching} onClick={query.reload} aria-label={text('Refresh payment attempts','የክፍያ ሙከራዎችን ያድሱ')}><RefreshCw size={15} aria-hidden="true"/></button></div>
  <p className={styles.listNote}>{text('These payments have not created an accepted bid.','እነዚህ ክፍያዎች የተቀበለ ጨረታ አልፈጠሩም።')}</p>
  {(query.data||query.error||!['loading','authenticated'].includes(query.status))&&<PrivateState query={query} variant="bids"/>}
  {!query.data&&!query.error&&['loading','authenticated'].includes(query.status)&&<MiniBidRowsSkeleton/>}
  {query.status==='authenticated'&&query.data&&<>
   {!query.data.items.length?<p className={styles.filterEmpty}>{text(...emptyCopy[filter])}</p>:<div className={styles.list} aria-busy={query.fetching}>{query.data.items.map(order=><button className={styles.row} type="button" key={order.id} data-payment-id={order.id} disabled={query.isPlaceholderData} onClick={event=>{trigger.current=event.currentTarget;setSelected(order)}}>
    <span className={styles.number} data-long={(order.bidNumber?.length??0)>7||undefined}>{order.bidNumber??'—'}</span><span className={styles.rowBody}><span className={styles.rowTitle}>{am?order.auctionTitleAm||order.auctionTitle||text('Bid payment','የጨረታ ክፍያ'):order.auctionTitle||'Bid payment'}</span><span className={styles.statuses}><span className={styles.payment} data-payment-status={order.status}>{chapaStatusLabel(order,am)}</span>{order.mode==='test'&&<span className={styles.payment}>TEST</span>}</span><span className={styles.meta}><time dateTime={order.createdAt}>{date.format(new Date(order.createdAt))}</time> · {text('Fee','ክፍያ')} {formatEtb(order.amount)}</span><span className={styles.reference}>{order.merchantReference??order.id}</span>{chapaConfirmed(order)&&<span className={styles.attemptNotice}>{text('Funds preserved · bid not accepted','ገንዘቡ ተጠብቋል · ጨረታው አልተቀበለም')}</span>}</span><ChevronRight className={styles.chevron} size={17} aria-hidden="true"/>
   </button>)}</div>}
   {(page>1||query.data.nextPage)&&<nav className={styles.pagination} aria-label={text('Payment attempt pages','የክፍያ ሙከራ ገጾች')}><button type="button" disabled={page<=1||query.fetching} aria-label={text('Previous page','የቀድሞ ገጽ')} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><span>{page}</span><button type="button" disabled={!query.data.nextPage||query.fetching} aria-label={text('Next page','ቀጣይ ገጽ')} onClick={()=>setPage(query.data!.nextPage!)}><ChevronRight size={18}/></button></nav>}
  </>}
  {selected&&query.status==='authenticated'&&<ChapaTransactionDetails key={selected.id} order={selected} onClose={()=>setSelected(null)} trigger={trigger}/>}
 </section>;
}
