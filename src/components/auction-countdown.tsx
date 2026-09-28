'use client';
import { useEffect, useState } from 'react';
import {useMiniLocale} from './mini-locale';
export function AuctionCountdown({target,serverNow,label}:{target:string;serverNow:string;label:string}) {
  const {language}=useMiniLocale(),am=language==='am';
  const [remaining,setRemaining]=useState(()=>Math.max(0,new Date(target).getTime()-new Date(serverNow).getTime()));
  useEffect(()=>{const began=Date.now(),initial=Math.max(0,new Date(target).getTime()-new Date(serverNow).getTime());const tick=()=>setRemaining(Math.max(0,initial-(Date.now()-began)));tick();const id=setInterval(tick,1000);return()=>clearInterval(id)},[target,serverNow]);
  if(remaining===0)return <span className="countdown" role="timer">{label==='Starts'?(am?'አሁን ይጀምራል':'Starting now'):(am?'ውጤት በመጠባበቅ ላይ':'Closing / result pending')}</span>;
  const seconds=Math.floor(remaining/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),s=seconds%60;
  return <span className="countdown" role="timer" aria-label={am?`${label==='Starts'?'መጀመሪያ':'መጨረሻ'} በ${days} ቀናት ${hours} ሰዓታት ${minutes} ደቂቃዎች`: `${label} in ${days} days ${hours} hours ${minutes} minutes`}>{am?(label==='Starts'?'ይጀምራል በ':'ያበቃል በ'):`${label} in` } {days?`${days}${am?'ቀ ':'d '}`:''}{String(hours).padStart(2,'0')}h {String(minutes).padStart(2,'0')}m {String(s).padStart(2,'0')}s</span>;
}
