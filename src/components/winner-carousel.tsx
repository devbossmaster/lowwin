'use client';
import {Children,cloneElement,isValidElement,useRef,type ReactElement,type ReactNode} from 'react';
import {useMiniLocale} from './mini-locale';
import {useCarouselAutoScroll} from './use-carousel-auto-scroll';
import styles from './winner-results.module.css';

/** Home-only motion. Original cards remain the single keyboard/screen-reader set. */
export function WinnerCarousel({children,dialogOpen}:{children:ReactNode;dialogOpen:boolean}){
 const {language}=useMiniLocale(),am=language==='am',track=useRef<HTMLDivElement>(null);
 const cards=Children.toArray(children);
 const autoScroll=useCarouselAutoScroll(track,cards.length,dialogOpen,'loop');
 return <div className={styles.carouselRegion} role="region" aria-label={am?'የቅርብ አሸናፊዎች':'Recent winners'}>
  <div ref={track} className={styles.carousel} data-winning-carousel data-automatic={autoScroll||undefined}>{cards}{autoScroll&&cards.map((card,index)=>isValidElement(card)?cloneElement(card as ReactElement<{tabIndex?:number;'aria-hidden'?:boolean;'data-winner-copy'?:boolean;onPointerDown?:React.PointerEventHandler}>,{key:`copy-${index}`,tabIndex:-1,'aria-hidden':true,'data-winner-copy':true,onPointerDown:event=>event.preventDefault()}):null)}</div>
 </div>;
}
