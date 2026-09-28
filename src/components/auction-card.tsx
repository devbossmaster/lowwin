'use client';
import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {FavoriteButton} from './favorite-button';
import {formatEtb} from '@/lib/money';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
export function AuctionCard({auction,serverNow,onFavoriteChanged}:{auction:CatalogAuction;serverNow?:string;onFavoriteChanged?:()=>void}){
 const {language}=useMiniLocale(),am=language==='am';
 const detail=`/auctions/${auction.slug}`,closed=['closed','cancelled','closing'].includes(auction.status);
 const statusText={live:am?'በሂደት ላይ':'live',upcoming:am?'የሚመጣ':'upcoming',closing:am?'ውጤት በመጠባበቅ ላይ':'Result pending',closed:am?'የተዘጋ':'closed',cancelled:am?'የተሰረዘ':'cancelled'}[auction.status];
 const action=auction.status==='live'?(am?'ጨረታ ያቅርቡ':'Place a bid'):auction.status==='upcoming'?(am?'የሚመጣውን ጨረታ ይመልከቱ':'View upcoming auction'):auction.status==='closing'?(am?'በመጠባበቅ ላይ ያለውን ውጤት ይመልከቱ':'View pending result'):(am?'ውጤትን ይመልከቱ':'View result');
 return <article className="auction-card"><Link className="auction-card-art" href={detail} aria-label={`${am?'ይመልከቱ':'View'} ${auction.product.title}`}><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/>{auction.isDemo&&<span className="demo-ribbon">DEMO</span>}</Link>
  <div className="auction-card-body"><div className="card-kicker"><span><MiniCategoryName slug={auction.category.slug} name={auction.category.name}/></span><span className={`status-tag status-${auction.status}`}>{statusText}</span></div><h3><Link href={detail}>{auction.product.title}</Link></h3><p className="card-code">{auction.code}</p>
   <div className="card-facts"><span>{am?'የመግቢያ ክፍያ':'Entry fee'} <strong>{formatEtb(auction.terms.entryFeePoints)}</strong></span><FavoriteButton slug={auction.slug} compact onChanged={onFavoriteChanged}/></div>
   <div className="card-timing">{!closed&&serverNow?<AuctionCountdown target={auction.status==='upcoming'?auction.startsAt:auction.endsAt} serverNow={serverNow} label={auction.status==='upcoming'?'Starts':'Ends'}/>:<span>{auction.status==='closing'?(am?'ውጤት በመጠባበቅ ላይ':'Closing / result pending'):closed?`${am?'ጨረታ':'Auction'} ${statusText}`:`${auction.status==='upcoming'?(am?'ይጀምራል':'Starts'):(am?'ያበቃል':'Ends')} ${new Date(auction.status==='upcoming'?auction.startsAt:auction.endsAt).toLocaleDateString(am?'am-ET':'en',{month:'short',day:'numeric'})}`}</span>}</div>
   <Link className={auction.status==='live'?'primary-button card-action':'secondary-button card-action'} href={closed?`/winners/${auction.code}`:detail+(auction.status==='live'?'#bid-review':'')}>{action}<ArrowUpRight size={17}/></Link>
  </div></article>;
}
