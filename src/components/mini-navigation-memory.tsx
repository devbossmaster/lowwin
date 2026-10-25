'use client';
import {useEffect} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {miniNavigationState,miniRouteKey,rememberCurrentMiniRoute} from './mini-navigation-state';

/** Restore session-local view coordinates after cached list batches mount. */
export function MiniNavigationMemory(){
 const pathname=usePathname(),params=useSearchParams(),{queryIdentity,status}=useTelegram();
 const href=pathname+(params.size?'?'+params.toString():'');
 const routeKey=miniRouteKey(href);
 useEffect(()=>{
  if(status!=='authenticated'||!queryIdentity)return;
  const saved=miniNavigationState.visit(queryIdentity,href),target=saved&&miniRouteKey(saved.href)===routeKey?saved.scrollY:0;
  let frame=0,restoring=target>0,stopped=false;const until=performance.now()+1200;
  const save=()=>{if(!restoring&&miniRouteKey(location.pathname+location.search)===routeKey)rememberCurrentMiniRoute(queryIdentity)};
  const cancel=()=>{stopped=true;restoring=false;cancelAnimationFrame(frame);save()};
  const restore=()=>{
   if(stopped)return;
   const ready=document.documentElement.scrollHeight>=target+innerHeight-2;
   if(ready||performance.now()>=until){window.scrollTo({top:target,behavior:'instant'});restoring=false;save();return}
   frame=requestAnimationFrame(restore);
  };
  if(restoring)frame=requestAnimationFrame(restore);else save();
  window.addEventListener('scroll',save,{passive:true});window.addEventListener('pagehide',save);
  window.addEventListener('pointerdown',cancel,{once:true,passive:true});window.addEventListener('wheel',cancel,{once:true,passive:true});window.addEventListener('keydown',cancel,{once:true});
  return()=>{save();stopped=true;cancelAnimationFrame(frame);window.removeEventListener('scroll',save);window.removeEventListener('pagehide',save);window.removeEventListener('pointerdown',cancel);window.removeEventListener('wheel',cancel);window.removeEventListener('keydown',cancel)};
 },[href,pathname,queryIdentity,status,routeKey]);
 return null;
}
