'use client';
import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {useRouter} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import type {AuctionActivity} from '@/modules/auctions/activity';
import {getMiniQueryClient,subscribePrivateQueries} from './private-query-cache';

type Listener=(value:AuctionActivity)=>void;
const listeners=new Map<string,Set<Listener>>(),recording=new Set<string>();
// Counter payloads share the browser QueryClient; maps below hold subscriptions only.
const values={
 get(code:string){const state=getMiniQueryClient().getQueryState<AuctionActivity>(['lowin-public','auction-activity',code]);return state&&Date.now()-state.dataUpdatedAt<60000?state.data:undefined},
 set(code:string,value:AuctionActivity){const client=getMiniQueryClient();client.setQueryDefaults(['lowin-public','auction-activity'],{staleTime:15000,gcTime:60000});client.setQueryData(['lowin-public','auction-activity',code],value)},
};
let timer:ReturnType<typeof setTimeout>|null=null,controller:AbortController|null=null,failures=0;
function publish(value:AuctionActivity){
 const previous=values.get(value.code);
 // A poll that started before an increment must not move the counter backwards.
 if(previous&&BigInt(previous.views)>BigInt(value.views))value={...value,views:previous.views};
 values.set(value.code,value);listeners.get(value.code)?.forEach(listener=>listener(value));
}
export const ACTIVITY_POLL_MS=15000;
function schedule(delay=ACTIVITY_POLL_MS){if(timer!==null)clearTimeout(timer);timer=null;if(listeners.size&&!document.hidden)timer=setTimeout(()=>void poll(),delay)}
async function poll(){
 if(controller||!listeners.size||document.hidden)return;
 timer=null;const current=new AbortController();controller=current;
 const timeout=setTimeout(()=>current.abort(),8000);
 try{
  const codes=[...listeners.keys()];
  // One request serves every visible card; pages with many results stay bounded.
  for(let offset=0;offset<codes.length;offset+=50){
   const response=await fetch(`/api/catalog/activity?codes=${codes.slice(offset,offset+50).join(',')}`,{cache:'no-store',signal:current.signal});
   if(!response.ok)throw Error('activity');
   const body=await response.json() as {items:AuctionActivity[]};
   if(current.signal.aborted)return;
   for(const item of body.items)if(listeners.has(item.code))publish(item);
  }
  failures=0;
 }catch{if(!current.signal.aborted)failures++}
 finally{clearTimeout(timeout);if(controller===current)controller=null;schedule(Math.min(60000,ACTIVITY_POLL_MS*(1+failures)))}
}
function visibility(){if(document.hidden){if(timer!==null)clearTimeout(timer);timer=null;controller?.abort()}else schedule(0)}
subscribePrivateQueries(event=>{if(event.kind==='mutation'&&(!event.keys||event.keys.some(scope=>scope==='/api/catalog/auctions'||scope.startsWith('/api/auctions'))))schedule(0)});
function subscribe(code:string,listener:Listener){
 const first=listeners.size===0;let group=listeners.get(code);if(!group){group=new Set();listeners.set(code,group)}group.add(listener);
 const existing=values.get(code);if(existing)listener(existing);
 if(first){document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',visibility);window.addEventListener('online',visibility)}schedule(0);
 return()=>{group!.delete(listener);if(!group!.size)listeners.delete(code);if(!listeners.size){if(timer!==null)clearTimeout(timer);timer=null;controller?.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',visibility);window.removeEventListener('online',visibility)}};
}
export function useAuctionActivity(code:string,{element,record=false}:{element?:RefObject<Element|null>;record?:boolean}={}){
 const {me,status:identityStatus}=useTelegram(),viewerId=me?.user.id;
 const [visible,setVisible]=useState(!element),[value,setValue]=useState<AuctionActivity|null>(null),[recorded,setRecorded]=useState<{code:string;views:string}|null>(null);
 useEffect(()=>{if(!element)return;const node=element.current;if(!node)return;setVisible(false);const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting&&entry.intersectionRatio>=.5),{threshold:[0,.5]});observer.observe(node);return()=>observer.disconnect()},[element,code]);
 useEffect(()=>{setValue(null);if(!visible||!/^\d+$/.test(code))return;return subscribe(code,setValue)},[code,visible]);
 const recordView=useCallback(async()=>{
  if(!/^[1-9]\d{0,9}$/.test(code)||document.hidden||identityStatus!=='authenticated'||!viewerId)return;
  const key=`lowwin-auction-view:${viewerId}:${code}`;
  if(recording.has(code))return;
  try{if(Number(sessionStorage.getItem(key))>Date.now())return}catch{}
  recording.add(code);
  try{const response=await fetch(`/api/catalog/auctions/${code}/view`,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('view');const body=await response.json() as {views:string;counted:boolean};const prior=values.get(code);if(prior)publish({...prior,views:body.views});setRecorded({code,views:body.views});try{sessionStorage.setItem(key,String(Date.now()+(body.counted?86400000:300000)))}catch{}schedule()}catch{/* Retrying a later visible visit can record the view. */}finally{recording.delete(code)}
 },[code,identityStatus,viewerId]);
 useEffect(()=>{
  if(!record||!visible)return;
  let delay:ReturnType<typeof setTimeout>|undefined;
  const visit=()=>{clearTimeout(delay);if(!document.hidden)delay=setTimeout(()=>void recordView(),1000)};
  visit();document.addEventListener('visibilitychange',visit);
  return()=>{clearTimeout(delay);document.removeEventListener('visibilitychange',visit)};
 },[record,visible,recordView]);
 const refreshActivity=useCallback(()=>schedule(0),[]);
 const activity=value?.code===code?value:null,views=recorded?.code===code?recorded.views:null;
 return {activity,views:activity&&views?(BigInt(activity.views)>BigInt(views)?activity.views:views):activity?.views??views,recordView,refreshActivity};
}

/** Fetch the canonical page once public settlement or the auction phase changes. */
export function useAuctionRefresh(activity:AuctionActivity|null,status:AuctionActivity['status']|undefined,resultReady:boolean){
 const router=useRouter(),lastRefresh=useRef(0);
 useEffect(()=>{
  if(!activity||!status||activity.status===status&&(!activity.resultReady||resultReady))return;
  if(Date.now()-lastRefresh.current<2000)return;
  lastRefresh.current=Date.now();router.refresh();
 },[activity,status,resultReady,router]);
}
