'use client';
import { useEffect, useState } from 'react';
export function AuctionCountdown({target,serverNow,label}:{target:string;serverNow:string;label:string}) {
  const [remaining,setRemaining]=useState(()=>Math.max(0,new Date(target).getTime()-new Date(serverNow).getTime()));
  useEffect(()=>{const began=Date.now(),initial=Math.max(0,new Date(target).getTime()-new Date(serverNow).getTime());const tick=()=>setRemaining(Math.max(0,initial-(Date.now()-began)));tick();const id=setInterval(tick,1000);return()=>clearInterval(id)},[target,serverNow]);
  if(remaining===0)return <span className="countdown" role="timer">{label==='Starts'?'Starting now':'Closing / result pending'}</span>;
  const seconds=Math.floor(remaining/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),s=seconds%60;
  return <span className="countdown" role="timer" aria-label={`${label} in ${days} days ${hours} hours ${minutes} minutes`}>{label} in {days?`${days}d `:''}{String(hours).padStart(2,'0')}h {String(minutes).padStart(2,'0')}m {String(s).padStart(2,'0')}s</span>;
}
