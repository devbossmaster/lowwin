'use client';
import Link from 'next/link';
import {useRef} from 'react';
import {ArrowUpRight,Eye} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {FavoriteButton} from './favorite-button';
import {formatEtb} from '@/lib/money';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
export function AuctionCard({auction:initialAuction,serverNow,onFavoriteChanged}:{auction:CatalogAuction;serverNow?:string;onFavoriteChanged?:()=>void}){
 const ref=useRef<HTMLElement>(null),{activity,views,refreshActivity}=useAuctionActivity(initialAuction.code,{element:ref,record:true});
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...initialAuction,status:activity?.status??initialAuction.status,viewCount:views??initialAuction.viewCount};
 const {language}=useMiniLocale(),am=language==='am';
 const detail=`/auctions/${auction.code}`,closed=['closed','cancelled','closing'].includes(auction.status),title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const statusText={live:am?'በሂደት ላይ':'live',upcoming:am?'የሚመጣ':'upcoming',closing:am?'ጨረታው አብቋል':'Auction ended',closed:am?'የተዘጋ':'closed',cancelled:am?'የተሰረዘ':'cancelled'}[auction.status];
 const action=auction.status==='live'?(am?'ጨረታ ያቅርቡ':'Place a bid'):auction.status==='upcoming'?(am?'የሚመጣውን ጨረታ ይመልከቱ':'View upcoming auction'):auction.status==='closing'?(am?'ውጤቱን ይመልከቱ':'View result'):(am?'ውጤትን ይመልከቱ':'View result');
 return <article className="auction-card" ref={ref}><Link className="auction-card-art" href={detail} aria-label={`${am?'ይመልከቱ':'View'} ${title}`}><CatalogImage src={auction.product.images[0]?.path} alt={title}/><span className="auction-view-badge" aria-label={`${auction.viewCount} ${am?'እይታዎች':'views'}`}><Eye size={16} aria-hidden="true"/>{new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(BigInt(auction.viewCount))}</span>{auction.isDemo&&<span className="demo-ribbon">DEMO</span>}</Link>
  <div className="auction-card-body"><div className="card-kicker"><span><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></span><span className={`status-tag status-${auction.status}`}>{statusText}</span></div><h3><Link href={detail}>{title}</Link></h3><p className="card-code">{auction.code}</p>
   <div className="card-facts"><span>{am?'የመግቢያ ክፍያ':'Entry fee'} <strong>{formatEtb(auction.terms.entryFeePoints)}</strong></span><FavoriteButton slug={auction.slug} compact onChanged={onFavoriteChanged}/></div>
   <div className="card-timing">{!closed&&serverNow?<AuctionCountdown target={auction.status==='upcoming'?auction.startsAt:auction.endsAt} serverNow={serverNow} label={auction.status==='upcoming'?'Starts':'Ends'} onElapsed={refreshActivity}/>:<span>{auction.status==='closing'?(am?'ጨረታው አብቋል':'Auction ended'):closed?`${am?'ጨረታ':'Auction'} ${statusText}`:`${auction.status==='upcoming'?(am?'ይጀምራል':'Starts'):(am?'ያበቃል':'Ends')} ${new Date(auction.status==='upcoming'?auction.startsAt:auction.endsAt).toLocaleDateString(am?'am-ET':'en',{month:'short',day:'numeric'})}`}</span>}</div>
   <Link className={auction.status==='live'?'primary-button card-action':'secondary-button card-action'} href={closed?`/auctions/${auction.code}`:detail+(auction.status==='live'?'#bid-review':'')}>{action}<ArrowUpRight size={17}/></Link>
  </div></article>;
}
