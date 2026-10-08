'use client';
import {useCallback} from 'react';
import {useSearchParams} from 'next/navigation';

/** URL state survives browser/Telegram Back; contains no private response data. */
export function useMiniQueryState(){
 const params=useSearchParams();
 const set=useCallback((values:Record<string,string|null>)=>{
  const url=new URL(window.location.href);
  for(const [key,value] of Object.entries(values)){if(value===null)url.searchParams.delete(key);else url.searchParams.set(key,value)}
  window.history.pushState(null,'',url.pathname+url.search+url.hash);
 },[]);
 return {params,set};
}
export function useMiniPage(key='page'){
 const {params,set}=useMiniQueryState();
 const value=Number(params.get(key)??1),page=Number.isSafeInteger(value)&&value>0?Math.min(value,10000):1;
 const setPage=useCallback((next:number)=>set({[key]:next===1?null:String(next)}),[key,set]);
 return [page,setPage] as const;
}
