'use client';

import {useEffect,useRef} from 'react';
import type {CreateTypes} from 'canvas-confetti';
import styles from './celebration.module.css';

export function WinnerCelebration({id}:{id:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const target=canvas.current;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(!target||motion.matches||document.hidden)return;

  let ended=false,confetti:CreateTypes|undefined;
  const stop=()=>{
   ended=true;clearTimeout(start);confetti?.reset();
  };
  const start=setTimeout(()=>{
   void import('canvas-confetti').then(({default:library})=>{
    if(ended||!target.isConnected||motion.matches||document.hidden)return;
    // The dialog is in the browser's top layer, so its own canvas can appear
    // above the artwork and remains inert to pointers and keyboard focus.
    confetti=library.create(target,{resize:true,disableForReducedMotion:true});
    const options={spread:68,startVelocity:22,ticks:42,gravity:.72,particleCount:22,scalar:.74,colors:['#2563eb','#1738b5','#73b6ff','#f4ca65']};
    void confetti({...options,angle:64,origin:{x:.13,y:.77}});
    void confetti({...options,angle:116,origin:{x:.87,y:.77}});
   }).catch(stop);
  },175);
  const visibility=()=>{if(document.hidden||motion.matches)stop()};
  document.addEventListener('visibilitychange',visibility);
  motion.addEventListener('change',visibility);
  return()=>{
   stop();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',visibility);
  };
 },[id]);
 return <canvas ref={canvas} className={styles.canvas} aria-hidden="true" data-winner-celebration/>;
}
