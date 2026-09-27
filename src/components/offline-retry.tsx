'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
export function OfflineRetry() {
  const [offline,setOffline]=useState(false),router=useRouter();
  useEffect(()=>{const update=()=>setOffline(!navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[]);
  return offline?<div className="offline-banner" role="status">You’re offline. Catalog information may be out of date. <button onClick={()=>router.refresh()}>Retry</button></div>:null;
}
