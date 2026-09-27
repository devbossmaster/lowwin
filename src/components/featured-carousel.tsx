'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CatalogAuction } from '@/modules/auctions/catalog';
import { CatalogImage } from './catalog-image';
export function FeaturedCarousel({items}:{items:CatalogAuction[]}) {
  const [index,setIndex]=useState(0),[active,setActive]=useState(false),[visible,setVisible]=useState(true),[reduced,setReduced]=useState(false);
  const ref=useRef<HTMLDivElement>(null),start=useRef<number|null>(null);
  useEffect(()=>{const motion=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(motion.matches);update();motion.addEventListener('change',update);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));if(ref.current)observer.observe(ref.current);return()=>{motion.removeEventListener('change',update);observer.disconnect()};},[]);
  useEffect(()=>{if(items.length<2||active||!visible||reduced)return;const tick=window.setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length)},4000);return()=>clearInterval(tick)},[items.length,active,visible,reduced]);
  if(!items.length)return null;
  const item=items[index];const move=(delta:number)=>setIndex(i=>(i+delta+items.length)%items.length);
  return <div className="featured-carousel" ref={ref} onMouseEnter={()=>setActive(true)} onMouseLeave={()=>setActive(false)} onFocus={()=>setActive(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setActive(false)}} onTouchStart={event=>{start.current=event.touches[0].clientX;setActive(true)}} onTouchEnd={event=>{if(start.current!==null){const distance=event.changedTouches[0].clientX-start.current;if(Math.abs(distance)>40)move(distance<0?1:-1)}start.current=null;window.setTimeout(()=>setActive(false),2500)}} aria-label="Featured auctions">
    <Link href={`/auctions/${item.slug}`} className="featured-slide"><CatalogImage key={item.slug} src={item.product.images[0]?.path} alt={item.product.images[0]?.alt??item.product.title}/><span className="featured-overlay"><span className="feature-label">DEMO · FEATURED AUCTION</span><strong>{item.product.title}</strong><span>{item.category.name} <ArrowRight size={16}/></span></span></Link>
    <div className="carousel-controls"><div className="carousel-dots" aria-label="Choose featured auction">{items.map((auction,i)=><button key={auction.code} aria-label={`Show ${auction.product.title}`} aria-current={i===index?'true':undefined} onClick={()=>{setIndex(i);setActive(true)}}/>)}</div><div><button aria-label="Previous featured auction" onClick={()=>{move(-1);setActive(true)}}><ChevronLeft size={18}/></button><button aria-label="Next featured auction" onClick={()=>{move(1);setActive(true)}}><ChevronRight size={18}/></button></div></div>
  </div>;
}
