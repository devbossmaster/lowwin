'use client';
import { useEffect, useState } from 'react';
import {useMiniLocale} from './mini-locale';
import {AuctionClockAnchors} from '@/lib/auction-clock';
const clocks=new AuctionClockAnchors();
export function AuctionCountdown({target,serverNow,observedAt,label,showLabel=true,onElapsed,tiles=false}:{target:string;serverNow:string;observedAt?:number;label:string;showLabel?:boolean;onElapsed?:()=>void;tiles?:boolean}) {
  const {language}=useMiniLocale(),am=language==='am';
  const [remaining,setRemaining]=useState(()=>clocks.initial(target,serverNow,observedAt,Date.now()));
  useEffect(()=>{const anchor=clocks.observe(serverNow,observedAt,Date.now());const tick=()=>setRemaining(clocks.remaining(target,serverNow,anchor,Date.now()));tick();const id=setInterval(tick,1000);return()=>clearInterval(id)},[target,serverNow,observedAt]);
  useEffect(()=>{if(remaining===0)onElapsed?.()},[remaining,onElapsed]);
  if(remaining===0)return <span className="countdown" role="timer">{label==='Starts'?(am?'አሁን ይጀምራል':'Starting now'):(am?'ጨረታው አብቋል':'Auction ended')}</span>;
  const seconds=Math.floor(remaining/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),s=seconds%60;
  if(tiles)return <span className="countdown countdown-tiles" role="timer" aria-label={am?`${days} ቀናት ${hours} ሰዓታት ${minutes} ደቂቃዎች ${s} ሰከንዶች`:`${days} days ${hours} hours ${minutes} minutes ${s} seconds`}>{[[days,'days','ቀን'],[hours,'hrs','ሰዓት'],[minutes,'min','ደቂቃ'],[s,'sec','ሰከንድ']].map(([value,en,translated])=><span data-countdown-unit key={en}><strong>{String(value).padStart(2,'0')}</strong><small>{am?translated:en}</small></span>)}</span>;
  return <span className="countdown" role="timer" aria-label={am?`${label==='Starts'?'መጀመሪያ':'መጨረሻ'} በ${days} ቀናት ${hours} ሰዓታት ${minutes} ደቂቃዎች`: `${label} in ${days} days ${hours} hours ${minutes} minutes`}>{showLabel&&(am?(label==='Starts'?'ይጀምራል በ':'ያበቃል በ'):`${label} in`)} {days?`${days}${am?'ቀ ':'d '}`:''}{String(hours).padStart(2,'0')}h {String(minutes).padStart(2,'0')}m {String(s).padStart(2,'0')}s</span>;
}
