'use client';
import {useEffect,useState,type RefObject} from 'react';

/** Move slowly while in view and give pointer, keyboard and touch input priority. */
export function useCarouselAutoScroll(track:RefObject<HTMLDivElement|null>,count:number,paused:boolean,behavior:'loop'|'alternate'){
 const [reduced,setReduced]=useState(true);
 const enabled=!reduced&&count>1;
 useEffect(()=>{
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const change=()=>setReduced(media.matches);
  change();
  media.addEventListener('change',change);
  return()=>media.removeEventListener('change',change);
 },[]);

 useEffect(()=>{
  const element=track.current;
  if(!element||!enabled||paused)return;
  let frame=0,last=0,distance=0,direction=1,resumeAt=0;
  let position=element.scrollLeft,painted=position;
  let visible=typeof IntersectionObserver==='undefined',hovering=window.matchMedia('(hover: hover)').matches&&element.matches(':hover'),focused=element.contains(document.activeElement),pressed=false;

  const measure=()=>{
   if(behavior==='alternate'){
    distance=element.scrollWidth-element.clientWidth;
    return;
   }
   const first=element.firstElementChild as HTMLElement|undefined;
   const copy=element.children[count] as HTMLElement|undefined;
   distance=first&&copy?copy.offsetLeft-first.offsetLeft:0;
  };

  const allowed=()=>visible&&!document.hidden&&!hovering&&!focused&&!pressed&&distance>0;
  const tick=(now:number)=>{
   frame=0;
   if(!allowed())return;
   if(last&&now>=resumeAt){
    position+=direction*Math.min(now-last,50)*.018;
    if(behavior==='loop'&&position>=distance)position%=distance;
    if(behavior==='alternate'){
     if(position>=distance){position=distance;direction=-1;resumeAt=now+900}
     else if(position<=0){position=0;direction=1;resumeAt=now+900}
    }
    const pixel=Math.round(position);
    if(pixel!==painted){painted=pixel;element.scrollLeft=pixel}
   }
   last=now;
   frame=requestAnimationFrame(tick);
  };

  const update=()=>{
   cancelAnimationFrame(frame);
   frame=last=0;
   position=painted=element.scrollLeft;
   if(allowed())frame=requestAnimationFrame(tick);
  };
  const enter=(event:PointerEvent)=>{if(event.pointerType==='mouse'){hovering=true;update()}};
  const leave=()=>{hovering=false;update()};
  const down=()=>{pressed=true;update()};
  const up=()=>{if(pressed){pressed=false;resumeAt=performance.now()+4000;update()}};
  const wheel=()=>{resumeAt=performance.now()+4000};
  // Read layout after actual user or programmatic scrolling, not on every
  // animation frame. Retain fractional travel between painted pixels.
  const scrolled=()=>{const actual=element.scrollLeft;if(Math.abs(actual-painted)>1)position=painted=actual};
  const focus=()=>{focused=true;update()};
  const blur=(event:FocusEvent)=>{focused=element.contains(event.relatedTarget as Node|null);update()};
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{measure();update()});
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()},{threshold:.1});
  measure();
  resize?.observe(element);
  observer?.observe(element);
  element.addEventListener('pointerenter',enter);
  element.addEventListener('pointerleave',leave);
  element.addEventListener('pointerdown',down);
  element.addEventListener('wheel',wheel,{passive:true});
  element.addEventListener('scroll',scrolled,{passive:true});
  element.addEventListener('focusin',focus);
  element.addEventListener('focusout',blur);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up);
  document.addEventListener('visibilitychange',update);
  update();
  return()=>{
   cancelAnimationFrame(frame);
   resize?.disconnect();
   observer?.disconnect();
   element.removeEventListener('pointerenter',enter);
   element.removeEventListener('pointerleave',leave);
   element.removeEventListener('pointerdown',down);
   element.removeEventListener('wheel',wheel);
   element.removeEventListener('scroll',scrolled);
   element.removeEventListener('focusin',focus);
   element.removeEventListener('focusout',blur);
   window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',up);
   document.removeEventListener('visibilitychange',update);
  };
 },[track,count,enabled,paused,behavior]);
 return enabled;
}
