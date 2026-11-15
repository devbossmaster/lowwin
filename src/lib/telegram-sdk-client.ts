export const TELEGRAM_SDK_URL='https://telegram.org/js/telegram-web-app.js';

type TelegramViewportEvent=(event?:unknown)=>void;
export type TelegramViewportApp={
 initData?:string;platform?:string;version?:string;isActive?:boolean;isExpanded?:boolean;isFullscreen?:boolean;
 expand?:()=>void;requestFullscreen?:()=>void;isVersionAtLeast?:(version:string)=>boolean;
 onEvent?:(event:string,listener:TelegramViewportEvent)=>void;offEvent?:(event:string,listener:TelegramViewportEvent)=>void;
};
/** Native presentation only, never an identity or contact-verification signal.
 * Keep Telegram's SDK-managed viewport/safe-area CSS and LowWin's content width. */
export function enableTelegramFullscreen(app:TelegramViewportApp|undefined){
 if(!app?.initData?.trim()||app.platform==='unknown')return()=>{};
 let disposed=false,requested=false,unsupported=false,entered=app.isFullscreen===true,userExited=false,paused=document.hidden||app.isActive===false;
 let supported=false;
 try{supported=app.isVersionAtLeast?app.isVersionAtLeast('8.0'):/^\d+(?:\.\d+)*$/.test(app.version??'')&&Number(app.version!.split('.')[0])>=8}catch{}
 const expand=()=>{if(app.isExpanded!==true)try{app.expand?.()}catch{/* Unsupported native presentation must not block browsing. */}};
 const enter=()=>{
  if(disposed||document.hidden||app.isActive===false||userExited)return;
  expand();
  if(!supported||unsupported||requested||app.isFullscreen||!app.requestFullscreen)return;
  requested=true;
  try{app.requestFullscreen()}catch{requested=false;unsupported=true;expand()}
 };
 const changed=()=>{
  requested=false;
  if(app.isFullscreen)entered=true;
  else if(entered&&!document.hidden&&app.isActive!==false)userExited=true; // Respect an explicit exit instead of trapping the user.
 };
 const failed:TelegramViewportEvent=event=>{
  requested=false;
  const error=event&&typeof event==='object'&&'error'in event?event.error:undefined;
  if(error==='UNSUPPORTED')unsupported=true;
  if(error!=='ALREADY_FULLSCREEN')expand();
 };
 const pause=()=>{paused=true};
 const resume=()=>{if(paused){requested=false;paused=false}enter()};
 const visible=()=>{if(document.hidden)pause();else resume()};
 const registered:Array<[string,TelegramViewportEvent]>=[];
 if(supported&&app.onEvent&&app.offEvent)for(const [event,listener] of [['activated',resume],['deactivated',pause],['fullscreenChanged',changed],['fullscreenFailed',failed]] as const){
  try{app.onEvent(event,listener);registered.push([event,listener])}catch{/* Visibility remains an older-client fallback. */}
 }
 document.addEventListener('visibilitychange',visible);
 enter();
 return()=>{disposed=true;document.removeEventListener('visibilitychange',visible);for(const [event,listener]of registered)try{app.offEvent?.(event,listener)}catch{}};
}

/** Observe the eagerly loaded script without delaying an already available SDK.
 * Keep observing after a timeout so a late SDK can still recover the launch. */
export function observeTelegramSdk(onReady:()=>void,onUnavailable:()=>void,timeoutMs=8000){
 let disposed=false,ready=false,unavailable=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const check=()=>{
  if(disposed||ready||!window.Telegram?.WebApp)return false;
  ready=true;clearTimeout(timer);onReady();return true;
 };
 const fail=()=>{if(!disposed&&!ready&&!unavailable){unavailable=true;onUnavailable()}};
 const isSdk=(event:Event)=>{
  const script=event.target as HTMLScriptElement|null;
  return script?.tagName==='SCRIPT'&&script.src===TELEGRAM_SDK_URL;
 };
 const loaded=(event:Event)=>{if(isSdk(event)&&!check())fail()};
 const failed=(event:Event)=>{if(isSdk(event))fail()};
 // Capture listeners also observe parser-inserted async scripts. Register them
 // before checking the global to cover a load racing hydration.
 document.addEventListener('load',loaded,true);
 document.addEventListener('error',failed,true);
 if(!check())timer=setTimeout(()=>{if(!check())fail()},timeoutMs);
 return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('load',loaded,true);document.removeEventListener('error',failed,true)};
}
