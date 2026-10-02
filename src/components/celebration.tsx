'use client';
import {createContext,useCallback,useContext,useEffect,useRef,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import type {CreateTypes} from 'canvas-confetti';
import styles from './celebration.module.css';

const CelebrationContext=createContext<(onceKey?:string)=>void>(()=>{});
export const useCelebration=()=>useContext(CelebrationContext);
export function CelebrationProvider({children}:{children:ReactNode}){
 const path=usePathname(),canvas=useRef<HTMLCanvasElement>(null),instance=useRef<CreateTypes|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),finish=useRef<ReturnType<typeof setTimeout>|null>(null),active=useRef(false),generation=useRef(0),seen=useRef(new Set<string>());
 const stop=useCallback(()=>{
  generation.current++;active.current=false;
  if(timer.current!==null)clearInterval(timer.current);
  if(finish.current!==null)clearTimeout(finish.current);
  timer.current=null;finish.current=null;instance.current?.reset();
 },[]);
 useEffect(()=>()=>stop(),[path,stop]);
 useEffect(()=>{
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const pause=()=>{if(document.hidden||motion.matches)stop()};
  document.addEventListener('visibilitychange',pause);motion.addEventListener('change',pause);
  return()=>{document.removeEventListener('visibilitychange',pause);motion.removeEventListener('change',pause);stop()};
 },[stop]);
 const celebrate=useCallback((onceKey?:string)=>{
  if(active.current||document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches||onceKey&&seen.current.has(onceKey))return;
  active.current=true;const current=generation.current;
  void import('canvas-confetti').then(({default:confetti})=>{
   if(!canvas.current||current!==generation.current)return;
   instance.current??=confetti.create(canvas.current,{resize:true,useWorker:true,disableForReducedMotion:true});
   if(onceKey)seen.current.add(onceKey);
   const duration=3000,end=Date.now()+duration;
   const burst=()=>{
    const left=end-Date.now();
    if(left<=0){if(timer.current!==null)clearInterval(timer.current);timer.current=null;finish.current=setTimeout(stop,1200);return}
    const options={startVelocity:30,spread:360,ticks:60,particleCount:Math.ceil(24*left/duration),colors:['#0bda51','#0bda51','#a0f48b','#fff8dc'],disableForReducedMotion:true};
    void instance.current?.({...options,origin:{x:.1+Math.random()*.2,y:.05+Math.random()*.2}});
    void instance.current?.({...options,origin:{x:.7+Math.random()*.2,y:.05+Math.random()*.2}});
   };
   burst();timer.current=setInterval(burst,250);
  }).catch(()=>stop());
 },[stop]);
 return <CelebrationContext.Provider value={celebrate}>{children}<canvas ref={canvas} className={styles.canvas} aria-hidden="true"/></CelebrationContext.Provider>;
}
export function WinnerCelebration({id}:{id:string}){
 const celebrate=useCelebration();
 useEffect(()=>{celebrate(id)},[celebrate,id]);
 return null;
}
