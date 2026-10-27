'use client';
import {miniReadsBusy,prefetchPrivateQuery,subscribePrivateQueries} from './private-query-cache';

/** Shared metadata budget; no response payloads and no eager detail/participant reads. */
export class IntentPrefetchBudget{
 private recent=new Map<string,number>();
 private windowStart=0;
 private count=0;
 constructor(private readonly repeatMs=30000,private readonly maxPerWindow=4,private readonly windowMs=10000){}
 reset(){this.recent.clear();this.windowStart=0;this.count=0}
 allow(identity:string|null,target:string,now=Date.now()){
  const key=JSON.stringify([identity,target]);
  if(now-(this.recent.get(key)??-Infinity)<this.repeatMs)return false;
  if(now-this.windowStart>=this.windowMs){this.windowStart=now;this.count=0}
  if(this.count>=this.maxPerWindow)return false;
  this.recent.delete(key);this.recent.set(key,now);this.count++;
  while(this.recent.size>24)this.recent.delete(this.recent.keys().next().value!);
  return true;
 }
}
const budget=new IntentPrefetchBudget();
subscribePrivateQueries(event=>{if(event.kind==='session'||event.kind==='authorization')budget.reset()});
export function privateIntentDestination(target:string){
 let url:URL;try{url=new URL(target,'https://lowwin.invalid')}catch{return null}if(url.origin!=='https://lowwin.invalid')return null;
 if(url.pathname==='/profile')return '/api/profile';
 if(url.pathname==='/winners'){
  const raw=Number(url.searchParams.get('page')??1),page=Number.isSafeInteger(raw)&&raw>0?Math.min(raw,10000):1;
  return `/api/results/winners?page=${page}`;
 }
 if(url.pathname==='/my-bids'){
  const raw=Number(url.searchParams.get('page')??1),page=Number.isSafeInteger(raw)&&raw>0?Math.min(raw,10000):1;
  const view=url.searchParams.get('view'),safeView=view==='live'||view==='history'?view:'all';
  return `/api/my-bids?view=${safeView}&page=${page}`;
 }
 return null;
}
export function prefetchMiniIntent(identity:string|null,target:string,prefetchRoute:(url:string)=>void){
 if(miniReadsBusy())return;
 const connection=typeof navigator==='undefined'?null:(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
 if(connection?.saveData||connection?.effectiveType==='2g'||connection?.effectiveType==='slow-2g')return;
 let parsed:URL;try{parsed=new URL(target,'https://lowwin.invalid')}catch{return}if(parsed.origin!=='https://lowwin.invalid')return;
 target=parsed.pathname+parsed.search;
 if(!budget.allow(identity,target))return;
 prefetchRoute(target);
 const data=privateIntentDestination(target);if(data)void prefetchPrivateQuery(identity,data);
}
/** Card action intent shares the route budget and respects constrained connections. */
export function prefetchAuctionIntent(identity:string|null,slug:string,{details=false}:{details?:boolean}={}){
 if(miniReadsBusy())return;
 if(!identity||!/^[-a-z0-9]{1,120}$/.test(slug))return;
 const connection=typeof navigator==='undefined'?null:(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
 if(connection?.saveData||connection?.effectiveType==='2g'||connection?.effectiveType==='slow-2g')return;
 if(!budget.allow(identity,`bid:${slug}`))return;
 if(details)void prefetchPrivateQuery(identity,`/api/catalog/auctions/${slug}`);
 void prefetchPrivateQuery(identity,`/api/auctions/${slug}/bids`);
 if(!details)void prefetchPrivateQuery(identity,'/api/wallet');
}
