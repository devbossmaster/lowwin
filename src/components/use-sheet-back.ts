'use client';
import {useCallback,useEffect,useId,useRef} from 'react';
const sheets:string[]=[];
let originalTelegramVisibility=false;
/** Native/Telegram Back closes the top sheet while retaining the underlying route. */
export function useSheetBack(onClose:()=>void,onBack?:()=>void){
 const id=useId(),close=useRef(onClose),backAction=useRef(onBack),closing=useRef(false),opened=useRef<string|null>(null);close.current=onClose;backAction.current=onBack;
 const dismiss=useCallback(()=>{
  if(sheets.at(-1)!==id)return;
  closing.current=true;
  if(location.href===opened.current&&history.state?.lowwinSheet===id)history.back();else close.current();
 },[id]);
 useEffect(()=>{
  const back=window.Telegram?.WebApp?.BackButton,href=location.href;
  let popped=false,pushed=false,active=true;opened.current=href;
  if(!sheets.length)originalTelegramVisibility=back?.isVisible??false;
  sheets.push(id);
  // Effect replay must cancel before touching history, otherwise its queued
  // history.back() can dismiss the new lifetime's modal.
  const frame=requestAnimationFrame(()=>{if(active){history.pushState({...history.state,lowwinSheet:id},'',href);pushed=true}});
  const pop=(event:PopStateEvent)=>{if(sheets.at(-1)===id&&event.state?.lowwinSheet!==id){if(!closing.current&&backAction.current){backAction.current();history.pushState({...history.state,lowwinSheet:id},'',href)}else{popped=true;close.current()}}};
  const telegramBack=()=>{if(sheets.at(-1)===id){if(backAction.current)backAction.current();else dismiss()}};
  window.addEventListener('popstate',pop);
  try{back?.show();back?.onClick(telegramBack)}catch{/* Older Telegram clients retain browser/Escape/close controls. */}
  return()=>{
   active=false;cancelAnimationFrame(frame);window.removeEventListener('popstate',pop);const index=sheets.indexOf(id);if(index>=0)sheets.splice(index,1);
   try{back?.offClick(telegramBack);if(sheets.length||originalTelegramVisibility)back?.show();else back?.hide()}catch{}
   if(pushed&&!popped&&location.href===href&&history.state?.lowwinSheet===id)history.back();opened.current=null;
  };
 },[id,dismiss]);
 return dismiss;
}
