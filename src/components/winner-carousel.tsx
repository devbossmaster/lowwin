'use client';
import {Children,cloneElement,isValidElement,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {Pause,Play} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import {useCarouselAutoScroll} from './use-carousel-auto-scroll';
import styles from './winner-results.module.css';

/** Home-only motion. Original cards remain the single keyboard/screen-reader set. */
export function WinnerCarousel({children,dialogOpen}:{children:ReactNode;dialogOpen:boolean}){
 const {language}=useMiniLocale(),am=language==='am',track=useRef<HTMLDivElement>(null);
 const [paused,setPaused]=useState(false);
 const cards=Children.toArray(children);
 const autoScroll=useCarouselAutoScroll(track,cards.length,paused||dialogOpen,'loop');
 return <div className={styles.carouselRegion} role="region" aria-label={am?'የቅርብ አሸናፊዎች':'Recent winners'}>
  <div ref={track} className={styles.carousel} data-winning-carousel data-automatic={autoScroll||undefined}>{cards}{autoScroll&&cards.map((card,index)=>isValidElement(card)?cloneElement(card as ReactElement<{tabIndex?:number;'aria-hidden'?:boolean;'data-winner-copy'?:boolean;onPointerDown?:React.PointerEventHandler}>,{key:`copy-${index}`,tabIndex:-1,'aria-hidden':true,'data-winner-copy':true,onPointerDown:event=>event.preventDefault()}):null)}</div>
  {autoScroll&&<button type="button" className={styles.carouselToggle} aria-label={paused?(am?'ማንሸራተት ይቀጥሉ':'Resume winner scrolling'):(am?'ማንሸራተት ያቁሙ':'Pause winner scrolling')} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={12} aria-hidden="true"/>:<Pause size={12} aria-hidden="true"/>}<span>{am?paused?'ይቀጥሉ':'ያቁሙ':paused?'Resume':'Pause'}</span></button>}
 </div>;
}
