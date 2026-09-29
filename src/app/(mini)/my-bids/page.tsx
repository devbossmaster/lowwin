'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {useState} from 'react';
import Link from 'next/link';
import {ChevronLeft,ChevronRight,Eye,Gavel,Tag,Ticket} from 'lucide-react';
import {CatalogImage} from '@/components/catalog-image';
import {usePrivateQuery,PrivateState} from '@/components/private-query';
import {OfflineRetry} from '@/components/offline-retry';
import type {getPersonalBids} from '@/modules/profile/personal';
import {formatEtb} from '@/lib/money';
import styles from './my-bids.module.css';

type BidList=Awaited<ReturnType<typeof getPersonalBids>>;
const compactNumber=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});

export default function MyBids(){
 const w=useWalletCopy();
  const [view,setView]=useState<'live'|'history'>('live');
  const [page,setPage]=useState(1);
  const query=usePrivateQuery<BidList>(`/api/my-bids?view=${view}&page=${page}`);
  const data=query.data;
  const pageCount=data?.totalPages??0;
  const pageStart=Math.max(1,Math.min(page-1,pageCount-3));
  const pages=Array.from({length:Math.min(4,pageCount)},(_,index)=>pageStart+index);

  return <><OfflineRetry/><section className={styles.page}>
    <header className={styles.heading}><h1>{w("My Bids")}</h1></header>
    <div className={styles.tabs} role="group" aria-label="My bids category">
      {(['live','history'] as const).map(tab=><button type="button" key={tab} aria-pressed={view===tab} onClick={()=>{setView(tab);setPage(1)}}>
        {w(tab==='live'?'Live':'History')}{data&&<span>{data.counts[tab]}</span>}
      </button>)}
    </div>
    <PrivateState query={query}/>
    {query.status==='authenticated'&&data&&<>
      {data.items.length===0?<div className={styles.empty}><h2>{w(view==='live'?'No live bids yet':'No bid history yet')}</h2><p>{w(view==='live'?'Your bids in open auctions will appear here.':'Your bids in ended auctions will appear here.')}</p><Link href="/auctions/all">{w("Browse auctions")}</Link></div>:<div className={styles.list}>
        {data.items.map(item=>{
          const live=item.outcome==='LIVE';
          const href=live?`/auctions/${item.auction.slug}`:`/winners/${item.auction.code}`;
          const ticket=`BID_${item.id.replaceAll('-','').toUpperCase()}`;
          return <Link key={item.id} href={href} className={styles.card} aria-label={`${live?'View live auction':'View auction result'}: ${item.auction.title}, your bid ${formatEtb(item.amount)}`}>
            <div className={styles.visual}>
              <CatalogImage src={item.auction.image?.path} alt={item.auction.image?.alt??item.auction.title}/>
              <span className={`${styles.status} ${live?styles.live:styles.closed}`}>{w(live?'Live':'Closed')}</span>
              <span className={styles.views} aria-label={`${item.auction.views} views`}><Eye size={16} aria-hidden="true"/>{compactNumber.format(BigInt(item.auction.views))}</span>
              <span className={styles.ticket} title={ticket}><Ticket size={13} aria-hidden="true"/><span>{ticket}</span></span>
              {item.auction.isDemo&&<span className={styles.demo}>DEMO</span>}
            </div>
            <div className={styles.body}>
              <h2>{item.auction.title}</h2>{!live&&<p>{w(item.outcome==='WON'?'Won':item.outcome==='LOST'?'Lost':item.outcome==='CANCELLED'?'Cancelled':item.outcome==='PENDING'?'Result pending':'No winner')}{item.decision==='FIRST_ACCEPTED_LOWEST'&&<> / {w('First accepted lowest amount')}</>}{item.decision==='MINIMUM_PARTICIPANTS'&&<> / {w('Participant minimum not met')}</>}{item.outcome==='CANCELLED'&&<> / {w('All entry fees refunded')}</>}</p>}
              <div className={styles.facts}>
                <div><Gavel size={25} aria-hidden="true"/><span><small>{w("Bid placed amount")}</small><strong>{formatEtb(item.amount)}</strong></span></div>
                <div><Tag size={25} aria-hidden="true"/><span><small>{w("Auction code")}</small><strong>{item.auction.code}</strong></span></div>
              </div>
            </div>
          </Link>;
        })}
      </div>}
      {pageCount>1&&<nav className={styles.pagination} aria-label="Bid pages">
        <button type="button" aria-label={w("Previous page")} disabled={page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={18}/></button>
        {pages.map(number=><button type="button" key={number} aria-label={`Page ${number}`} aria-current={page===number?'page':undefined} onClick={()=>setPage(number)}>{number}</button>)}
        <button type="button" aria-label={w("Next page")} disabled={page===pageCount} onClick={()=>setPage(page+1)}><ChevronRight size={18}/></button>
      </nav>}
    </>}
  </section></>;
}
