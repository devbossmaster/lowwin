'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState,type RefObject} from 'react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {AccountSheet} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './winner-results.module.css';

const Breakdown=dynamic(()=>import('./result-sheet-content'),{loading:()=> <p role="status"><MiniPhrase en="Loading bid numbers…" am="የጨረታ ቁጥሮችን በመጫን ላይ…"/></p>});
/** The light, stable dialog opens from the card while hidden breakdown code waits. */
export default function ResultSheet({auction,onClose,returnFocusRef}:{auction:CatalogAuction;onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 const {language}=useMiniLocale(),am=language==='am',section=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 const title=am?auction.product.titleAm||auction.product.title:auction.product.title;
 useEffect(()=>{const node=section.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'0px'});observer.observe(node);return()=>observer.disconnect()},[]);
 return <AccountSheet title={<MiniPhrase en="Final result" am="የመጨረሻ ውጤት"/>} onClose={onClose} returnFocusRef={returnFocusRef}>
  <div className={styles.detailPhoto}><CatalogImage src={auction.product.images[0]?.path} alt={title}/></div><h3 className={styles.title}>{title}</h3>
  <p className={styles.date}><MiniPhrase en="Completed" am="ተጠናቋል"/> · {auction.code} · <MiniPhrase en="Submission fee" am="የማቅረቢያ ክፍያ"/> {formatEtb(auction.terms.entryFeePoints)}</p>
  <div ref={section} data-result-breakdown tabIndex={-1}>{visible?<Breakdown key={auction.code} code={auction.code}/>:<p><MiniPhrase en="Bid numbers" am="የጨረታ ቁጥሮች"/></p>}</div>
 </AccountSheet>;
}
