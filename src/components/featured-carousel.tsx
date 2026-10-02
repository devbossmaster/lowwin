'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,ChevronLeft,ChevronRight,Clock3,Eye,Gavel,Tag} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {FavoriteButton} from './favorite-button';
import {AuctionCountdown} from './auction-countdown';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
import {formatEtb} from '@/lib/money';
import {FeaturedBid} from './featured-bid';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
import styles from './featured-carousel.module.css';

type Variant='featured'|'ending'|'live'|'upcoming';
export function FeaturedCarousel({items,serverNow,variant='featured'}:{items:CatalogAuction[];serverNow:string;variant?:Variant}){
 const {language}=useMiniLocale(),am=language==='am',ending=variant==='ending';
 const names={featured:[am?'ተለይተው የቀረቡ ጨረታዎች':'Featured auctions',am?'የቀድሞው ጨረታ':'Previous featured auction',am?'ቀጣዩ ጨረታ':'Next featured auction'],ending:[am?'በቅርቡ የሚያበቁ ጨረታዎች':'Ending soon auctions',am?'የቀድሞው ጨረታ':'Previous ending auction',am?'ቀጣዩ ጨረታ':'Next ending auction'],live:[am?'በሂደት ላይ ያሉ ጨረታዎች':'Live auctions',am?'የቀድሞው ጨረታ':'Previous live auction',am?'ቀጣዩ ጨረታ':'Next live auction'],upcoming:[am?'የሚመጡ ጨረታዎች':'Upcoming auctions',am?'የቀድሞው ጨረታ':'Previous upcoming auction',am?'ቀጣዩ ጨረታ':'Next upcoming auction']}[variant];
 const [index,setIndex]=useState(0),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[touching,setTouching]=useState(false),[bidding,setBidding]=useState(false),[visible,setVisible]=useState(true),[reduced,setReduced]=useState(true);
 const active=hovered||focused||touching||bidding,ref=useRef<HTMLDivElement>(null),start=useRef<number|null>(null);
 const item=items[index%items.length];
 const {activity,views,refreshActivity}=useAuctionActivity(item?.code??'',{element:ref,record:true});
 useAuctionRefresh(activity,item?.status,Boolean(item?.result));
 useEffect(()=>{const motion=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(motion.matches);update();motion.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));if(ref.current)observer.observe(ref.current);return()=>{motion.removeEventListener('change',update);observer.disconnect()}},[]);
 useEffect(()=>{if(items.length<2||active||!visible||reduced)return;const tick=window.setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length)},4000);return()=>clearInterval(tick)},[items.length,active,visible,reduced]);
 if(!items.length)return null;
 const title=am?(item.product.titleAm?.trim()||item.product.title):item.product.title,move=(delta:number)=>{if(!bidding)setIndex(i=>(i+delta+items.length)%items.length)};
 const status=activity?.status??item.status,isUpcoming=status==='upcoming',isLive=status==='live';
 return <div className={`${styles.carousel} featured-carousel ${ending?'ending-carousel':''}`} ref={ref} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false)}} onTouchStart={event=>{if((event.target as HTMLElement).closest('input,button,dialog,a'))return;start.current=event.touches[0].clientX;setTouching(true)}} onTouchEnd={event=>{if(start.current!==null){const distance=event.changedTouches[0].clientX-start.current;if(Math.abs(distance)>40)move(distance<0?1:-1)}start.current=null;setTouching(false)}} onTouchCancel={()=>{start.current=null;setTouching(false)}} aria-label={names[0]}>
  {items.length>1&&<div className={styles.toolbar}><span>{index+1} / {items.length}</span><div><button disabled={bidding} aria-label={names[1]} onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button disabled={bidding} aria-label={names[2]} onClick={()=>move(1)}><ChevronRight size={18}/></button></div></div>}
  <article className={styles.card} key={item.code}>
   <div className={styles.visual}><Link href={`/auctions/${item.code}`} aria-label={`${am?'ጨረታውን ይመልከቱ':'View auction'} ${title}`}><CatalogImage src={item.product.images[0]?.path} alt={title}/></Link><span className={`${styles.live} ${isUpcoming?styles.upcoming:''}`}><span aria-hidden="true"/>{isUpcoming?(am?'የሚመጣ':'Upcoming'):isLive?(am?'በሂደት ላይ':'Live'):(am?'አብቋል':'Ended')}</span><span className={styles.views} aria-label={`${views??item.viewCount} ${am?'እይታዎች':'views'}`}><Eye size={16} aria-hidden="true"/>{new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(BigInt(views??item.viewCount))}</span>{item.isDemo&&<span className={styles.demo}>DEMO</span>}<div className={styles.favorite}><FavoriteButton slug={item.slug} compact/></div></div>
   <div className={styles.body}><span className={styles.category}><MiniCategoryName slug={item.category.slug} name={item.category.name} nameAm={item.category.nameAm}/></span><h3><Link href={`/auctions/${item.code}`}>{title}</Link></h3><div className={styles.facts}><div><Gavel size={17} aria-hidden="true"/><span>{Number(item.terms.entryFeePoints)>0?(am?'የመግቢያ ክፍያ':'Entry fee'):(am?'ተጨማሪ ክፍያ የለም':'No extra fee')}<strong>{Number(item.terms.entryFeePoints)>0?formatEtb(item.terms.entryFeePoints):''}</strong></span></div><div><Tag size={17} aria-hidden="true"/><span>{am?'የጨረታ ኮድ':'Auction code'}<strong>{item.code}</strong></span></div></div><div className={styles.timing}><span><Clock3 size={17} aria-hidden="true"/>{isLive||isUpcoming?<AuctionCountdown target={isUpcoming?item.startsAt:item.endsAt} serverNow={serverNow} label={isUpcoming?'Starts':'Ends'} onElapsed={refreshActivity}/>:<span>{am?'ጨረታው አብቋል':'Auction ended'}</span>}</span><strong className={styles.bidCount}>{activity?.bids??item.bidCount} {am?'ጨረታ':'bids'}</strong></div>{isUpcoming?<div className={styles.upcomingNotice}>{am?'ጨረታው ሲከፈት መጫረት ይችላሉ።':'Bidding opens when the auction starts.'}</div>:isLive?<FeaturedBid key={item.slug} slug={item.slug} title={title} onInteractionChange={setBidding}/>:null}<Link className={styles.action} href={`/auctions/${item.code}${isLive?'#bid-review':''}`}>{isUpcoming?(am?'የሚመጣውን ጨረታ ይመልከቱ':'View upcoming auction'):isLive?(am?'የጨረታውን ዝርዝር ይመልከቱ':'View auction details'):(am?'ውጤቱን ይመልከቱ':'View results')} <ArrowRight size={17} aria-hidden="true"/></Link>{isLive&&<p className={styles.note}>{am?'ከመጫረትዎ በፊት ውሎቹን ይመልከቱ።':'Review the terms before bidding.'}</p>}</div>
  </article>
  {items.length>1&&<div className={styles.dots} aria-label={am?'ጨረታ ይምረጡ':'Choose auction'}>{items.map((auction,i)=><button disabled={bidding} key={auction.code} aria-label={`${am?'ይመልከቱ':'Show'} ${am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title}`} aria-current={i===index?'true':undefined} onClick={()=>setIndex(i)}/>)}</div>}
 </div>;
}
