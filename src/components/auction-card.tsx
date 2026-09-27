import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {FavoriteButton} from './favorite-button';
import {formatEtb} from '@/lib/money';
export function AuctionCard({auction,serverNow,onFavoriteChanged}:{auction:CatalogAuction;serverNow?:string;onFavoriteChanged?:()=>void}){
 const detail=`/auctions/${auction.slug}`,closed=['closed','cancelled','closing'].includes(auction.status);
 return <article className="auction-card"><Link className="auction-card-art" href={detail} aria-label={`View ${auction.product.title}`}><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/>{auction.isDemo&&<span className="demo-ribbon">DEMO</span>}</Link>
  <div className="auction-card-body"><div className="card-kicker"><span>{auction.category.name}</span><span className={`status-tag status-${auction.status}`}>{auction.status==='closing'?'Result pending':auction.status}</span></div><h3><Link href={detail}>{auction.product.title}</Link></h3><p className="card-code">{auction.code}</p>
   <div className="card-facts"><span>Entry fee <strong>{formatEtb(auction.terms.entryFeePoints)}</strong></span><FavoriteButton slug={auction.slug} compact onChanged={onFavoriteChanged}/></div>
   <div className="card-timing">{!closed&&serverNow?<AuctionCountdown target={auction.status==='upcoming'?auction.startsAt:auction.endsAt} serverNow={serverNow} label={auction.status==='upcoming'?'Starts':'Ends'}/>:<span>{auction.status==='closing'?'Closing / result pending':closed?'Auction '+auction.status:`${auction.status==='upcoming'?'Starts':'Ends'} ${new Date(auction.status==='upcoming'?auction.startsAt:auction.endsAt).toLocaleDateString('en',{month:'short',day:'numeric'})}`}</span>}</div>
   <Link className={auction.status==='live'?'primary-button card-action':'secondary-button card-action'} href={closed?`/winners/${auction.code}`:detail+(auction.status==='live'?'#bid-review':'')}>{auction.status==='live'?'Place a bid':auction.status==='upcoming'?'View upcoming auction':auction.status==='closing'?'View pending result':'View result'}<ArrowUpRight size={17}/></Link>
  </div></article>;
}
