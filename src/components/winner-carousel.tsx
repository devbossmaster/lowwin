'use client';
import {Children,cloneElement,isValidElement,useEffect,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {Pause,Play} from 'lucide-react';
import {useMiniLocale} from './mini-locale';
import styles from './winner-results.module.css';

/** Home-only motion. Original cards remain the single keyboard/screen-reader set. */
export function WinnerCarousel({children,dialogOpen}:{children:ReactNode;dialogOpen:boolean}){
 const {language}=useMiniLocale(),am=language==='am',track=useRef<HTMLDivElement>(null);
 const [paused,setPaused]=useState(false),[reduced,setReduced]=useState(true);
 const cards=Children.toArray(children),count=cards.length;
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[]);
 useEffect(()=>{
  const element=track.current;
  if(!element||count<2||paused||reduced||dialogOpen)return;
  let frame=0,last=0,distance=0,position=element.scrollLeft,painted=position,visible=false,hovering=false,focused=false,pressed=false,resumeAt=0;
  const measure=()=>{const first=element.children[0] as HTMLElement|undefined,copy=element.children[count] as HTMLElement|undefined;distance=first&&copy?copy.offsetLeft-first.offsetLeft:0};
  const allowed=()=>visible&&!document.hidden&&!hovering&&!focused&&!pressed&&distance>0;
  const tick=(now:number)=>{
   frame=0;
   if(!allowed())return;
   // Keep subpixel movement in memory: scrollLeft assignments can be rounded
   // to whole pixels, otherwise a slow 0.3px frame never moves the track.
   if(Math.abs(element.scrollLeft-painted)>1)position=element.scrollLeft;
   if(last&&now>=resumeAt){position+=Math.min(now-last,50)*.018;if(position>=distance)position-=distance;element.scrollLeft=position;painted=element.scrollLeft}
   else{position=element.scrollLeft;painted=position}
   last=now;frame=requestAnimationFrame(tick);
  };
  const update=()=>{cancelAnimationFrame(frame);frame=0;last=0;position=element.scrollLeft;painted=position;if(allowed())frame=requestAnimationFrame(tick)};
  const enter=(event:PointerEvent)=>{if(event.pointerType==='mouse'){hovering=true;update()}};
  const leave=()=>{hovering=false;pressed=false;update()};
  const down=()=>{pressed=true;update()};
  const up=()=>{if(!pressed)return;pressed=false;resumeAt=performance.now()+4000;update()};
  const wheel=()=>{resumeAt=performance.now()+4000};
  const focus=()=>{focused=true;update()};
  const blur=(event:FocusEvent)=>{focused=element.contains(event.relatedTarget as Node|null);update()};
  measure();const resize=new ResizeObserver(()=>{measure();update()});resize.observe(element);
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()},{threshold:.1});observer.observe(element);
  element.addEventListener('pointerenter',enter);element.addEventListener('pointerleave',leave);element.addEventListener('pointerdown',down);element.addEventListener('wheel',wheel,{passive:true});element.addEventListener('focusin',focus);element.addEventListener('focusout',blur);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);document.addEventListener('visibilitychange',update);
  return()=>{cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();element.removeEventListener('pointerenter',enter);element.removeEventListener('pointerleave',leave);element.removeEventListener('pointerdown',down);element.removeEventListener('wheel',wheel);element.removeEventListener('focusin',focus);element.removeEventListener('focusout',blur);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);document.removeEventListener('visibilitychange',update)};
 },[count,paused,reduced,dialogOpen]);
 return <div className={styles.carouselRegion} role="region" aria-label={am?'የቅርብ አሸናፊዎች':'Recent winners'}>
  <div ref={track} className={styles.carousel} data-winning-carousel data-automatic={!reduced&&count>1||undefined}>{cards}{!reduced&&count>1&&cards.map((card,index)=>isValidElement(card)?cloneElement(card as ReactElement<{tabIndex?:number;'aria-hidden'?:boolean;'data-winner-copy'?:boolean;onPointerDown?:React.PointerEventHandler}>,{key:`copy-${index}`,tabIndex:-1,'aria-hidden':true,'data-winner-copy':true,onPointerDown:event=>event.preventDefault()}):null)}</div>
  {!reduced&&count>1&&<button type="button" className={styles.carouselToggle} aria-label={paused?(am?'ማንሸራተት ይቀጥሉ':'Resume winner scrolling'):(am?'ማንሸራተት ያቁሙ':'Pause winner scrolling')} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={12} aria-hidden="true"/>:<Pause size={12} aria-hidden="true"/>}<span>{am?paused?'ይቀጥሉ':'ያቁሙ':paused?'Resume':'Pause'}</span></button>}
 </div>;
}
