'use client';
import {useEffect,useRef} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {miniNavigationState,miniRouteKey,rememberCurrentMiniRoute} from './mini-navigation-state';
import {CUSTOMER_HISTORY_MARK,CustomerNavigationHistory} from '@/lib/customer-navigation';
import {loadPrivateJson} from './private-query-cache';

/** Restore session-local view coordinates after cached list batches mount. */
export function MiniNavigationMemory(){
 const pathname=usePathname(),params=useSearchParams(),router=useRouter(),{queryIdentity,status}=useTelegram();
 const href=pathname+(params.size?'?'+params.toString():'');
 const routeKey=miniRouteKey(href);
 const history=useRef(new CustomerNavigationHistory()),popped=useRef(false),visitedHome=useRef(false),last=useRef<{identity:string|null;path:string|null}>({identity:null,path:null});
 useEffect(()=>{const pop=()=>{popped.current=true};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
 useEffect(()=>{
  if(status!=='authenticated'||!queryIdentity){history.current.reset();last.current={identity:null,path:null};visitedHome.current=false;return}
  if(last.current.identity!==queryIdentity)visitedHome.current=false;
  const marker=history.current.enter(queryIdentity,href,window.history.state,popped.current);popped.current=false;
  window.history.replaceState({...window.history.state,[CUSTOMER_HISTORY_MARK]:marker},'',window.location.href);
  const returning=visitedHome.current&&last.current.identity===queryIdentity&&last.current.path!==null&&last.current.path!=='/'&&pathname==='/';
  const entering=last.current.identity!==queryIdentity||last.current.path!==pathname;
  last.current={identity:queryIdentity,path:pathname};
  if(pathname==='/'&&entering){
   visitedHome.current=true;
   void loadPrivateJson(queryIdentity,'/api/wallet',{force:true}).catch(()=>{});
   // Refresh server Home content in place; cached client state and providers survive.
   if(returning)router.refresh();
  }
 },[href,pathname,queryIdentity,status,router]);
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
