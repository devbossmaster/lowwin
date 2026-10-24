'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {ChevronRight,Ticket} from 'lucide-react';
import {BidPagination} from './bid-pagination';
import {usePrivateQuery,PrivateState} from './private-query';
import {OfflineRetry} from './offline-retry';
import type {getPersonalBids} from '@/modules/profile/personal';
import {useMiniPage,useMiniQueryState} from './mini-query-state';
import {MiniRouteSkeleton} from './mini-route-skeleton';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {formatAuctionBid,formatEtb,etbToCents} from '@/lib/money';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import styles from './account-pages.module.css';
import {useTelegram} from './telegram-provider';

const AccountSheet=dynamic(()=>import('./account-sheet').then(module=>module.AccountSheet));
type Data=Awaited<ReturnType<typeof getPersonalBids>>;
type Bid=Data['items'][number];
function bidStatus(outcome:string,am:boolean){
  const copy:Record<string,[string,string]>={LIVE:['Active','በሂደት ላይ'],PENDING:['Result pending','ውጤት በመጠባበቅ ላይ'],WON:['Won','አሸንፈዋል'],LOST:['Not won','አላሸነፈም'],CANCELLED:['Cancelled','ተሰርዟል'],NO_WINNER:['No winner','አሸናፊ የለም']};
  return (copy[outcome]??['Result pending','ውጤት በመጠባበቅ ላይ'])[am?1:0];
}
export function MyBidsPage({initialView='live'}:{initialView?:'live'|'history'}){
  const {queryIdentity}=useTelegram();
  return <PlayerBids key={queryIdentity??'guest'} initialView={initialView}/>;
}
function PlayerBids({initialView}:{initialView:'live'|'history'}){
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const {params,set}=useMiniQueryState(),[page,setPage]=useMiniPage(),[selected,setSelected]=useState<Bid|null>(null);
  const view=params.get('view')==='history'?'history':params.has('view')?'live':initialView;
  const query=usePrivateQuery<Data>(`/api/my-bids?view=${view}&page=${page}`,{pollMs:30000}),data=query.data;
  const receipt=selected?(data?.items.find(item=>item.id===selected.id)??selected):null;
  const date=(value:string)=>new Date(value).toLocaleString(am?'am-ET':'en',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
  if(query.status==='loading'||query.status==='authenticated'&&!data&&!query.error)return <MiniRouteSkeleton/>;
  return <><OfflineRetry/><section className={styles.page}>
    <header className={styles.heading}><h1><MiniPhrase en="My Bids" am="የእኔ ጨረታዎች"/></h1><p><MiniPhrase en="Your entries, receipts and results." am="ያቀረቧቸው ጨረታዎች፣ ደረሰኞች እና ውጤቶች።"/></p></header>
    {data&&<div className={styles.summary}><div><span>{text('Total','ጠቅላላ')}</span><strong>{data.counts.live+data.counts.history}</strong></div><div><span>{text('Active','በሂደት ላይ')}</span><strong>{data.counts.live}</strong></div><div><span>{text('History','ታሪክ')}</span><strong>{data.counts.history}</strong></div></div>}
    <div className={styles.tabs} role="group" aria-label={text('Bid status','የጨረታ ሁኔታ')}>{(['live','history'] as const).map(tab=><button type="button" key={tab} aria-pressed={view===tab} onClick={()=>{setSelected(null);set({view:tab,page:null})}}>{tab==='live'?text('Active','በሂደት ላይ'):text('History','ታሪክ')}</button>)}</div>
    <PrivateState query={query} variant="bids"/>{query.status==='authenticated'&&data&&<>
      {data.items.length===0?<div className={styles.empty}><Ticket size={28} aria-hidden="true"/><h2>{view==='live'?text('Your next entry starts here','ቀጣዩ ጨረታዎ ከዚህ ይጀምራል'):text('No bid history yet','የጨረታ ታሪክ ገና የለም')}</h2><p>{view==='live'?text('Accepted bids in open auctions will appear here.','በክፍት ጨረታዎች የተቀበሉ ጨረታዎችዎ እዚህ ይታያሉ።'):text('Ended auctions and their final results will appear here.','ያለቁ ጨረታዎች እና ውጤቶቻቸው እዚህ ይታያሉ።')}</p><Link className={styles.action} href="/auctions/all">{text('Explore auctions','ጨረታዎችን ይመልከቱ')}</Link></div>:<div className={styles.list}>{data.items.map(item=><button className={styles.bidRow} type="button" key={item.id} onClick={()=>setSelected(item)} aria-label={`${am?item.auction.titleAm||item.auction.title:item.auction.title}, ${text('bid details','የጨረታ ዝርዝር')}`}><span className={styles.bidNumber}>{formatAuctionBid(item.amount,item.auction.ruleVersion).replace(/^ETB\s*/, '')}</span><span className={styles.rowBody}><span className={styles.rowTitle}>{am?item.auction.titleAm||item.auction.title:item.auction.title}</span><span className={styles.rowMeta}>{date(item.acceptedAt)} · {text('Fee','ክፍያ')} {formatEtb(item.feePoints)}</span><span className={styles.rowStatus}><span className={`${styles.pill} ${item.outcome==='WON'?styles.gold:''}`}>{bidStatus(item.outcome,am)}</span>{item.auction.isDemo&&<span className={styles.pill}>DEMO</span>}<span>{text('View receipt','ደረሰኝ ይመልከቱ')}</span></span></span><ChevronRight className={styles.rowChevron} size={17} aria-hidden="true"/></button>)}</div>}
      <BidPagination page={page} totalPages={data.totalPages} onPage={setPage}/>
    </>}
  </section>{receipt&&query.status==='authenticated'&&<AccountSheet title={text('Bid details','የጨረታ ዝርዝር')} onClose={()=>setSelected(null)} footer={<Link className={styles.action} href={`/auctions/${receipt.auction.code}`} onClick={()=>setSelected(null)}>{text('View auction','ጨረታውን ይመልከቱ')}</Link>}>
    <div className={styles.receiptTitle}><h3>{am?receipt.auction.titleAm||receipt.auction.title:receipt.auction.title}</h3><span className={`${styles.pill} ${receipt.outcome==='WON'?styles.gold:''}`}>{bidStatus(receipt.outcome,am)}</span><div className={styles.receiptNumber}>{formatAuctionBid(receipt.amount,receipt.auction.ruleVersion).replace(/^ETB\s*/, '')}</div><p className={styles.caption}>{isSubmissionFeeOnly(receipt.auction.ruleVersion)?text('Your chosen number','የመረጡት ቁጥር'):text('Your bid amount','የጨረታዎ መጠን')}</p></div>
    <dl className={styles.facts}><div><dt>{text('Accepted','የተቀበለበት')}</dt><dd>{date(receipt.acceptedAt)}</dd></div><div><dt>{text('Submission fee paid','የተከፈለ የማቅረቢያ ክፍያ')}</dt><dd>{formatEtb(receipt.feePoints)}</dd></div>{etbToCents(receipt.feeRefunded)>0n&&<div><dt>{text('Fee refunded','የተመለሰ ክፍያ')}</dt><dd>{formatEtb(receipt.feeRefunded)}</dd></div>}<div><dt>{text('Auction','ጨረታ')}</dt><dd>{receipt.auction.code}</dd></div><div><dt>{text('Receipt ID','የደረሰኝ መለያ')}</dt><dd>{receipt.id}</dd></div>{receipt.closedAt&&<div><dt>{text('Finalized','የተጠናቀቀበት')}</dt><dd>{date(receipt.closedAt)}</dd></div>}<div><dt>{text('Rules version','የደንብ ስሪት')}</dt><dd>{receipt.auction.ruleVersion??'—'}</dd></div></dl>
    {isSubmissionFeeOnly(receipt.auction.ruleVersion)&&<p className={styles.notice}>{text('Only the disclosed submission fee was paid. Your chosen number is not money charged or reserved.','የተገለጸው የማቅረቢያ ክፍያ ብቻ ተከፍሏል። የመረጡት ቁጥር የሚከፈል ወይም የሚያዝ ገንዘብ አይደለም።')}</p>}
    <div className={styles.sheetLinks}><Link href={receipt.outcome==='WON'?'/winning-bids':'/draws'} onClick={()=>setSelected(null)}>{receipt.outcome==='WON'?text('View my wins','ያሸነፍኳቸውን ይመልከቱ'):text('Draws and results','ውጤቶች እና ጨረታዎች')}</Link><Link href="/payments" onClick={()=>setSelected(null)}>{text('Payment history','የክፍያ ታሪክ')}</Link><Link href="/terms">{text('Terms','ውሎች')}</Link><Link href="/privacy">{text('Privacy','ግላዊነት')}</Link></div>
  </AccountSheet>}</>;
}
