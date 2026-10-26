'use client';
import {useState,type ReactNode} from 'react';
import {useMiniLocale} from './mini-locale';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import styles from './auction-detail.module.css';

export function AuctionGallery({images,title,isDemo,status,priority=false}:{images:{path:string;alt:string}[];title:string;isDemo:boolean;status?:ReactNode;priority?:boolean}){
 const {language}=useMiniLocale(),am=language==='am';
 const [index,setIndex]=useState(0),image=images[index];
 const move=(step:number)=>setIndex(current=>(current+step+images.length)%images.length);
 return <section className={styles.gallery} aria-label={am?'የዕቃው ፎቶዎች':'Product photos'}>
  <div className={styles.mainImage}><CatalogImage key={image?.path??'fallback'} src={image?.path} alt={image?.alt||title} priority={priority}/>{isDemo&&<span className={styles.demo}>DEMO</span>}<div className={styles.galleryStatus}>{status??<span/>}{images.length>0&&<span className={styles.photoCount} aria-label={am?`ፎቶ ${index+1} ከ${images.length}`:`Photo ${index+1} of ${images.length}`}>{index+1}/{images.length}</span>}</div></div>
  {images.length>1&&<div className={styles.galleryControls}><button type="button" className={styles.galleryArrow} onClick={()=>move(-1)} aria-label={am?'ቀዳሚው ፎቶ':'Previous product photo'}><ChevronLeft size={18}/></button><div className={styles.thumbnails}>{images.map((item,i)=><button type="button" key={`${item.path}-${i}`} aria-label={am?`ፎቶ ${i+1} አሳይ`:`Show product photo ${i+1}`} aria-pressed={index===i} onClick={()=>setIndex(i)}><CatalogImage src={item.path} alt="" sizes="60px"/></button>)}</div><button type="button" className={styles.galleryArrow} onClick={()=>move(1)} aria-label={am?'ቀጣዩ ፎቶ':'Next product photo'}><ChevronRight size={18}/></button></div>}
 </section>;
}
