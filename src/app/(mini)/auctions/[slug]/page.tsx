import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft,CalendarDays,MapPin } from 'lucide-react';
import { CatalogImage } from '@/components/catalog-image';
import { AuctionCountdown } from '@/components/auction-countdown';
import { OfflineRetry } from '@/components/offline-retry';
import { BidForm } from '@/components/bid-form';
import { FavoriteButton } from '@/components/favorite-button';
import { getAuction,serverNow } from '@/modules/auctions/catalog';
export default async function AuctionPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params,now=await serverNow(),auction=await getAuction(slug,now);if(!auction)notFound();
  const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  return <><OfflineRetry/><article className="auction-detail"><div className="detail-top"><Link className="back-link" href="/auctions"><ArrowLeft size={17}/> Auctions</Link><span className={`status-tag status-${auction.status}`}>{auction.status==='closing'?'Closing / result pending':auction.status}</span></div>
    <div className="detail-gallery"><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/>{auction.isDemo&&<span className="demo-ribbon">DEMO ITEM</span>}</div>
    {auction.product.images.length>1&&<div className="gallery-thumbs">{auction.product.images.slice(1).map(image=><CatalogImage key={image.path} src={image.path} alt={image.alt}/>)}</div>}
    <div className="page-inset detail-content"><Link className="eyebrow category-link" href={`/categories/${auction.category.slug}`}>{auction.category.name}</Link><h1 className="page-title">{auction.product.title}</h1><p className="detail-code">Auction code {auction.code}</p><p className="page-lead">{auction.product.description}</p>
      <div className="countdown-panel"><span>{auction.status==='closing'?'Closing / result pending':auction.status==='cancelled'?'Cancelled auction':auction.status==='closed'?'Closed auction':auction.status==='upcoming'?'Opening soon':auction.isDemo?'Open demo auction':'Open auction'}</span>{auction.status==='closing'?<strong>Bidding ended. Settlement is pending.</strong>:auction.status==='cancelled'?<strong>Holds and entry fees returned</strong>:auction.status==='closed'?<strong>Closed {date(auction.endsAt)}</strong>:<AuctionCountdown target={auction.status==='upcoming'?auction.startsAt:auction.endsAt} serverNow={now.toISOString()} label={auction.status==='upcoming'?'Starts':'Ends'}/>}</div>
      <section className="detail-section"><h2>Item & delivery</h2><dl className="term-list"><div><dt>Condition</dt><dd>{auction.product.condition}</dd></div><div><dt>Fulfillment region</dt><dd>{auction.fulfillment.region}</dd></div><div><dt>Fulfillment</dt><dd>{auction.fulfillment.summary}</dd></div></dl></section>
      <section className="detail-section"><h2>Auction terms</h2><dl className="term-list"><div><dt><CalendarDays size={16}/> Starts</dt><dd>{date(auction.startsAt)} EAT</dd></div><div><dt><CalendarDays size={16}/> Ends</dt><dd>{date(auction.endsAt)} EAT</dd></div><div><dt>Allowed point bid</dt><dd>{auction.terms.minPoints}–{auction.terms.maxPoints} pts</dd></div><div><dt>Step</dt><dd>{auction.terms.stepPoints} pt</dd></div><div><dt>Entry fee per accepted bid</dt><dd>{auction.terms.entryFeePoints} pts</dd></div><div><dt>Distinct bids per person</dt><dd>Up to {auction.terms.maxDistinctBids}</dd></div></dl><p className="term-note">Terms v{auction.terms.version} · {auction.terms.ruleVersion}</p></section>
      <section className="detail-section rule-box"><h2>How a winner is found</h2><p>At close, the lowest point amount chosen by exactly one bidder wins. Example: if 1 point appears twice, 2 once, 3 twice and 4 once, 2 points wins. Live amounts and uniqueness are private.</p><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p></section>
      <FavoriteButton slug={auction.slug}/>
      {auction.result&&<section className="detail-section result-box">{auction.result.demoLabel&&<span className="demo-label">{auction.result.demoLabel}</span>}<h2>{auction.result.outcome==='WINNER'?`${auction.result.winningPoints} points · lowest unique`:auction.result.outcome==='NO_WINNER'?'No winner':'Cancelled'}</h2><p>{auction.result.explanation}</p><Link href={`/winners/${auction.code}`}>View result</Link></section>}
      {auction.status==='closing'&&<Link className="text-link" href={`/winners/${auction.code}`}>View pending outcome</Link>}
      <BidForm slug={auction.slug} status={auction.status} isDemo={auction.isDemo}/>
      <p className="detail-privacy"><MapPin size={15}/> Fulfillment details must be confirmed for any future real listing.</p>
    </div></article></>;
}
