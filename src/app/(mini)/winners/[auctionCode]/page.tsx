import {AuctionRule,ResultExplanation} from '@/components/auction-rule';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft,LockKeyhole } from 'lucide-react';
import { db } from '@/lib/db';
import { CatalogImage } from '@/components/catalog-image';
import {WinnerCelebration} from '@/components/celebration';
import {MiniPhrase} from '@/components/mini-locale';
import { OfflineRetry } from '@/components/offline-retry';
import { getPublicResult } from '@/modules/auctions/results';
import {formatEtb} from '@/lib/money';
export default async function WinnerDetail({params}:{params:Promise<{auctionCode:string}>}) {
  const auction=await getPublicResult(db,(await params).auctionCode);if(!auction)notFound();
  const result=auction.result;
  const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  return <><OfflineRetry/>{result?.outcome==='WINNER'&&<WinnerCelebration id={`winner:${auction.code}`}/>}<article className="page-inset"><Link className="back-link" href="/winners"><ArrowLeft size={16}/> <MiniPhrase en="All results" am="ሁሉም ውጤቶች"/></Link>{(result?.demoLabel||auction.isDemo)&&<div className="demo-label">{result?.demoLabel??'DEMO · result pending'}</div>}<h1 className="page-title">{auction.product.title}<span className="title-dot">.</span></h1><p className="page-lead">{auction.code}<br/><MiniPhrase en={result?'Closed':'Scheduled end'} am={result?'ተዘግቷል':'የታቀደ መጨረሻ'}/> {date(result?.closedAt??auction.endsAt)} EAT</p>
    <div className="result-hero"><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/></div>
    <div className="result-summary"><span><MiniPhrase en={result?.outcome==='WINNER'?(result.decision==='FIRST_ACCEPTED_LOWEST'?'First accepted lowest amount':'Lowest unique amount'):'Auction outcome'} am={result?.outcome==='WINNER'?'ዝቅተኛው ልዩ መጠን':'የጨረታ ውጤት'}/></span><strong><MiniPhrase en={!result?'Closing / result pending':result.outcome==='WINNER'?formatEtb(result.winningPoints!):result.outcome==='NO_WINNER'?'No winner':'Cancelled'} am={!result?'ውጤት በመጠባበቅ ላይ':result.outcome==='WINNER'?formatEtb(result.winningPoints!):result.outcome==='NO_WINNER'?'አሸናፊ የለም':'ተሰርዟል'}/></strong>{result?.winnerDisplay&&<p>{result.winnerDisplay}</p>}<p>{(result?.source==='SETTLED'?<ResultExplanation outcome={result.outcome} decision={result.decision}/>:result?.explanation)??<MiniPhrase en="Bidding has ended. A final result will appear after settlement completes; no winner has been announced." am="ጨረታው አብቅቷል። መጨረሻው ውጤት ከማስተካከያው በኋላ ይታያል፤ አሸናፊ ገና አልተገለጸም።"/>}</p></div>
    {result?.source==='ILLUSTRATIVE'&&<p className="notice-card"><MiniPhrase en="DEMO example only. This record is illustrative and does not represent accepted bids, a real winner or a fulfilled prize." am="የDEMO ምሳሌ ብቻ ነው። ይህ መዝገብ የተቀበሉ ጨረታዎችን፣ እውነተኛ አሸናፊን ወይም የተሰጠ ሽልማትን አይወክልም።"/></p>}
    {result?.source==='SETTLED'&&result.isDemo&&<p className="notice-card"><MiniPhrase en="Settled from local DEMO test bids. No real prize will be dispatched." am="ከአካባቢያዊ DEMO የሙከራ ጨረታዎች የተወሰነ ውጤት ነው። እውነተኛ ሽልማት አይላክም።"/></p>}
    {result?.outcome==='WINNER'&&<section className="detail-section"><h2><MiniPhrase en="Fulfillment pending" am="ርክክብ በመጠባበቅ ላይ"/></h2><p className="section-copy"><MiniPhrase en={auction.isDemo?'This is a DEMO item. No shipment or prize fulfillment is recorded.':'The fulfillment workflow is not available yet. No shipment is recorded.'} am={auction.isDemo?'ይህ የDEMO ዕቃ ነው። ምንም የማጓጓዣ ወይም የሽልማት ርክክብ አልተመዘገበም።':'የርክክብ ሂደቱ ገና አይገኝም። ምንም ማጓጓዣ አልተመዘገበም።'}/></p></section>}
    {result&&<section className="detail-section"><AuctionRule ruleVersion={auction.terms.ruleVersion}/></section>}
    <div className="notice-card"><LockKeyhole size={18}/><span><MiniPhrase en="Bidder identities and individual bid histories stay private. Winners are anonymous by default." am="የተሳታፊዎች ማንነት እና የግል ጨረታ ታሪክ የግል ናቸው። አሸናፊዎች በነባሪነት ማንነታቸው አይገለጽም።"/></span></div><Link className="text-link" href={`/auctions/${auction.slug}`}><MiniPhrase en="View auction terms" am="የጨረታ ውሎችን ይመልከቱ"/></Link>
  </article></>;
}
