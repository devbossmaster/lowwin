'use client';
import {useRef,useState} from 'react';
import {IntentPrefetchLink as Link} from './intent-prefetch-link';
import {ArrowLeft,ChevronLeft,ChevronRight,Ticket} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {usePrivateQuery,PrivateState} from './private-query';
import {OfflineRetry} from './offline-retry';
import type {getPersonalBids} from '@/modules/profile/personal';
import {useMiniPage,useMiniQueryState} from './mini-query-state';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {formatAuctionBid,formatEtb,etbToCents} from '@/lib/money';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {useTelegram} from './telegram-provider';
import {rememberedMiniDestination} from './mini-navigation-state';
import {bidFeeNotice} from './my-bids-copy';
import styles from './my-bids-page.module.css';

type Data=Awaited<ReturnType<typeof getPersonalBids>>;
type Bid=Data['items'][number];
type View='all'|'live'|'history';
export function bidOutcomeLabel(outcome:string,am:boolean){
 const copy:Record<string,[string,string]>={LIVE:['Active','በሂደት ላይ'],PENDING:['Result pending','ውጤት በመጠባበቅ ላይ'],WON:['Won','አሸንፈዋል'],LOST:['Not won','አላሸነፈም'],CANCELLED:['Cancelled','ተሰርዟል'],NO_WINNER:['No winner','አሸናፊ የለም']};
 return (copy[outcome]??copy.PENDING)[am?1:0];
}
function paymentOf(bid:Bid):Bid["payment"]{return bid.payment??{status:etbToCents(bid.feePoints)===0n?"NOT_REQUIRED":"UNAVAILABLE",method:null,transactionRef:null}}
function paymentLabel(status:Bid['payment']['status'],am:boolean){return status==='PAID'?(am?'ክፍያው ተከፍሏል':'Fee paid'):status==='NOT_REQUIRED'?(am?'ክፍያ የለም':'No fee'):(am?'የክፍያ ዝርዝር አይገኝም':'Payment details unavailable')}
function paymentMethod(method:Bid['payment']['method'],am:boolean){return method==='WALLET'?(am?'የዋሌት ቀሪ ሂሳብ':'Wallet balance'):method==='ARIFPAY_TELEBIRR'?'ArifPay · Telebirr':method==='ARIFPAY_MPESA'?'ArifPay · M-PESA':null}
const shortId=(id:string)=>id.length>16?`${id.slice(0,8)}…${id.slice(-4)}`:id;

