'use client';
import {useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import styles from './auction-detail.module.css';

export function AuctionGallery({images,title,isDemo}:{images:{path:string;alt:string}[];title:string;isDemo:boolean}){
 const [index,setIndex]=useState(0),image=images[index];
 const move=(step:number)=>setIndex(current=>(current+step+images.length)%images.length);
 return <section className={styles.gallery} aria-label="Product photos">
  <div className={styles.mainImage}><CatalogImage key={image?.path??'fallback'} src={image?.path} alt={image?.alt||title}/>{isDemo&&<span className={styles.demo}>DEMO</span>}</div>
  {images.length>1&&<div className={styles.galleryControls}><button type="button" className={styles.galleryArrow} onClick={()=>move(-1)} aria-label="Previous product photo"><ChevronLeft size={20}/></button><div className={styles.thumbnails}>{images.map((item,i)=><button type="button" key={`${item.path}-${i}`} aria-label={`Show product photo ${i+1}`} aria-pressed={index===i} onClick={()=>setIndex(i)}><CatalogImage src={item.path} alt=""/></button>)}</div><button type="button" className={styles.galleryArrow} onClick={()=>move(1)} aria-label="Next product photo"><ChevronRight size={20}/></button></div>}
 </section>;
}
