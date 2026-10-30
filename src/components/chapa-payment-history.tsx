'use client';
import Link from 'next/link';
import {ChevronLeft,ChevronRight,RefreshCw,ReceiptText} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {usePrivateQuery,PrivateState} from './private-query';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {AccountSheet} from './account-sheet';
import {ChapaPaymentStatus,chapaStatusLabel,useChapaPayment} from './chapa-payment';
import {chapaConfirmed,chapaSessionDeadline,type ChapaCheckoutView} from '@/lib/chapa-client';
import {formatEtb} from '@/lib/money';
import {useMiniPage} from './mini-query-state';
import styles from './chapa-payment-history.module.css';

type Page={items:ChapaCheckoutView[];page:number;nextPage:number|null};
type HistoryVisibility=Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;
/** Update saved row labels when their customer windows end. This clock only
 * rerenders owned data; provider verification and financial status stay server-owned. */
export function startChapaHistoryClock(orders:readonly ChapaCheckoutView[],refresh:()=>void,visibility:HistoryVisibility=document,wake:Pick<EventTarget,'addEventListener'|'removeEventListener'>=window){
 let active=true,timer:ReturnType<typeof setTimeout>|undefined;
 const schedule=()=>{
  clearTimeout(timer);if(!active||visibility.visibilityState!=='visible')return;
  const now=Date.now(),deadlines=orders.filter(order=>!chapaConfirmed(order)&&order.providerStatus!=='SUCCESS'&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status)).map(chapaSessionDeadline).filter((deadline):deadline is number=>deadline!==null&&deadline>now);
  if(deadlines.length)timer=setTimeout(tick,Math.min(...deadlines)-now+1);
 };
 const tick=()=>{if(!active||visibility.visibilityState!=='visible')return;refresh();schedule()};
 visibility.addEventListener('visibilitychange',tick);wake.addEventListener('focus',tick);schedule();
 return()=>{active=false;clearTimeout(timer);visibility.removeEventListener('visibilitychange',tick);wake.removeEventListener('focus',tick)};
}
function TransactionDetails({order,onClose,trigger}:{order:ChapaCheckoutView;onClose:()=>void;trigger:React.RefObject<HTMLElement|null>}){
 const payment=useChapaPayment('transaction:'+order.id,order.id),{language}=useMiniLocale(),am=language==='am',current=payment.order??order;
 const fresh=current.purpose==='TOP_UP'?'/wallet/deposit':current.auctionSlug?`/auctions/${current.auctionCode??current.auctionSlug}#bid-review`:null;
 return <AccountSheet size="payment" title={am?'የግብይት ዝርዝር':'Transaction details'} onClose={onClose} returnFocusRef={trigger}>
  <ChapaPaymentStatus payment={payment} onNavigate={onClose} readOnly/>
  {fresh&&(!chapaConfirmed(current)||current.purpose==='TOP_UP')&&<div className={styles.retry}><Link href={fresh} onClick={onClose}>{am?'አዲስ ክፍያ ይጀምሩ':'Start new checkout'}</Link>{!chapaConfirmed(current)&&<p>{am?'የቀድሞው ክፍያ አሁንም ሊጠናቀቅ ይችላል።':'The previous payment may still complete.'}</p>}</div>}
 </AccountSheet>;
}
export function ChapaPaymentHistory({purpose,unaccepted=false,fullPage=false}:{purpose?:'TOP_UP'|'BID';unaccepted?:boolean;fullPage?:boolean}={}){
 const {queryIdentity}=useTelegram();return <OwnedHistory key={queryIdentity??'guest'} purpose={purpose} unaccepted={unaccepted} fullPage={fullPage}/>;
}
function OwnedHistory({purpose,unaccepted,fullPage}:{purpose?:'TOP_UP'|'BID';unaccepted:boolean;fullPage:boolean}){
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const [routePage,setRoutePage]=useMiniPage(),[localPage,setLocalPage]=useState(1),page=fullPage?routePage:localPage,setPage=fullPage?setRoutePage:setLocalPage;
 const [selected,setSelected]=useState<ChapaCheckoutView|null>(null),trigger=useRef<HTMLElement|null>(null);
 const url=`/api/payments/chapa/checkouts?${purpose?'purpose='+purpose+'&':''}page=${page}${unaccepted?'&view=unaccepted':''}`;
 const query=usePrivateQuery<Page>(url,{keepPreviousData:true,freshnessMs:5000}),date=new Intl.DateTimeFormat(am?'am-ET':'en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
 const [,refreshSessionLabels]=useState(0);
 useEffect(()=>query.data?startChapaHistoryClock(query.data.items,()=>refreshSessionLabels(value=>value+1)):undefined,[query.data]);
 return <section id={fullPage?'transactions':'wallet-payments'} className={`${styles.history} ${fullPage?styles.fullPage:''}`} aria-labelledby={unaccepted?'bid-payments-title':'transactions-title'} data-payment-history>
  <div className={styles.heading}><h2 className={fullPage?'sr-only':undefined} id={unaccepted?'bid-payments-title':'transactions-title'}>{text(unaccepted?'Bid payment attempts':'Transactions',unaccepted?'የጨረታ ክፍያ ሙከራዎች':'ግብይቶች')}</h2><button type="button" onClick={query.reload} disabled={query.fetching} aria-label={text('Refresh transactions','ግብይቶችን ያድሱ')}><RefreshCw size={16} aria-hidden="true"/></button></div>
  <PrivateState query={query}/>
  {query.status==='authenticated'&&query.data&&<>
   {!query.data.items.length&&<div className={styles.notice}><ReceiptText size={24} aria-hidden="true"/><p>{text(unaccepted?'No unfinished bid payments.':'Your top-ups and bid payments will appear here.',unaccepted?'ያልተጠናቀቁ የጨረታ ክፍያዎች የሉም።':'የዋሌት ገቢዎችና የጨረታ ክፍያዎች እዚህ ይታያሉ።')}</p></div>}
   <ul className={styles.list} aria-busy={query.fetching}>{query.data.items.map(order=><li key={order.id}><button type="button" className={styles.row} data-payment-id={order.id} disabled={query.isPlaceholderData} onClick={event=>{trigger.current=event.currentTarget;setSelected(order)}}>
    <span className={styles.details}><strong>{formatEtb(order.amount)}</strong><span>{text(order.purpose==='TOP_UP'?'Wallet top-up':'Bid submission fee',order.purpose==='TOP_UP'?'የዋሌት ገቢ':'የጨረታ ማቅረቢያ ክፍያ')}{order.mode==='test'&&<> · {text('Test','ሙከራ')}</>}</span>{order.purpose==='BID'&&<span>{am?order.auctionTitleAm||order.auctionTitle||order.auctionSlug:order.auctionTitle||order.auctionSlug} · #{order.bidNumber}</span>}<time dateTime={order.createdAt}>{date.format(new Date(order.createdAt))}</time></span>
    <span className={styles.actions}><span className={styles.status} data-confirmed={chapaConfirmed(order)}>{chapaStatusLabel(order,am)}</span><ChevronRight size={16} aria-hidden="true"/></span>
   </button></li>)}</ul>
   {(page>1||query.data.nextPage)&&<nav className={styles.pagination} aria-label={text('Transaction pages','የግብይት ገጾች')}><button type="button" disabled={page<=1||query.fetching} aria-label={text('Previous page','ያለፈው ገጽ')} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button><span>{page}</span><button type="button" disabled={!query.data.nextPage||query.fetching} aria-label={text('Next page','ቀጣይ ገጽ')} onClick={()=>setPage(query.data!.nextPage!)}><ChevronRight size={18}/></button></nav>}
  </>}
  {selected&&query.status==='authenticated'&&<TransactionDetails key={selected.id} order={selected} onClose={()=>setSelected(null)} trigger={trigger}/>}
 </section>;
}
