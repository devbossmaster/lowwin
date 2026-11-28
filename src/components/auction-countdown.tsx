'use client';
import {memo,useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {useMiniLocale} from './mini-locale';
import {AuctionClockAnchors} from '@/lib/auction-clock';
import {countdownUnits,inlineCountdown} from '@/lib/countdown-units';
import styles from './auction-countdown.module.css';
const clocks=new AuctionClockAnchors();

const Flap=memo(function Flap({value,label,animate}:{value:string;label:string;animate:boolean}){
 const [frame,setFrame]=useState<{value:string;previous:string|null}>({value,previous:null});
 if(frame.value!==value)setFrame({value,previous:animate?frame.value:null});
 else if(!animate&&frame.previous!==null)setFrame({value,previous:null});
 const previous=animate&&frame.value===value?frame.previous:null;
 const finish=useCallback(()=>setFrame(current=>current===frame&&current.previous!==null?{value:current.value,previous:null}:current),[frame]);
 useEffect(()=>{if(previous===null)return;const timeout=setTimeout(finish,200);return()=>clearTimeout(timeout)},[finish,previous]);
 return <span className={styles.unit} data-countdown-unit data-countdown-value={value} aria-hidden="true">
  <strong className={styles.tile} data-countdown-tile style={{'--flap-digits':value.length} as CSSProperties}>
   <span className={styles.digit}>{value}</span>
   {previous!==null&&<span key={value} className={styles.leaves}>
    <span className={`${styles.half} ${styles.lower}`} data-countdown-holding><span>{previous}</span></span>
    <span className={`${styles.half} ${styles.upper} ${styles.outgoing}`} data-countdown-flip="outgoing"><span>{previous}</span></span>
    <span className={`${styles.half} ${styles.lower} ${styles.incoming}`} data-countdown-flip="incoming" onAnimationEnd={finish}><span>{value}</span></span>
   </span>}
  </strong>
  <small>{label}</small>
 </span>;
});

/** Update on visible digit changes and resume from the server receipt anchor. */
export function AuctionCountdown({target,serverNow,observedAt,label,showLabel=true,onElapsed,tiles=false,variant}:{target:string;serverNow:string;observedAt?:number;label:string;showLabel?:boolean;onElapsed?:()=>void;tiles?:boolean;variant?:'inline'}){
 const {language}=useMiniLocale(),am=language==='am',element=useRef<HTMLSpanElement>(null),elapsed=useRef<string|null>(null),callback=useRef(onElapsed);callback.current=onElapsed;
 const [{remaining,animate},setClock]=useState(()=>({remaining:clocks.initial(target,serverNow,observedAt,Date.now()),animate:false}));
 useEffect(()=>{
  const wallAt=Date.now(),monotonicAt=performance.now(),anchor=clocks.observe(serverNow,observedAt,wallAt);
  let visible=true,id:ReturnType<typeof setTimeout>|undefined;
  const reduced=variant==='inline'?null:window.matchMedia('(prefers-reduced-motion: reduce)');
  // Keep the server receipt anchor even if the device's wall clock changes.
  const tick=(live=false)=>{
   const next=clocks.remaining(target,serverNow,anchor,wallAt+performance.now()-monotonicAt);
   const nextSeconds=Math.floor(next/1000);
   setClock(current=>{
    const previousSeconds=Math.floor(current.remaining/1000);
    if(previousSeconds===nextSeconds&&Boolean(current.remaining)===Boolean(next)&&(live||!current.animate))return current;
    return {remaining:next,animate:live&&!!reduced&&!reduced.matches&&previousSeconds-nextSeconds===1};
   });
   if(next===0){
    if(elapsed.current!==target){elapsed.current=target;callback.current?.()}
   }else{
    // Aim just beyond the next whole-second boundary; avoid drifting a full
    // interval when the tab or the main thread was delayed.
    const delay=Math.max(1,Math.ceil(Math.min(next,next%1000+12)));
    id=setTimeout(()=>tick(true),delay);
   }
  };
  const schedule=()=>{
   clearTimeout(id);
   if(document.hidden||!visible){setClock(current=>current.animate?{...current,animate:false}:current);return}
   tick();
  };
  schedule();
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule()});
  if(element.current)observer?.observe(element.current);
  document.addEventListener('visibilitychange',schedule);window.addEventListener('pageshow',schedule);window.addEventListener('focus',schedule);reduced?.addEventListener('change',schedule);
  return()=>{clearTimeout(id);observer?.disconnect();document.removeEventListener('visibilitychange',schedule);window.removeEventListener('pageshow',schedule);window.removeEventListener('focus',schedule);reduced?.removeEventListener('change',schedule)};
 },[target,serverNow,observedAt,variant]);
 const units=countdownUnits(remaining);
 if(variant==='inline')return <span ref={element} className={`countdown ${styles.inline}`} data-countdown-inline role="timer" aria-live="off" aria-label={remaining===0?undefined:am?`${units[0]} ቀናት ${units[1]} ሰዓታት ${units[2]} ደቂቃዎች ${units[3]} ሰከንዶች`:`${label} in ${units[0]} days ${units[1]} hours ${units[2]} minutes ${units[3]} seconds`}>{remaining===0?(label==='Starts'?(am?'አሁን ይጀምራል':'Starting now'):(am?'ጨረታው አብቅቷል':'Auction ended')):inlineCountdown(remaining,am)}</span>;
 if(remaining===0)return <span ref={element} className="countdown" data-countdown-ended role="timer" aria-live="off">{label==='Starts'?(am?'አሁን ይጀምራል':'Starting now'):(am?'ጨረታው አብቅቷል':'Auction ended')}</span>;
 const unitLabels=am?['ቀን','ሰዓት','ደቂቃ','ሰከንድ']:['days','hrs','min','sec'];
 return <span ref={element} lang={language} className={`countdown ${styles.countdown} ${tiles?styles.large:styles.compact}`} data-countdown-group data-countdown-large-values={units[0].length>3||undefined} role="timer" aria-live="off" aria-label={am?`${units[0]} ቀናት ${units[1]} ሰዓታት ${units[2]} ደቂቃዎች ${units[3]} ሰከንዶች`:`${label} in ${units[0]} days ${units[1]} hours ${units[2]} minutes ${units[3]} seconds`}>
  {showLabel&&<span className={styles.label}>{am?(label==='Starts'?'ይጀምራል በ':'ያበቃል በ'):`${label} in`}</span>}
  {units.map((value,index)=><Flap key={index} value={value} animate={animate} label={unitLabels[index]}/>)}
 </span>;
}
