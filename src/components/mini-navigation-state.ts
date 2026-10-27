'use client';

type Visit={href:string;scrollY:number;at:number};
type Progress={page:number;at:number};
type ResultView={page:number;sort:'amount'|'picked';jump:boolean};
const routes=new Set(['/','/winners','/my-bids','/profile']);
function localRoute(href:string){
 try{const url=new URL(href,'https://lowwin.invalid');return url.origin==='https://lowwin.invalid'&&routes.has(url.pathname)?url:null}catch{return null}
}
/** Compare route identity without treating %20 and + (or query order) as different views. */
export function miniRouteKey(href:string){
 const url=localRoute(href);if(!url)return null;
 url.searchParams.sort();return url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'');
}
/** View coordinates only. Response payloads remain in the single private query cache. */
export class SessionNavigationState{
 private identity:string|null=null;
 private visits=new Map<string,Visit>();
 private progress=new Map<string,Progress>();
 private results=new Map<string,ResultView&{at:number}>();
 constructor(private readonly retentionMs=600000,private readonly maxLists=12){}
 setIdentity(identity:string|null){if(identity!==this.identity){this.identity=identity;this.visits.clear();this.progress.clear();this.results.clear()}}
 rememberResult(identity:string|null,code:string,view:ResultView){
  if(!identity||identity!==this.identity)return;
  this.results.delete(code);this.results.set(code,{...view,at:Date.now()});
  while(this.results.size>this.maxLists)this.results.delete(this.results.keys().next().value!);
 }
 result(identity:string|null,code:string):ResultView{
  const saved=identity&&identity===this.identity?this.results.get(code):null;
  if(saved&&Date.now()-saved.at<this.retentionMs)return {page:saved.page,sort:saved.sort,jump:saved.jump};
  this.results.delete(code);return {page:1,sort:'amount',jump:false};
 }
 remember(identity:string|null,href:string,scrollY:number){
  const url=localRoute(href);if(!identity||identity!==this.identity||!url||!Number.isFinite(scrollY))return;
  this.visits.set(url.pathname,{href:url.pathname+url.search+url.hash,scrollY:Math.max(0,scrollY),at:Date.now()});
 }
 visit(identity:string|null,href:string){
  const url=localRoute(href);if(!identity||identity!==this.identity||!url)return null;
  const value=this.visits.get(url.pathname);if(!value||Date.now()-value.at>=this.retentionMs){this.visits.delete(url.pathname);return null}
  return value;
 }
 rememberPage(identity:string|null,key:string,page:number){
  if(!identity||identity!==this.identity||!Number.isSafeInteger(page)||page<1)return;
  this.progress.delete(key);this.progress.set(key,{page:Math.min(page,10000),at:Date.now()});
  while(this.progress.size>this.maxLists)this.progress.delete(this.progress.keys().next().value!);
 }
 page(identity:string|null,key:string){
  if(!identity||identity!==this.identity)return 1;
  const value=this.progress.get(key);if(!value||Date.now()-value.at>=this.retentionMs){this.progress.delete(key);return 1}
  return value.page;
 }
}
export const miniNavigationState=new SessionNavigationState();
export function rememberCurrentMiniRoute(identity:string|null){
 if(typeof window!=='undefined')miniNavigationState.remember(identity,location.pathname+location.search+location.hash,window.scrollY);
}
export function rememberedMiniDestination(identity:string|null,href:string){return miniNavigationState.visit(identity,href)?.href??href}
