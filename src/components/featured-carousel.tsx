'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Gavel, Tag } from 'lucide-react';
import type { CatalogAuction } from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {FavoriteButton} from './favorite-button';
import {AuctionCountdown} from './auction-countdown';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
import {formatEtb} from '@/lib/money';
import {FeaturedBid} from './featured-bid';
import styles from './featured-carousel.module.css';
export function FeaturedCarousel({items,serverNow,variant='featured'}:{items:CatalogAuction[];serverNow:string;variant?:'featured'|'ending'}) {
  const {language}=useMiniLocale(),am=language==='am';
  const ending=variant==='ending';
  const carouselLabel=ending?(am?'በቅርቡ የሚያበቁ ጨረታዎች':'Ending soon auctions'):(am?'ተለይተው የቀረቡ ጨረታዎች':'Featured auctions');
  const previousLabel=ending?(am?'ወደ ቀዳሚው በቅርቡ የሚያበቃ ጨረታ':'Previous ending auction'):(am?'ወደ ቀዳሚው ጨረታ':'Previous featured auction');
  const nextLabel=ending?(am?'ወደ ቀጣዩ በቅርቡ የሚያበቃ ጨረታ':'Next ending auction'):(am?'ወደ ቀጣዩ ጨረታ':'Next featured auction');
  const [index,setIndex]=useState(0),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[touching,setTouching]=useState(false),[bidding,setBidding]=useState(false),[visible,setVisible]=useState(true),[reduced,setReduced]=useState(true);
  const active=hovered||focused||touching||bidding;
  const ref=useRef<HTMLDivElement>(null),start=useRef<number|null>(null);
  useEffect(()=>{const motion=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(motion.matches);update();motion.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));if(ref.current)observer.observe(ref.current);return()=>{motion.removeEventListener('change',update);observer.disconnect()};},[]);
  useEffect(()=>{if(items.length<2||active||!visible||reduced)return;const tick=window.setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length)},4000);return()=>clearInterval(tick)},[items.length,active,visible,reduced]);
  if(!items.length)return null;
  const item=items[index%items.length];const move=(delta:number)=>{if(!bidding)setIndex(i=>(i+delta+items.length)%items.length)};
  return <div className={`${styles.carousel} featured-carousel ${ending?'ending-carousel':''}`} ref={ref} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false)}} onTouchStart={event=>{if((event.target as HTMLElement).closest('input,button,dialog,a'))return;start.current=event.touches[0].clientX;setTouching(true)}} onTouchEnd={event=>{if(start.current!==null){const distance=event.changedTouches[0].clientX-start.current;if(Math.abs(distance)>40)move(distance<0?1:-1)}start.current=null;setTouching(false)}} onTouchCancel={()=>{start.current=null;setTouching(false)}} aria-label={carouselLabel}>
    {items.length>1&&<div className={styles.toolbar}><span>{index+1} / {items.length}</span><div><button disabled={bidding} aria-label={previousLabel} onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button disabled={bidding} aria-label={nextLabel} onClick={()=>move(1)}><ChevronRight size={18}/></button></div></div>}
    <article className={styles.card} key={item.code}>
      <div className={styles.visual}><Link href={`/auctions/${item.slug}`} aria-label={`${am?'ጨረታውን ይመልከቱ':'View auction'} ${item.product.title}`}><CatalogImage src={item.product.images[0]?.path} alt={item.product.images[0]?.alt??item.product.title}/></Link><span className={styles.live}><span aria-hidden="true"/>{am?'በሂደት ላይ':'Live'}</span>{item.isDemo&&<span className={styles.demo}>DEMO</span>}<div className={styles.favorite}><FavoriteButton slug={item.slug} compact/></div></div>
      <div className={styles.body}><span className={styles.category}><MiniCategoryName slug={item.category.slug} name={item.category.name}/></span><h3><Link href={`/auctions/${item.slug}`}>{item.product.title}</Link></h3><div className={styles.facts}><div><Gavel size={17} aria-hidden="true"/><span>{am?'የመግቢያ ክፍያ':'Entry fee'}<strong>{formatEtb(item.terms.entryFeePoints)}</strong></span></div><div><Tag size={17} aria-hidden="true"/><span>{am?'የጨረታ ኮድ':'Auction code'}<strong>{item.code}</strong></span></div></div><div className={styles.timing}><span><Clock3 size={17} aria-hidden="true"/><AuctionCountdown target={item.endsAt} serverNow={serverNow} label="Ends"/></span><strong className={styles.bidCount}>{item.bidCount} {am?'ጨረታ':'bids'}</strong></div><FeaturedBid key={item.slug} slug={item.slug} title={item.product.title} onInteractionChange={setBidding}/><Link className={styles.action} href={`/auctions/${item.slug}#bid-review`}>{am?'የጨረታውን ዝርዝር ይመልከቱ':'View auction details'} <ArrowRight size={17} aria-hidden="true"/></Link><p className={styles.note}>{am?'ከመጫረትዎ በፊት ውሎችን እና ክፍያውን ይመልከቱ።':'Review the terms and fee before bidding.'}</p></div>
    </article>
    {items.length>1&&<div className={styles.dots} aria-label={ending?(am?'በቅርቡ የሚያበቃ ጨረታ ይምረጡ':'Choose ending auction'):(am?'ተለይተው የቀረቡ ጨረታዎችን ይምረጡ':'Choose featured auction')}>{items.map((auction,i)=><button disabled={bidding} key={auction.code} aria-label={`${am?'ይመልከቱ':'Show'} ${auction.product.title}`} aria-current={i===index?'true':undefined} onClick={()=>setIndex(i)}/>)}</div>}
  </div>;
}
