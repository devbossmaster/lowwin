'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import {dismissIntroduction,introductionDismissed} from '@/lib/introduction';
import type {TutorialProps} from './tutorial-content';
import {useTelegram} from './telegram-provider';
const IntroductionSheet=dynamic(()=>import('./introduction-sheet'),{loading:()=>null});
export function FirstVisitIntroduction({enabled=true,...props}:TutorialProps&{enabled?:boolean}){
 const {registrationOpen}=useTelegram();
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  if(!enabled||registrationOpen)return;
  try{if(introductionDismissed(localStorage))return}catch{/* Storage may be disabled. */}
  // Home paints first. A player is never part of its critical rendering path.
  const id=window.setTimeout(()=>{if(!document.querySelector('dialog[open]'))setOpen(true)},400);
  return()=>window.clearTimeout(id);
 },[enabled,registrationOpen]);
 const close=()=>{try{dismissIntroduction(localStorage)}catch{}setOpen(false)};
 return open?<IntroductionSheet {...props} onClose={close}/>:null;
}
