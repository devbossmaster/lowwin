'use client';
import {useEffect,useId,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {usePathname} from 'next/navigation';
import {useMiniLocale} from './mini-locale';
import {MiniInlineSkeleton} from './mini-route-skeleton';
const pages=new Set<string>();
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
const first=()=>pages.values().next().value??'';
const announce=()=>listeners.forEach(listener=>listener());
const inertRoots=new Map<HTMLElement,boolean>();

export function LoadingSpinner({label,className=''}:{label?:string;className?:string}){
 const {language}=useMiniLocale();
 return <span className={`loading-spinner ${className}`} role="status"><span className="loading-spinner-ring" aria-hidden="true"/><span className="sr-only">{label??(language==='am'?'በመጫን ላይ…':'Loading…')}</span></span>;
}
/** One overlay for concurrent page requests; mounted outside filtered page ancestors. */
export function PageLoading(){
 const id=useId(),[mounted,setMounted]=useState(false),pathname=usePathname();
 const admin=pathname?.startsWith('/admin')??false;
 const active=useSyncExternalStore(subscribe,first,()=> '');
 useEffect(()=>{
  if(!admin)return;
  setMounted(true);pages.add(id);
  for(const node of document.querySelectorAll<HTMLElement>('.app-frame,.admin-root')){
   if(!inertRoots.has(node))inertRoots.set(node,node.inert);
   node.inert=true;
  }
  announce();
  return()=>{pages.delete(id);if(!pages.size){for(const [node,prior] of inertRoots)node.inert=prior;inertRoots.clear()}announce()};
 },[id,admin]);
 if(!admin)return <MiniInlineSkeleton/>;
 return mounted&&active===id?createPortal(<div className="page-loading-backdrop" aria-busy="true"><div className="page-loading-indicator"><LoadingSpinner/></div></div>,document.body):null;
}
