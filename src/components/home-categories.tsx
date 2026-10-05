'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {animate} from 'motion/react';
import {ArrowUpRight,Pause,Play} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import {categoryPhoto} from './category-photo';
import styles from './home-banner.module.css';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
type Category={slug:string;name:string;nameAm:string|null;counts:{all:number}};
export function HomeCategories({categories}:{categories:Category[]}){
 const {t}=useMiniLocale();
 const rail=useRef<HTMLDivElement>(null),interacting=useRef(false),resumeAt=useRef(0),autoDirection=useRef<1|-1>(1),touchStart=useRef<number|null>(null),animationRef=useRef<ReturnType<typeof animate>|null>(null);
 const [paused,setPaused]=useState(false),[reduced,setReduced]=useState(true);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 useEffect(()=>{
  const element=rail.current;if(!element||paused||reduced||categories.length<2)return;
  let visible=false;const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting&&entry.intersectionRatio>=.5},{threshold:.5});observer.observe(element);
  const interval=setInterval(()=>{
   if(document.hidden||!visible||interacting.current||Date.now()<resumeAt.current||element.contains(document.activeElement))return;
   const first=element.firstElementChild as HTMLElement|null,second=first?.nextElementSibling as HTMLElement|null;
   const step=first&&second?second.offsetLeft-first.offsetLeft:(first?.getBoundingClientRect().width??100)+10;
   const maximum=element.scrollWidth-element.clientWidth;if(maximum<=1)return;
   if(element.scrollLeft>=maximum-1)autoDirection.current=-1;
   else if(element.scrollLeft<=1)autoDirection.current=1;
   const next=Math.max(0,Math.min(maximum,element.scrollLeft+autoDirection.current*step));
   animationRef.current?.stop();animationRef.current=animate(element.scrollLeft,next,{duration:.65,ease:[.16,1,.3,1],onUpdate:left=>{element.scrollLeft=left}});
  },3000);
  return()=>{clearInterval(interval);animationRef.current?.stop();animationRef.current=null;observer.disconnect()};
 },[paused,reduced,categories.length]);
 const release=()=>{interacting.current=false;resumeAt.current=Date.now()+5000};
 return <section className={styles.categories} aria-label={t('categories')}>
  <div className={styles.heading}><h2>{t('categories')}</h2><div className={styles.categoryActions}>{!reduced&&categories.length>1&&<button onClick={()=>setPaused(value=>!value)} aria-label={paused?t('resumeCategories'):t('pauseCategories')} aria-pressed={paused}>{paused?<Play size={15} aria-hidden="true"/>:<Pause size={15} aria-hidden="true"/>}</button>}<Link href="/auctions/all">{t('seeAll')} <ArrowUpRight size={16} aria-hidden="true"/></Link></div></div>
  <div ref={rail} className={styles.grid} data-category-rail aria-label={t('swipeCategories')} tabIndex={0} onPointerDown={()=>{interacting.current=true;animationRef.current?.stop()}} onPointerUp={release} onPointerCancel={release} onMouseEnter={()=>{interacting.current=true}} onMouseLeave={release} onTouchStart={event=>{touchStart.current=event.touches[0]?.clientX??null;interacting.current=true;animationRef.current?.stop()}} onTouchEnd={event=>{if(touchStart.current!==null){const distance=event.changedTouches[0].clientX-touchStart.current;if(Math.abs(distance)>20)autoDirection.current=distance<0?1:-1}touchStart.current=null;release()}} onWheel={event=>{animationRef.current?.stop();if(Math.abs(event.deltaX)>2)autoDirection.current=event.deltaX>0?1:-1;resumeAt.current=Date.now()+5000}} onFocus={()=>{interacting.current=true}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))release()}}>
   {categories.map(category=>{const photo=categoryPhoto(category.slug,category.name),animals=photo.endsWith('/animals.png');return <Link key={category.slug} className={styles.category} href={`/categories/${category.slug}`}><span className={`${styles.art} ${animals?styles.artPair:''}`}><CatalogImage src={photo} alt=""/>{animals&&<CatalogImage src="/catalog/categories/animals-sheep.png" alt=""/>}</span><span><MiniCategoryName slug={category.slug} name={category.name} nameAm={category.nameAm}/></span><small>{category.counts.all} {t(category.counts.all===1?'auction':'auctionsCount')}</small></Link>})}

  </div>
  {categories.length===0&&<p className={styles.empty}>{t('categoriesPrepared')}</p>}
 </section>;
}
