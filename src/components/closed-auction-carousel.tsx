'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,CalendarDays,ChevronLeft,ChevronRight,Eye,Gavel,Tag,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {WinnerSummary} from './winner-summary';
import {MiniCategoryName} from './mini-locale';
import cardStyles from './winners-page.module.css';
import {CatalogImage} from './catalog-image';
import {FavoriteButton} from './favorite-button';
import {useMiniLocale} from './mini-locale';
import {useAuctionActivity} from './auction-activity';
import styles from './featured-carousel.module.css';

function compact(value:string|number){return new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}

export function ClosedAuctionCarousel({items}:{items:CatalogAuction[]}){
  const {language}=useMiniLocale(),am=language==='am';
  const [index,setIndex]=useState(0),[active,setActive]=useState(false),[visible,setVisible]=useState(true),[reduced,setReduced]=useState(true);
  const carouselRef=useRef<HTMLDivElement>(null),cardRef=useRef<HTMLElement>(null),start=useRef<number|null>(null);
  const item=items[index%items.length];
  const {activity,views}=useAuctionActivity(item?.code??'',{element:cardRef,record:true});
  useEffect(()=>{const motion=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(motion.matches);update();motion.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{threshold:.25});if(carouselRef.current)observer.observe(carouselRef.current);return()=>{motion.removeEventListener('change',update);observer.disconnect()}},[]);
  useEffect(()=>{if(items.length<2||active||!visible||reduced)return;const timer=window.setInterval(()=>{if(!document.hidden)setIndex(value=>(value+1)%items.length)},4000);return()=>clearInterval(timer)},[active,items.length,reduced,visible]);
  if(!item)return null;
  const title=am?(item.product.titleAm?.trim()||item.product.title):item.product.title,move=(delta:number)=>setIndex(value=>(value+delta+items.length)%items.length);
  const bidText=item.result?.source==='ILLUSTRATIVE'?'DEMO':compact(activity?.bids??item.bidCount);
  const ended=new Date(item.result?.closedAt??item.endsAt).toLocaleDateString('en',{dateStyle:'medium',timeZone:'Africa/Addis_Ababa'});
  const visibleViews=compact(views??item.viewCount),viewLabel=am?'እይታ':visibleViews==='1'?'view':'views';
  return <div className={`${styles.carousel} closed-auction-carousel`} ref={carouselRef} onMouseEnter={()=>setActive(true)} onMouseLeave={()=>setActive(false)} onFocus={()=>setActive(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setActive(false)}} onTouchStart={event=>{if((event.target as HTMLElement).closest('a,button'))return;start.current=event.touches[0].clientX;setActive(true)}} onTouchEnd={event=>{if(start.current!==null){const distance=event.changedTouches[0].clientX-start.current;if(Math.abs(distance)>40)move(distance<0?1:-1)}start.current=null;setActive(false)}} aria-label={am?'የተዘጉ ጨረታዎች':'Closed auctions'}>
    {items.length>1&&<div className={styles.toolbar}><span>{index+1} / {items.length}</span><div><button aria-label={am?'የቀድሞው የተዘጋ ጨረታ':'Previous closed auction'} onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button aria-label={am?'ቀጣዩ የተዘጋ ጨረታ':'Next closed auction'} onClick={()=>move(1)}><ChevronRight size={18}/></button></div></div>}
    <article className={`${cardStyles.card} ${styles.closedCard}`} key={item.code} ref={cardRef}>
      <div className={cardStyles.image}><Link href={`/auctions/${item.code}`} aria-label={`${am?'ውጤቱን ይመልከቱ':'View result for'} ${title}`}><CatalogImage src={item.product.images[0]?.path} alt={title}/></Link><span className={cardStyles.outcome}>{item.result?.outcome==='WINNER'?<Trophy size={18}/>:<Gavel size={18}/>}</span><span className={cardStyles.code}>{am?'የጨረታ ኮድ':'AUCTION CODE'} {item.code}</span><span className={cardStyles.category}><Tag size={13}/><MiniCategoryName slug={item.category.slug} name={item.category.name} nameAm={item.category.nameAm}/></span><div className={styles.favorite}><FavoriteButton slug={item.slug} compact/></div></div>
      <div className={cardStyles.body}><h2><Link href={`/auctions/${item.code}`}>{title}</Link></h2>{(item.result?.demoLabel||item.isDemo)&&<span className={cardStyles.demo}>{item.result?.demoLabel??'DEMO'}</span>}<WinnerSummary auction={item}/><div className={cardStyles.meta}><span><CalendarDays size={16}/>{ended}</span><span><Gavel size={16}/>{bidText}</span><span><Eye size={16}/>{visibleViews} {viewLabel}</span></div><Link className={cardStyles.action} href={`/auctions/${item.code}`}>{am?'ውጤቱን ይመልከቱ':'View results'} <ArrowRight size={19}/></Link></div>
    </article>
    {items.length>1&&<div className={styles.dots} aria-label={am?'የተዘጋ ጨረታ ይምረጡ':'Choose closed auction'}>{items.map((auction,i)=><button key={auction.code} aria-label={`${am?'ይመልከቱ':'Show'} ${am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title}`} aria-current={i===index?'true':undefined} onClick={()=>setIndex(i)}/>)}</div>}
  </div>;
}
