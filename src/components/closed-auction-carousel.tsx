'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,CalendarDays,ChevronLeft,ChevronRight,Eye,Gavel,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {CatalogImage} from './catalog-image';
import {FavoriteButton} from './favorite-button';
import {useMiniLocale} from './mini-locale';
import styles from './featured-carousel.module.css';

function compact(value:string|number){return new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}
function outcome(auction:CatalogAuction,am:boolean){
  if(!auction.result)return {title:am?'ውጤት በመጠባበቅ ላይ':'Closing / result pending',name:am?'ውጤቱ ገና አልተወሰነም':'No result has been declared',amount:null};
  if(auction.result.outcome==='WINNER')return {title:am?'አሸናፊ':'Winner',name:auction.result.winnerDisplay??(am?'ስም ያልተገለጸ አሸናፊ':'Anonymous winner'),amount:auction.result.winningPoints};
  if(auction.result.outcome==='NO_WINNER')return {title:am?'አሸናፊ የለም':'No winner',name:am?'ልዩ የጨረታ መጠን አልነበረም':'No accepted amount was unique',amount:null};
  return {title:am?'ተሰርዟል':'Cancelled',name:am?'ጨረታው ተሰርዟል':'The auction was cancelled',amount:null};
}

export function ClosedAuctionCarousel({items}:{items:CatalogAuction[]}){
  const {language}=useMiniLocale(),am=language==='am';
  const [index,setIndex]=useState(0),[active,setActive]=useState(false),[visible,setVisible]=useState(true),[reduced,setReduced]=useState(true);
  const [views,setViews]=useState<Record<string,string>>(()=>Object.fromEntries(items.map(item=>[item.slug,item.viewCount])));
  const carouselRef=useRef<HTMLDivElement>(null),cardRef=useRef<HTMLElement>(null),start=useRef<number|null>(null);
  const item=items[index%items.length];
  const recordView=useCallback(async()=>{
    if(!item)return;
    const key=`lowwin-auction-view:${item.slug}`;
    try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'pending')}catch{}
    try{
      const response=await fetch(`/api/catalog/auctions/${encodeURIComponent(item.slug)}/view`,{method:'POST',cache:'no-store'});
      if(!response.ok)throw new Error('view');
      const body=await response.json() as {views?:string};
      if(body.views)setViews(current=>({...current,[item.slug]:body.views!}));
      try{sessionStorage.setItem(key,'recorded')}catch{}
    }catch{try{sessionStorage.removeItem(key)}catch{}}
  },[item]);
  useEffect(()=>{const motion=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(motion.matches);update();motion.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{threshold:.25});if(carouselRef.current)observer.observe(carouselRef.current);return()=>{motion.removeEventListener('change',update);observer.disconnect()}},[]);
  useEffect(()=>{if(items.length<2||active||!visible||reduced)return;const timer=window.setInterval(()=>{if(!document.hidden)setIndex(value=>(value+1)%items.length)},4000);return()=>clearInterval(timer)},[active,items.length,reduced,visible]);
  useEffect(()=>{const node=cardRef.current;if(!node)return;let timer=0;const observer=new IntersectionObserver(([entry])=>{window.clearTimeout(timer);if(entry.isIntersecting&&entry.intersectionRatio>=.55)timer=window.setTimeout(recordView,900)},{threshold:[.55]});observer.observe(node);return()=>{window.clearTimeout(timer);observer.disconnect()}},[item?.slug,recordView]);
  if(!item)return null;
  const result=outcome(item,am),move=(delta:number)=>setIndex(value=>(value+delta+items.length)%items.length);
  const bidText=item.result?.source==='ILLUSTRATIVE'?(am?'DEMO · እውነተኛ ጨረታ የለም':'DEMO · no real bids'):`${compact(item.bidCount)} ${am?'የተቀበሉ ጨረታዎች':'accepted bids'}`;
  const ended=new Date(item.result?.closedAt??item.endsAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  const visibleViews=compact(views[item.slug]??item.viewCount),viewLabel=am?'እይታ':visibleViews==='1'?'view':'views';
  return <div className={`${styles.carousel} closed-auction-carousel`} ref={carouselRef} onMouseEnter={()=>setActive(true)} onMouseLeave={()=>setActive(false)} onFocus={()=>setActive(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setActive(false)}} onTouchStart={event=>{if((event.target as HTMLElement).closest('a,button'))return;start.current=event.touches[0].clientX;setActive(true)}} onTouchEnd={event=>{if(start.current!==null){const distance=event.changedTouches[0].clientX-start.current;if(Math.abs(distance)>40)move(distance<0?1:-1)}start.current=null;setActive(false)}} aria-label={am?'የተዘጉ ጨረታዎች':'Closed auctions'}>
    {items.length>1&&<div className={styles.toolbar}><span>{index+1} / {items.length}</span><div><button aria-label={am?'የቀድሞው የተዘጋ ጨረታ':'Previous closed auction'} onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button aria-label={am?'ቀጣዩ የተዘጋ ጨረታ':'Next closed auction'} onClick={()=>move(1)}><ChevronRight size={18}/></button></div></div>}
    <article className={`${styles.card} ${styles.closedCard}`} key={item.code} ref={cardRef}>
      <div className={styles.visual}><Link href={`/winners/${item.code}`} onClick={recordView} aria-label={`${am?'ውጤቱን ይመልከቱ':'View result for'} ${item.product.title}`}><CatalogImage src={item.product.images[0]?.path} alt={item.product.images[0]?.alt??item.product.title}/></Link><span className={styles.closedBadge}>{item.result?.outcome==='WINNER'?<Trophy size={13}/>:<Gavel size={13}/>} {result.title}</span>{item.result?.demoLabel&&<span className={styles.demo}>{item.result.demoLabel}</span>}<span className={styles.views}><Eye size={14}/>{visibleViews} {viewLabel}</span><div className={styles.favorite}><FavoriteButton slug={item.slug} compact/></div></div>
      <div className={styles.body}><h3 className={styles.closedTitle}><Link href={`/winners/${item.code}`} onClick={recordView}>{item.product.title}</Link></h3><div className={styles.resultPanel}><span>{result.title}</span><strong>{result.name}</strong>{result.amount&&<b>{formatEtb(result.amount)}</b>}<small>{item.result?.source==='ILLUSTRATIVE'?(am?'ለንድፍ ማሳያ ብቻ':'Illustrative result — no real winner recorded'):am?'የተረጋገጠ የመዝጊያ ውጤት':'Settled outcome'}</small></div><div className={styles.resultStats}><div><Gavel size={18}/><span><strong>{bidText}</strong><small>{am?'ጨረታዎች':'Bids'}</small></span></div><div><CalendarDays size={18}/><span><strong>{ended}</strong><small>{am?'የተዘጋበት':'Ended'} · EAT</small></span></div></div><Link className={styles.resultAction} href={`/winners/${item.code}`} onClick={recordView}>{am?'ውጤቱን ይመልከቱ':'View results'} <ArrowRight size={17}/></Link></div>
    </article>
    {items.length>1&&<div className={styles.dots} aria-label={am?'የተዘጋ ጨረታ ይምረጡ':'Choose closed auction'}>{items.map((auction,i)=><button key={auction.code} aria-label={`${am?'ይመልከቱ':'Show'} ${auction.product.title}`} aria-current={i===index?'true':undefined} onClick={()=>setIndex(i)}/>)}</div>}
  </div>;
}
