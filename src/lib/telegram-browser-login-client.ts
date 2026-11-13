import {miniReturnPath} from './mini-return';

export const TELEGRAM_BROWSER_LOGIN_ERRORS=['cancelled','expired','unavailable','invalid','contact_required','conflict'] as const;
export type TelegramBrowserLoginError=typeof TELEGRAM_BROWSER_LOGIN_ERRORS[number];
export type TelegramEnvironment='detecting'|'mini'|'browser';
export type TelegramBrowserLoginConfiguration={enabled:boolean;configured:boolean};

/** Bound the readiness request, including a stalled response body. No provider call. */
export async function loadTelegramBrowserLoginConfiguration(signal:AbortSignal,transport:typeof fetch=fetch,timeoutMs=8000):Promise<TelegramBrowserLoginConfiguration>{
 const controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)controller.abort();
 const timeout=setTimeout(abort,timeoutMs);
 try{
  const response=await transport('/api/auth/telegram/browser/config',{signal:controller.signal,credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Configuration unavailable');
  const result:unknown=await response.json();
  if(!result||typeof result!=='object'||!('enabled' in result)||!('configured' in result)||typeof result.enabled!=='boolean'||typeof result.configured!=='boolean')throw Error('Configuration unavailable');
  return {enabled:result.enabled,configured:result.configured};
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
}

/** Presentation only. Server authentication never trusts SDK globals or URL hints. */
export function telegramEnvironment(app:{initData?:string}|undefined):Exclude<TelegramEnvironment,'detecting'>{
 return app?.initData?'mini':'browser';
}
export function telegramBrowserLoginError(value:string|null):TelegramBrowserLoginError|null{
 return TELEGRAM_BROWSER_LOGIN_ERRORS.includes(value as TelegramBrowserLoginError)?value as TelegramBrowserLoginError:null;
}
export function telegramBrowserLoginDestination(location:{pathname:string;search:string;hash:string}):string{
 const query=new URLSearchParams(location.search),next=query.get('next');
 query.delete('telegramLoginError');
 if(next!==null)return miniReturnPath(next);
 const search=query.toString();
 return miniReturnPath(location.pathname+(search?'?'+search:'')+location.hash);
}
export function telegramBrowserLoginStart(next:string,language:'en'|'am'):string{
 const query=new URLSearchParams({next:miniReturnPath(next),lang:language});
 return '/api/auth/telegram/browser/start?'+query.toString();
}
