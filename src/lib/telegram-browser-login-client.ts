import {miniReturnPath} from './mini-return';

export const TELEGRAM_BROWSER_LOGIN_ERRORS=['cancelled','expired','unavailable','invalid','contact_required','conflict'] as const;
export type TelegramBrowserLoginError=typeof TELEGRAM_BROWSER_LOGIN_ERRORS[number];
export type TelegramEnvironment='detecting'|'mini'|'browser';
export type TelegramBrowserLoginConfiguration={enabled:boolean;configured:boolean};
function readResponseJson(response:Response,signal:AbortSignal):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Aborted','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){signal.removeEventListener('abort',abort);abort();return}
  response.json().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}

/** Bound the readiness request, including a stalled response body. No provider call. */
export async function loadTelegramBrowserLoginConfiguration(signal:AbortSignal,transport:typeof fetch=fetch,timeoutMs=8000):Promise<TelegramBrowserLoginConfiguration>{
 const controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)controller.abort();
 const timeout=setTimeout(abort,timeoutMs);
 try{
  const response=await transport('/api/auth/telegram/config',{signal:controller.signal,credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Configuration unavailable');
  const result=await readResponseJson(response,controller.signal);
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
/** Better Auth owns state, PKCE, code exchange and cookies. The browser only
 * starts the same-origin command and follows the expected Telegram approval URL. */
export async function requestTelegramBrowserLogin(next:string,language:'en'|'am',signal:AbortSignal,transport:typeof fetch=fetch,timeoutMs=8000):Promise<string>{
 const controller=new AbortController(),abort=()=>controller.abort();
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
 const timeout=setTimeout(abort,timeoutMs),destination=miniReturnPath(next);
 try{
  const response=await transport('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal,body:JSON.stringify({provider:'telegram-oidc',callbackURL:destination,errorCallbackURL:'/?'+new URLSearchParams({login:'1',next:destination,lang:language}).toString(),disableRedirect:true})});
  if(!response.ok)throw Error('Sign-in unavailable');
  const result=await readResponseJson(response,controller.signal);
  if(!result||typeof result!=='object'||!('url'in result)||typeof result.url!=='string'||!('redirect'in result)||result.redirect!==true)throw Error('Sign-in unavailable');
  const url=new URL(result.url);
  if(url.origin!=='https://oauth.telegram.org'||url.pathname!=='/auth'||url.username||url.password||url.hash)throw Error('Sign-in unavailable');
  return url.href;
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort)}
}
