'use client';
import {memo,useEffect,useRef,useState,type CSSProperties} from 'react';
import {useMiniLocale} from './mini-locale';
import {AuctionClockAnchors} from '@/lib/auction-clock';
import {countdownUnits} from '@/lib/countdown-units';
import styles from './auction-countdown.module.css';
const clocks=new AuctionClockAnchors();

const Flap=memo(function Flap({value,label,animate}:{value:string;label:string;animate:boolean}){
 const [frame,setFrame]=useState<{value:string;previous:string|null}>({value,previous:null});
 if(frame.value!==value)setFrame({value,previous:animate?frame.value:null});
 else if(!animate&&frame.previous!==null)setFrame({value,previous:null});
 const previous=animate&&frame.value===value?frame.previous:null;
 const finish=()=>setFrame(current=>current.value===value&&current.previous!==null?{value,previous:null}:current);
 return <span className={styles.unit} data-countdown-unit data-countdown-value={value}>
  <strong className={styles.tile} data-countdown-tile aria-hidden="true" style={{'--flap-digits':value.length} as CSSProperties}>
   <span className={`${styles.half} ${styles.upper}`}><span>{value}</span></span>
   <span className={`${styles.half} ${styles.lower}`}><span>{previous??value}</span></span>
   {previous!==null&&<span key={value} className={styles.leaves}>
    <span className={`${styles.half} ${styles.upper} ${styles.outgoing}`} data-countdown-flip="outgoing"><span>{previous}</span></span>
    <span className={`${styles.half} ${styles.lower} ${styles.incoming}`} data-countdown-flip="incoming" onAnimationEnd={finish}><span>{value}</span></span>
   </span>}
  </strong>
  <span className="sr-only">{value}</span><small>{label}</small>
 </span>;
});

/** Visual updates stay inside this timer. Hidden/offscreen intervals pause;
 * server receipt anchors recompute the current value immediately on resume. */
export function AuctionCountdown({target,serverNow,observedAt,label,showLabel=true,onElapsed,tiles=false}:{target:string;serverNow:string;observedAt?:number;label:string;showLabel?:boolean;onElapsed?:()=>void;tiles?:boolean}){
 const {language}=useMiniLocale(),am=language==='am',element=useRef<HTMLSpanElement>(null),elapsed=useRef<string|null>(null),callback=useRef(onElapsed);callback.current=onElapsed;
 const [remaining,setRemaining]=useState(()=>clocks.initial(target,serverNow,observedAt,Date.now())),[animate,setAnimate]=useState(false);
 useEffect(()=>{
  const wallAt=Date.now(),monotonicAt=performance.now(),anchor=clocks.observe(serverNow,observedAt,wallAt);let visible=true,id:ReturnType<typeof setInterval>|undefined;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  // Keep the server receipt anchor even if the device's wall clock changes.
  const tick=()=>{const next=clocks.remaining(target,serverNow,anchor,wallAt+performance.now()-monotonicAt);setRemaining(next);if(next===0&&elapsed.current!==target){elapsed.current=target;callback.current?.()}};
  const schedule=(resume=false)=>{clearInterval(id);setAnimate(!resume&&!reduced.matches);if(!document.hidden&&visible){tick();id=setInterval(()=>{setAnimate(!reduced.matches);tick()},1000)}};
  const resume=()=>schedule(true),motion=()=>setAnimate(!reduced.matches);
  tick();schedule(true);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule(true)});
  if(element.current)observer?.observe(element.current);
  document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);window.addEventListener('focus',resume);reduced.addEventListener('change',motion);
  return()=>{clearInterval(id);observer?.disconnect();document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('focus',resume);reduced.removeEventListener('change',motion)};
 },[target,serverNow,observedAt]);
 const units=countdownUnits(remaining);
 if(remaining===0)return <span ref={element} className="countdown" role="timer" aria-live="off">{label==='Starts'?(am?'አሁን ይጀምራል':'Starting now'):(am?'ጨረታው አብቅቷል':'Auction ended')}</span>;
 return <span ref={element} className={`countdown ${styles.countdown} ${tiles?styles.large:styles.compact}`} role="timer" aria-live="off" aria-label={am?`${units[0]} ቀናት ${units[1]} ሰዓታት ${units[2]} ደቂቃዎች ${units[3]} ሰከንዶች`:`${label} in ${units[0]} days ${units[1]} hours ${units[2]} minutes ${units[3]} seconds`}>
  {showLabel&&<span className={styles.label}>{am?(label==='Starts'?'ይጀምራል በ':'ያበቃል በ'):`${label} in`}</span>}
  {units.map((value,index)=><Flap key={index} value={value} animate={animate} label={(am?['ቀን','ሰዓት','ደቂቃ','ሰከንድ']:['days','hrs','min','sec'])[index]}/>)}
 </span>;
}
