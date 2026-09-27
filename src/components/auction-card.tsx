import Link from 'next/link';
import { ArrowUpRight, Clock3 } from 'lucide-react';
import type { CatalogAuction } from '@/modules/auctions/catalog';
import { CatalogImage } from './catalog-image';
export function AuctionCard({auction}:{auction:CatalogAuction}) {
  return <Link className="auction-card" href={`/auctions/${auction.slug}`}>
    <div className="auction-card-art"><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/>{auction.isDemo&&<span className="demo-ribbon">DEMO</span>}</div>
    <div className="auction-card-body"><div className="card-kicker"><span>{auction.category.name}</span><span className={`status-tag status-${auction.status}`}>{auction.status==='closing'?'Closing / result pending':auction.status}</span></div>
      <h3>{auction.product.title}</h3><p className="card-code">{auction.code}</p>
      <div className="card-foot"><span><Clock3 size={14}/>{auction.status==='cancelled'?'Cancelled':<>{auction.status==='closed'?'Closed':auction.status==='closing'?'Ended':auction.status==='upcoming'?'Starts':'Ends'} {new Date(auction.status==='upcoming'?auction.startsAt:auction.endsAt).toLocaleDateString('en',{month:'short',day:'numeric'})}</>}</span><ArrowUpRight size={18}/></div>
    </div>
  </Link>;
}