export function MyBidsPage({initialView='all'}:{initialView?:View}){
 const {queryIdentity}=useTelegram();
 return <PlayerBids key={queryIdentity??'guest'} initialView={initialView}/>;
}
function PlayerBids({initialView}:{initialView:View}){
 const {queryIdentity}=useTelegram();
 const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
 const {params,set}=useMiniQueryState(),[page,setPage]=useMiniPage(),[selected,setSelected]=useState<Bid|null>(null),trigger=useRef<HTMLElement|null>(null);
 const requested=params.get('view'),view:View=requested==='live'||requested==='history'||requested==='all'?requested:initialView;
 const query=usePrivateQuery<Data>(`/api/my-bids?view=${view}&page=${page}`,{pollMs:30000,keepPreviousData:true}),data=query.data,busy=query.isPlaceholderData;
 const receipt=selected?(data?.items.find(item=>item.id===selected.id)??selected):null;
 const title=(bid:Bid)=>am?bid.auction.titleAm||bid.auction.title:bid.auction.title;
 const bidNumber=(bid:Bid)=>formatAuctionBid(bid.amount,bid.auction.ruleVersion).replace(/^ETB\s*/, '');
 const date=(value:string)=>new Date(value).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
 const summary=[{label:text('Total','ጠቅላላ'),value:data?(data.counts.total??data.counts.live+data.counts.history):undefined},{label:text('Active','በሂደት ላይ'),value:data?(data.counts.active??data.counts.live):undefined},{label:text('Won','ያሸነፉ'),value:data?.counts.won}];
 return <><OfflineRetry/><section className={styles.page} data-my-bids-ready={!!data&&!busy||undefined}>
  <header className={styles.heading}><Link href={rememberedMiniDestination(queryIdentity,'/')} className={styles.back} aria-label={text('Back to Home','ወደ መነሻ ይመለሱ')}><ArrowLeft size={20} aria-hidden="true"/></Link><h1><MiniPhrase en="My Bids" am="የእኔ ጨረታዎች"/></h1><span aria-hidden="true"/></header>
  <div className={styles.summary} data-my-bids-summary aria-label={text('Accepted bid summary','የተቀበሉ ጨረታዎች ማጠቃለያ')} aria-busy={!data&&query.status==='authenticated'}>{summary.map(item=><div key={item.label}><span>{item.label}</span><strong>{item.value??<span className={styles.skeleton} aria-label={text('Loading','በመጫን ላይ')}/>}</strong></div>)}</div>
  <div className={styles.tabs} role="group" aria-label={text('Bid status','የጨረታ ሁኔታ')}>{(['all','live','history'] as const).map(tab=><button type="button" key={tab} aria-pressed={view===tab} onClick={()=>{setSelected(null);set({view:tab==='all'?null:tab,page:null})}}>{tab==='all'?text('All','ሁሉም'):tab==='live'?text('Active','በሂደት ላይ'):text('History','ታሪክ')}</button>)}</div>
  {(data||query.error||!['loading','authenticated'].includes(query.status))&&<PrivateState query={query} variant="bids"/>}
  {query.status==='authenticated'&&!data&&!query.error&&<p className={styles.loading} role="status">{text('Loading your bids…','ጨረታዎችዎን በመጫን ላይ…')}</p>}
  {query.status==='authenticated'&&data&&<>
   {data.items.length===0?<div className={styles.empty}><Ticket size={26} aria-hidden="true"/><h2>{data.total>0?text('No bids on this page','በዚህ ገጽ ጨረታዎች የሉም'):view==='all'?text('Your first bid starts here','የመጀመሪያ ጨረታዎ ከዚህ ይጀምራል'):view==='live'?text('No active bids','በሂደት ላይ ያሉ ጨረታዎች የሉም'):text('No bid history yet','የጨረታ ታሪክ ገና የለም')}</h2><p>{text('Only accepted entries appear here. Payment attempts are listed separately in Bid payments.','እዚህ የሚታዩት የተቀበሉ ጨረታዎች ብቻ ናቸው። የክፍያ ሙከራዎች በ«የጨረታ ክፍያዎች» ይታያሉ።')}</p>{data.total>0?<button className={styles.action} onClick={()=>setPage(1)}>{text('First page','የመጀመሪያ ገጽ')}</button>:<Link className={styles.action} href="/auctions/all">{text('Explore auctions','ጨረታዎችን ይመልከቱ')}</Link>}</div>:<div className={styles.list} data-my-bids-list aria-busy={busy||query.fetching}>{data.items.map(item=><button className={styles.row} type="button" key={item.id} data-bid-id={item.id} disabled={busy} onClick={event=>{trigger.current=event.currentTarget;setSelected(item)}} aria-label={`${title(item)}, ${text('bid details','የጨረታ ዝርዝር')}`}><span className={styles.number} data-long={bidNumber(item).length>7||undefined} title={bidNumber(item)}>{bidNumber(item)}</span><span className={styles.rowBody}><span className={styles.rowTitle}>{title(item)}</span><span className={styles.statuses}><span className={styles.outcome} data-outcome={item.outcome}>{bidOutcomeLabel(item.outcome,am)}</span><span className={styles.payment} data-payment-status={paymentOf(item).status}>{paymentLabel(paymentOf(item).status,am)}</span>{item.auction.isDemo&&<span className={styles.payment}>DEMO</span>}</span><span className={styles.meta}><time dateTime={item.acceptedAt}>{date(item.acceptedAt)}</time> · {text('Fee','ክፍያ')} {formatEtb(item.feePoints)}</span><span className={styles.reference}>{shortId(item.id)}</span></span><ChevronRight className={styles.chevron} size={17} aria-hidden="true"/></button>)}</div>}
   {data.totalPages>1&&<nav className={styles.pagination} aria-label={text('Bid pages','የጨረታ ገጾች')}><button type="button" aria-label={text('Previous page','የቀድሞ ገጽ')} disabled={busy||data.page<=1} onClick={()=>{setSelected(null);setPage(data.page-1)}}><ChevronLeft size={18} aria-hidden="true"/></button><span>{data.page} / {data.totalPages}</span><button type="button" aria-label={text('Next page','ቀጣይ ገጽ')} disabled={busy||data.page>=data.totalPages} onClick={()=>{setSelected(null);setPage(data.page+1)}}><ChevronRight size={18} aria-hidden="true"/></button></nav>}
   {data.items.length>0&&<p className={styles.end} role="status">{text(`Showing ${(data.page-1)*20+1}–${Math.min(data.page*20,data.total)} of ${data.total}`,`${(data.page-1)*20+1}–${Math.min(data.page*20,data.total)} ከ ${data.total}`)}{data.page>=data.totalPages&&<> · {text('All bids loaded','ሁሉም ጨረታዎች ታይተዋል')}</>}</p>}
  </>}
  <Link className={styles.paymentLink} href="/payments">{text('Bid payments','የጨረታ ክፍያዎች')}<ChevronRight size={14} aria-hidden="true"/></Link>
 </section>{receipt&&query.status==='authenticated'&&<AccountSheet title={text('Bid details','የጨረታ ዝርዝር')} onClose={()=>setSelected(null)} returnFocusRef={trigger} footer={<Link className={styles.action} href={`/auctions/${receipt.auction.code}`} onClick={()=>setSelected(null)}>{text('View auction','ጨረታውን ይመልከቱ')}</Link>}>
  <div data-bid-receipt={receipt.id} className={styles.receipt}><h3>{title(receipt)}</h3><div className={styles.statuses}><span className={styles.outcome} data-outcome={receipt.outcome}>{bidOutcomeLabel(receipt.outcome,am)}</span><span className={styles.payment}>{paymentLabel(paymentOf(receipt).status,am)}</span></div><div className={styles.receiptAmount} data-long={bidNumber(receipt).length>8||undefined}>{bidNumber(receipt)}</div><p className={styles.caption}>{isSubmissionFeeOnly(receipt.auction.ruleVersion)?text('Your chosen number','የመረጡት ቁጥር'):text('Your bid amount','የጨረታዎ መጠን')}</p></div>
  <h4 className={styles.sectionTitle}>{text('Bid information','የጨረታ መረጃ')}</h4><dl className={styles.facts}><div><dt>{text('Bid ID','የጨረታ ግቤት መለያ')}</dt><dd>{receipt.id}</dd></div><div><dt>{text('Submitted on','የቀረበበት ቀን')}</dt><dd>{new Date(receipt.acceptedAt).toLocaleDateString(am?'am-ET':'en-ET',{day:'numeric',month:'short',year:'numeric',timeZone:'Africa/Addis_Ababa'})}</dd></div><div><dt>{text('Submitted at','የቀረበበት ሰዓት')}</dt><dd>{new Date(receipt.acceptedAt).toLocaleTimeString(am?'am-ET':'en-ET',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Africa/Addis_Ababa'})}</dd></div><div><dt>{text('Entry fee','የማስገቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.feePoints)}</dd></div>{etbToCents(receipt.feeRefunded)>0n&&<div><dt>{text('Fee refunded','የተመለሰ ክፍያ')}</dt><dd>{formatEtb(receipt.feeRefunded)}</dd></div>}<div><dt>{text('Auction ID','የጨረታ መለያ')}</dt><dd>{receipt.auction.code}</dd></div></dl>
  <h4 className={styles.sectionTitle}>{text('Payment information','የክፍያ መረጃ')}</h4><dl className={styles.facts}>{paymentMethod(paymentOf(receipt).method,am)&&<div><dt>{text('Method','መንገድ')}</dt><dd>{paymentMethod(paymentOf(receipt).method,am)}</dd></div>}<div><dt>{text('Payment status','የክፍያ ሁኔታ')}</dt><dd>{paymentOf(receipt).status==='PAID'?text('Paid at submission','ጨረታው ሲቀርብ ተከፍሏል'):paymentLabel(paymentOf(receipt).status,am)}</dd></div>{paymentOf(receipt).transactionRef&&<div><dt>{text('Transaction reference','የክፍያ መለያ')}</dt><dd>{paymentOf(receipt).transactionRef}</dd></div>}</dl>
  {isSubmissionFeeOnly(receipt.auction.ruleVersion)&&<p className={styles.notice}>{bidFeeNotice(paymentOf(receipt).status,am)}</p>}
  <div className={styles.sheetLinks}><Link href={receipt.outcome==='WON'?'/winning-bids':'/winners'} onClick={()=>setSelected(null)}>{receipt.outcome==='WON'?text('View my wins','ያሸነፍኳቸውን ይመልከቱ'):text('Winners','አሸናፊዎች')}</Link><Link href="/terms">{text('Terms','ውሎች')}</Link><Link href="/privacy">{text('Privacy','ግላዊነት')}</Link></div>
 </AccountSheet>}</>;
}
