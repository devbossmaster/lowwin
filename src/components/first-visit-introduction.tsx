'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import {dismissIntroduction,introductionDismissed} from '@/lib/introduction';
import type {TutorialProps} from './tutorial-content';
import {useTelegram} from './telegram-provider';
const IntroductionSheet=dynamic(()=>import('./introduction-sheet'),{loading:()=>null});
export function FirstVisitIntroduction({enabled=true,...props}:TutorialProps&{enabled?:boolean}){
 const {environment,status,newMiniRegistration,completeMiniIntroduction}=useTelegram();
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  if(!enabled||environment!=='mini'||status!=='authenticated'||!newMiniRegistration)return;
  try{if(introductionDismissed(localStorage)){completeMiniIntroduction();return}}catch{/* Storage may be disabled. */}
  // Public content paints first; a player never enters the critical path.
  let id:number;
  const show=()=>{if(document.querySelector('dialog[open]'))id=window.setTimeout(show,1000);else setOpen(true)};
  id=window.setTimeout(show,400);
  return()=>window.clearTimeout(id);
 },[enabled,environment,status,newMiniRegistration,completeMiniIntroduction]);
 const remember=()=>{try{dismissIntroduction(localStorage)}catch{}};
 const close=()=>{remember();setOpen(false);completeMiniIntroduction()};
 return open?<IntroductionSheet {...props} onClose={close}/>:null;
}
