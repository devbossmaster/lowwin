import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft,LockKeyhole } from 'lucide-react';
import { db } from '@/lib/db';
import { CatalogImage } from '@/components/catalog-image';
import { OfflineRetry } from '@/components/offline-retry';
import { getPublicResult } from '@/modules/auctions/results';
import {formatEtb} from '@/lib/money';
export default async function WinnerDetail({params}:{params:Promise<{auctionCode:string}>}) {
  const auction=await getPublicResult(db,(await params).auctionCode);if(!auction)notFound();
  const result=auction.result;
  const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  return <><OfflineRetry/><article className="page-inset"><Link className="back-link" href="/winners"><ArrowLeft size={16}/> All results</Link>{(result?.demoLabel||auction.isDemo)&&<div className="demo-label">{result?.demoLabel??'DEMO · result pending'}</div>}<h1 className="page-title">{auction.product.title}<span className="title-dot">.</span></h1><p className="page-lead">{auction.code}<br/>{result?'Closed':'Scheduled end'} {date(result?.closedAt??auction.endsAt)} EAT</p>
    <div className="result-hero"><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/></div>
    <div className="result-summary"><span>{result?.outcome==='WINNER'?'Lowest unique amount':'Auction outcome'}</span><strong>{!result?'Closing / result pending':result.outcome==='WINNER'?formatEtb(result.winningPoints!):result.outcome==='NO_WINNER'?'No winner':'Cancelled'}</strong>{result?.winnerDisplay&&<p>{result.winnerDisplay}</p>}<p>{result?.explanation??'Bidding has ended. A final result will appear after settlement completes; no winner has been announced.'}</p></div>
    {result?.source==='ILLUSTRATIVE'&&<p className="notice-card">DEMO example only. This record is illustrative and does not represent accepted bids, a real winner or a fulfilled prize.</p>}
    {result?.source==='SETTLED'&&result.isDemo&&<p className="notice-card">Settled from local DEMO test bids. No real prize will be dispatched.</p>}
    {result?.outcome==='WINNER'&&<section className="detail-section"><h2>Fulfillment pending</h2><p className="section-copy">{auction.isDemo?'This is a DEMO item. No shipment or prize fulfillment is recorded.':'The fulfillment workflow is not available yet. No shipment is recorded.'}</p></section>}
    {result&&<section className="detail-section"><h2>The lowest-unique rule</h2><p className="section-copy">At close, the smallest whole ETB amount accepted exactly once wins. If ETB 1.00 appears twice, ETB 2.00 once, ETB 3.00 twice and ETB 4.00 once, ETB 2.00 wins. This is a rule example, not a list of this auction’s bids.</p><p className="section-copy">A valid close releases unused holds and retains disclosed per-bid fees, including when there is no winner. Cancellation releases all holds and refunds charged entry fees.</p></section>}
    <div className="notice-card"><LockKeyhole size={18}/><span>Bidder identities and individual bid histories stay private. Winners are anonymous by default.</span></div><Link className="text-link" href={`/auctions/${auction.slug}`}>View auction terms</Link>
  </article></>;
}
