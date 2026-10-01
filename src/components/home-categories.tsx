'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,Pause,Play} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import styles from './home-banner.module.css';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
type Category={slug:string;name:string;nameAm:string|null;counts:{all:number}};
export function HomeCategories({categories}:{categories:Category[]}){
 const {t}=useMiniLocale();
 const rail=useRef<HTMLDivElement>(null),interacting=useRef(false),resumeAt=useRef(0);
 const [paused,setPaused]=useState(false),[reduced,setReduced]=useState(true);
 const looped=!reduced&&categories.length>1;
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 useEffect(()=>{
  const element=rail.current;if(!element||!looped)return;
  const normalize=()=>{
   const first=element.firstElementChild as HTMLElement|null;
   const duplicate=element.querySelector<HTMLElement>('[data-loop-copy]');
   const span=first&&duplicate?duplicate.offsetLeft-first.offsetLeft:0;
   if(span>0&&element.scrollLeft>=span)element.scrollLeft-=span;
  };
  element.addEventListener('scroll',normalize,{passive:true});
  return()=>element.removeEventListener('scroll',normalize);
 },[looped,categories.length]);
 useEffect(()=>{
  const element=rail.current;if(!element||paused||reduced||categories.length<2)return;
  let visible=false;const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting},{threshold:.5});observer.observe(element);
  const interval=setInterval(()=>{
   if(document.hidden||!visible||interacting.current||Date.now()<resumeAt.current||element.contains(document.activeElement))return;
   const first=element.firstElementChild as HTMLElement|null,second=first?.nextElementSibling as HTMLElement|null;
   const step=first&&second?second.offsetLeft-first.offsetLeft:(first?.getBoundingClientRect().width??100)+10;
   element.scrollBy({left:step,behavior:'smooth'});
  },3000);
  return()=>{clearInterval(interval);observer.disconnect()};
 },[paused,reduced,categories.length]);
 const release=()=>{interacting.current=false;resumeAt.current=Date.now()+5000};
 return <section className={styles.categories} aria-label={t('categories')}>
  <div className={styles.heading}><h2>{t('categories')}</h2><div className={styles.categoryActions}>{!reduced&&categories.length>1&&<button onClick={()=>setPaused(value=>!value)} aria-label={paused?t('resumeCategories'):t('pauseCategories')} aria-pressed={paused}>{paused?<Play size={15} aria-hidden="true"/>:<Pause size={15} aria-hidden="true"/>}</button>}<Link href="/auctions/all">{t('seeAll')} <ArrowUpRight size={16} aria-hidden="true"/></Link></div></div>
  <div ref={rail} className={styles.grid} data-category-rail aria-label={t('swipeCategories')} tabIndex={0} onPointerDown={()=>{interacting.current=true}} onPointerUp={release} onPointerCancel={release} onMouseEnter={()=>{interacting.current=true}} onMouseLeave={release} onWheel={()=>{resumeAt.current=Date.now()+5000}} onFocus={()=>{interacting.current=true}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))release()}}>
   {categories.map(category=><Link key={category.slug} className={styles.category} href={`/categories/${category.slug}`}><span className={styles.art}><CatalogImage src={`/catalog/undraw/${category.slug}.svg`} alt=""/></span><span><MiniCategoryName slug={category.slug} name={category.name} nameAm={category.nameAm}/></span><small>{category.counts.all} {t(category.counts.all===1?'auction':'auctionsCount')}</small></Link>)}
   {looped&&categories.map((category,index)=><div key={`loop-${category.slug}`} className={styles.category} data-loop-copy={index===0?'start':undefined} aria-hidden="true"><span className={`${styles.art} ${styles.loopArt}`} style={{backgroundImage:`url("/catalog/undraw/${category.slug}.svg")`}}/><span><MiniCategoryName slug={category.slug} name={category.name} nameAm={category.nameAm}/></span><small>{category.counts.all} {t(category.counts.all===1?'auction':'auctionsCount')}</small></div>)}
  </div>
  {categories.length===0&&<p className={styles.empty}>{t('categoriesPrepared')}</p>}
 </section>;
}
